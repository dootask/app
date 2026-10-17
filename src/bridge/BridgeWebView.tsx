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
import { bridgeStore } from './store';
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

  // 启动脚本带快照；同步值变化时（防抖）刷新，保证页面重载后拿到最新快照
  const [injected, setInjected] = useState(() => getInjectedScript(info));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = bridgeStore.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setInjected(getInjectedScript(info)), 300);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [info]);

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
      mediaPlaybackRequiresUserAction={false}
      mediaCapturePermissionGrantType="grant"
      geolocationEnabled
      setSupportMultipleWindows
      javaScriptCanOpenWindowsAutomatically
      allowsBackForwardNavigationGestures={false}
      bounces={false}
      overScrollMode="never"
      textZoom={100}
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
