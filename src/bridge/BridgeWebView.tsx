import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from 'react';
import { Linking, Platform, StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';
import type { ShouldStartLoadRequest, WebViewOpenWindowEvent } from 'react-native-webview/lib/WebViewTypes';

import { APP_VERSION_NAME } from '../config';
import { dispatchCall } from './dispatcher';
import { buildSnapshot, getInjectedScript, registerPage, unregisterPage, type PageHandle } from './pages';
import { parseBridgeCall, type PageInfo } from './protocol';
import { useThemeName } from './hooks';
import { DEFAULT_OVERRIDES, getPageWebViewState } from './modules/webview/state';

import './modules';

export type WebViewInstance = ComponentRef<typeof WebView>;

export interface BridgeWebViewHandle {
  readonly page: PageHandle | null;
  readonly webview: WebViewInstance | null;
}

export interface BridgeWebViewProps
  extends Omit<WebViewProps, 'source' | 'onMessage' | 'injectedJavaScriptBeforeContentLoaded'> {
  info: PageInfo;
  url: string;
  /** 页面注册完成（WebView 首次挂载） */
  onPage?: (page: PageHandle) => void;
  /** target=_blank / window.open；默认转给前端 window.__onCreateTarget */
  onCreateTarget?: (url: string, page: PageHandle) => void;
}

/** UA 后缀需与 eeui 保持一致，后端据此识别 App（Base::isEEUIApp、UserDevice 等） */
function userAgentSuffix(themeName: string) {
  if (Platform.OS === 'ios') {
    const idiom = Platform.isPad ? 'iPad' : 'iPhone';
    return `;system_theme/${themeName};ios_kuaifan_eeui/${APP_VERSION_NAME};idiom/${idiom}`;
  }
  return `;system_theme/${themeName};android_kuaifan_eeui/${APP_VERSION_NAME}`;
}

const WEB_SCHEME = /^(https?|about|data|blob|file):/i;

/**
 * iOS 的 RNCWebView 把无 host 的 URL 当文件走 loadFileURL，data: URL 会直接抛异常导致闪退，
 * 所以 data:text/html 统一转成 html source。
 */
function toSource(url: string) {
  const m = /^data:text\/html(;[^,]*)?,/i.exec(url);
  if (!m) return { uri: url };
  const body = url.slice(m[0].length);
  try {
    // base64 按 UTF-8 还原：atob 得到字节串，escape + decodeURIComponent 转回文本
    const html = /;base64/i.test(m[1] || '') ? decodeURIComponent(escape(atob(body))) : decodeURIComponent(body);
    return { html };
  } catch {
    return { html: '' };
  }
}

export const BridgeWebView = forwardRef<BridgeWebViewHandle, BridgeWebViewProps>(function BridgeWebView(
  { info, url, onPage, onCreateTarget, style, ...rest },
  ref,
) {
  const webviewRef = useRef<WebViewInstance>(null);
  const pageRef = useRef<PageHandle | null>(null);
  const themeName = useThemeName();
  const [nativePreferences, setNativePreferences] = useState(DEFAULT_OVERRIDES);

  // 启动脚本带快照，只在页面开始（重新）加载时刷新，保证重载后拿到最新快照。
  // 不能随同步值变化随时刷新：iOS 每次更新启动脚本都会移除并重新注册消息通道，
  // 期间网页发来的桥接调用会丢失（冷启动后首次进地图页，getGeolocation 因此丢失、一直转圈）。
  const [injected, setInjected] = useState(() => getInjectedScript(info));

  useEffect(() => {
    const page = registerPage(info, (js) => webviewRef.current?.injectJavaScript(js));
    pageRef.current = page;
    // 直接使用 BridgeWebView 的页面（如自测页）也必须响应原生长按开关。
    const state = Platform.OS === 'android' ? getPageWebViewState(page) : undefined;
    const updateNativePreferences = () => { if (state) setNativePreferences(state.values); };
    state?.listeners.add(updateNativePreferences);
    updateNativePreferences();
    onPage?.(page);
    return () => {
      state?.listeners.delete(updateNativePreferences);
      pageRef.current = null;
      unregisterPage(info.pageName);
    };
    // 页面身份只由 pageName 决定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.pageName]);

  useImperativeHandle(
    ref,
    () => ({
      get page() {
        return pageRef.current;
      },
      get webview() {
        return webviewRef.current;
      },
    }),
    [],
  );

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    const call = parseBridgeCall(event.nativeEvent.data);
    const page = pageRef.current;
    if (call && page) dispatchCall(page, call);
  }, []);

  const loadingUrl = useRef('');
  const onLoadStart = useCallback<NonNullable<WebViewProps['onLoadStart']>>(
    (e) => {
      // 只改 hash 的页内跳转仍是同一文档，刷新启动脚本只会白白重置消息通道
      const next = e.nativeEvent.url || '';
      const prev = loadingUrl.current;
      loadingUrl.current = next;
      const hashOnly = next !== prev && next.split('#')[0] === prev.split('#')[0];
      if (!hashOnly) setInjected(getInjectedScript(info));
      rest.onLoadStart?.(e);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [info, rest.onLoadStart],
  );

  // 页面加载完成后用最新快照重置一次，覆盖启动脚本注入时可能过期的数据
  const onLoadEnd = useCallback<NonNullable<WebViewProps['onLoadEnd']>>(
    (e) => {
      webviewRef.current?.injectJavaScript(
        `window.__eeuiBridge&&window.__eeuiBridge.reset(${JSON.stringify(buildSnapshot(info))});true;`,
      );
      rest.onLoadEnd?.(e);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [info, rest.onLoadEnd],
  );

  const onOpenWindow = useCallback(
    (e: WebViewOpenWindowEvent) => {
      const target = e.nativeEvent.targetUrl;
      const page = pageRef.current;
      if (!target || !page) return;
      if (onCreateTarget) onCreateTarget(target, page);
      else page.invokeWindow('__onCreateTarget', target);
    },
    [onCreateTarget],
  );

  // 非网页协议（tel:/mailto:/第三方 App scheme）交给系统处理
  const onShouldStartLoadWithRequest = useCallback(
    (req: ShouldStartLoadRequest) => {
      if (WEB_SCHEME.test(req.url)) {
        return rest.onShouldStartLoadWithRequest ? rest.onShouldStartLoadWithRequest(req) : true;
      }
      Linking.openURL(req.url).catch(() => {});
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rest.onShouldStartLoadWithRequest],
  );

  const reload = useCallback(() => webviewRef.current?.reload(), []);

  const source = useMemo(() => toSource(url), [url]);

  return (
    <WebView
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      allowFileAccess
      allowsInlineMediaPlayback
      // 对齐 eeui：Android 允许免手势播放；iOS 旧壳沿用 WK 默认（需用户手势），避免改变声音启动时机
      mediaPlaybackRequiresUserAction={Platform.OS === 'ios'}
      mediaCapturePermissionGrantType="grant"
      geolocationEnabled
      setSupportMultipleWindows
      javaScriptCanOpenWindowsAutomatically
      allowsBackForwardNavigationGestures={false}
      bounces={false}
      overScrollMode="never"
      // 不设时新架构在 iOS 传 0，手指一抬滚动立即停止（无惯性）；仅 iOS 会把 "normal" 转成数值，Android 收到字符串会崩溃
      decelerationRate={Platform.OS === 'ios' ? 'normal' : undefined}
      // 不设 textZoom：eeui ExtendWebView 未调用 setTextZoom，保持 WebView 默认的系统字体缩放行为
      // 对齐 eeui ExtendWebView MIXED_CONTENT_ALWAYS_ALLOW：HTTPS 外站/微应用里的 HTTP 子资源不被拦截
      mixedContentMode="always"
      pullToRefreshEnabled={false}
      webviewDebuggingEnabled={__DEV__}
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      onContentProcessDidTerminate={reload}
      onRenderProcessGone={reload}
      {...rest}
      {...(Platform.OS === 'android' ? {
        hapticBackEnabled: nativePreferences.hapticBackEnabled,
        disabledUserLongClickSelect: nativePreferences.disabledUserLongClickSelect,
      } : {})}
      ref={webviewRef}
      style={[styles.webview, { backgroundColor: themeName === 'dark' ? '#131313' : '#ffffff' }, style]}
      source={source}
      applicationNameForUserAgent={userAgentSuffix(themeName)}
      injectedJavaScriptBeforeContentLoaded={injected}
      injectedJavaScriptBeforeContentLoadedForMainFrameOnly
      onMessage={onMessage}
      onLoadStart={onLoadStart}
      onLoadEnd={onLoadEnd}
      onOpenWindow={onOpenWindow}
      onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
    />
  );
});

const styles = StyleSheet.create({
  webview: {
    flex: 1,
  },
});
