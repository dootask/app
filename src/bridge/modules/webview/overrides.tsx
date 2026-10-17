import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentRef, type RefObject } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { captureRef as captureNativeRef } from 'react-native-view-shot';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WebViewProps } from 'react-native-webview';

import type { BridgeWebViewHandle } from '../../BridgeWebView';
import type { PageHandle } from '../../pages';
import { useAppTheme } from '../../messages/theme';
import { SAFE_AREA_KEY } from '../eeui/device';
import { DEFAULT_OVERRIDES, disposeWebView, getPageWebViewState, type WebViewOverrideValues } from './state';
import { webViewPreferencesScript } from './scripts';

/** 按 pageName 绑定 PageHandle，调用者只需合并 props、onPage 并挂载截图容器及覆盖层。 */
export function usePageWebViewOverrides(pageName: string, bridgeRef: RefObject<BridgeWebViewHandle | null>) {
  const [page, setPage] = useState<PageHandle | null>(null);
  const captureRef = useRef<ComponentRef<typeof View>>(null);
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const subscribe = useCallback((listener: () => void) => {
    if (!page) return () => {};
    const state = getPageWebViewState(page);
    state.listeners.add(listener);
    return () => { state.listeners.delete(listener); };
  }, [page]);
  const getSnapshot = useCallback(() => page ? getPageWebViewState(page).values : DEFAULT_OVERRIDES, [page]);
  const values = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const onPage = useCallback((handle: PageHandle) => {
    if (handle.pageName !== pageName) return;
    getPageWebViewState(handle).controller = {
      capture: () => {
        if (!captureRef.current) return Promise.reject(new Error('WebView 尚未挂载'));
        return captureNativeRef(captureRef, { format: 'png', result: 'tmpfile' });
      },
      navigate: (url, reload) => {
        if (reload) bridgeRef.current?.webview?.reload();
        else handle.inject(`window.location.href=${JSON.stringify(url)};true;`);
      },
    };
    setPage(handle);
  }, [pageName, bridgeRef]);

  useLayoutEffect(() => {
    if (page) page.state.set(SAFE_AREA_KEY, insets);
  }, [page, insets]);

  const { scrollEnabled, disabledUserLongClickSelect } = values;
  const injectedJavaScript = useMemo(
    () => webViewPreferencesScript({ scrollEnabled, disabledUserLongClickSelect }, Platform.OS === 'android'),
    [scrollEnabled, disabledUserLongClickSelect],
  );
  useEffect(() => {
    page?.inject(injectedJavaScript);
  }, [page, injectedJavaScript]);
  useEffect(() => () => {
    if (page) disposeWebView(page);
  }, [page]);

  const props: WebViewProps = {
    scrollEnabled: values.scrollEnabled,
    ...(Platform.OS === 'android' && values.disabledUserLongClickSelect ? { menuItems: [] } : {}),
    injectedJavaScript,
    style: { backgroundColor: theme.backgroundColor },
    onNavigationStateChange: (event) => {
      if (page) getPageWebViewState(page).currentUrl = event.url;
    },
    onLoadEnd: () => {
      if (page) page.inject(webViewPreferencesScript(getPageWebViewState(page).values, Platform.OS === 'android'));
    },
  };

  return { props, onPage, captureRef, values, url: values.url };
}

export function SnapshotOverlay({ values }: { values: WebViewOverrideValues }) {
  if (!values.snapshotVisible || !values.snapshotUri) return null;
  return <Image pointerEvents="none" source={{ uri: values.snapshotUri }} style={StyleSheet.absoluteFill} resizeMode="stretch" />;
}
