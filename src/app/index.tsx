import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ActivityIndicator, BackHandler, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { BridgeWebView, type BridgeWebViewHandle } from '../bridge/BridgeWebView';
import { usePageActive } from '../bridge/hooks';
import { handleBackPress } from '../bridge/navigation';
import { SnapshotOverlay, usePageWebViewOverrides } from '../bridge/modules/webview/overrides';
import type { PageInfo } from '../bridge/protocol';
import { FIRST_PAGE_NAME } from '../config';
import { ensureAppUniqueId, KeyboardInset, migrateLegacyCaches, useDeepLinkHandler, useLocalWebReady } from '../native';

/**
 * 主页面（对应 eeui pages/index.vue）：全屏 WebView 承载 DooTask 前端
 */
export default function MainPage() {
  const ref = useRef<BridgeWebViewHandle>(null);
  const webLoadedRef = useRef(false);
  const [nativeReady, setNativeReady] = useState(false);
  const webUrl = useLocalWebReady();
  useDeepLinkHandler(useCallback(() => webLoadedRef.current ? ref.current?.page ?? null : null, []));

  useEffect(() => {
    let disposed = false;
    void migrateLegacyCaches().then(() => {
      ensureAppUniqueId();
      if (!disposed) setNativeReady(true);
    }).catch((error) => console.warn('[native] 初始化失败', error));
    return () => { disposed = true; };
  }, []);

  if (!nativeReady || !webUrl) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
  }
  return <ReadyMainPage bridgeRef={ref} webLoadedRef={webLoadedRef} webUrl={webUrl} />;
}

// 就绪后再挂载页面生命周期，避免等待服务时提前消费首次 resume。
function ReadyMainPage({ bridgeRef: ref, webLoadedRef, webUrl }: {
  bridgeRef: RefObject<BridgeWebViewHandle | null>;
  webLoadedRef: RefObject<boolean>;
  webUrl: string;
}) {
  const { props: webViewProps, onPage, captureRef, values: webViewValues, url: overrideUrl } = usePageWebViewOverrides(FIRST_PAGE_NAME, ref);
  const resumeNum = useRef(0);

  const info = useMemo<PageInfo>(
    () => ({ pageName: FIRST_PAGE_NAME, pageType: 'app', url: webUrl, params: {} }),
    [webUrl],
  );

  usePageActive(
    () => {
      ref.current?.page?.invokeWindow('__onPageResume', resumeNum.current);
      resumeNum.current++;
    },
    () => ref.current?.page?.invokeWindow('__onPagePause'),
  );

  // 只在获得焦点时接管返回键，否则被扫码/预览等原生页覆盖时仍会抢走返回事件
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => handleBackPress(ref.current?.page));
    return () => sub.remove();
  }, [ref]));

  const onCreateTarget = useCallback((url: string) => {
    ref.current?.page?.invokeWindow('__onCreateTarget', url);
  }, [ref]);

  return (
    <KeyboardInset edgeToEdge style={{ flex: 1 }}>
      <View ref={captureRef} collapsable={false} style={{ flex: 1 }}>
        <BridgeWebView
          {...webViewProps}
          ref={ref}
          info={info}
          url={overrideUrl ?? webUrl}
          onPage={onPage}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          // 对齐 eeui 首页 hiddenDone：隐藏 iOS 键盘上方的上一项/下一项/完成工具条
          hideKeyboardAccessoryView
          onCreateTarget={onCreateTarget}
          onLoadStart={(event) => {
            // Android 的 pushState（doUpdateVisitedHistory）也会触发 loadStart 且不会有 onLoad，此时 loading 为 false
            if (event.nativeEvent.loading) webLoadedRef.current = false;
            webViewProps.onLoadStart?.(event);
          }}
          onLoad={(event) => {
            webViewProps.onLoad?.(event);
            webLoadedRef.current = true;
          }}
        />
      </View>
      <SnapshotOverlay values={webViewValues} />
    </KeyboardInset>
  );
}
