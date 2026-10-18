import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useIsFocused, useLocalSearchParams, useNavigation } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { WebViewNavigation } from 'react-native-webview/lib/WebViewTypes';

import { BridgeWebView, type BridgeWebViewHandle } from '../bridge/BridgeWebView';
import { usePageActive } from '../bridge/hooks';
import {
  emitPageStatus,
  finishPage,
  getOpenRequest,
  handleBackPress,
  setPageCloser,
} from '../bridge/navigation';
import type { PageInfo } from '../bridge/protocol';
import { useAppTheme } from '../bridge/messages/theme';
import { openWeb } from '../bridge/modules/eeui/openWeb';
import { SnapshotOverlay, usePageWebViewOverrides } from '../bridge/modules/webview/overrides';
import { canOpenInBrowser, isPageTitle, useWebPageLabels } from '../bridge/modules/webview/pageOptions';
import { createTarget, getPageWebViewState, patchWebView, setPageUrl } from '../bridge/modules/webview/state';
import { KeyboardInset } from '../native/KeyboardInset';
import { SwipeBack } from '../native/SwipeBack';

function pageBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    if (['true', '1', 'yes'].includes(value.toLowerCase().trim())) return true;
    if (['false', '0', 'no'].includes(value.toLowerCase().trim())) return false;
  }
  return fallback;
}

/**
 * 二级页面（对应 eeui pages/web.vue，前端以 openPage({url:'web.js', params:{url,...}}) 打开）
 */
export default function WebPage() {
  const { pageName } = useLocalSearchParams<{ pageName: string }>();
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const ref = useRef<BridgeWebViewHandle>(null);
  const activeRef = useRef(false);
  const closingRef = useRef(false);
  const { props: webViewProps, onPage, captureRef, values: webViewValues, url: overrideUrl } = usePageWebViewOverrides(pageName, ref);
  const theme = useAppTheme();
  const [backText, forwardText, browserText, refreshText, defaultTitle] = useWebPageLabels();
  const [webTitle, setWebTitle] = useState('');
  const [history, setHistory] = useState({ canGoBack: false, canGoForward: false });
  const [progress, setProgress] = useState(1);

  const request = getOpenRequest(pageName);
  const params = useMemo(() => request?.options.params ?? {}, [request]);
  // 这是 openPage 的顶层原生选项，不属于传给网页的 params / pageData。
  const swipeBack = pageBoolean(request?.options.swipeBack, true);
  const swipeFullBack = pageBoolean(request?.options.swipeFullBack, false);
  const url = String(params.url ?? request?.options.url ?? 'about:blank');
  const data = webViewValues.pageData;
  const options = { ...params, ...data };
  const titleFixed = !!options.titleFixed;
  const urlFixed = !!options.urlFixed;
  const showProgress = !!options.showProgress;
  const allowAccess = !!options.allowAccess;
  const hiddenDone = !!options.hiddenDone;
  const actionUrl = String(data.url ?? url);
  const title = String(data.title ?? (webTitle || request?.options.pageTitle || defaultTitle));
  const moreShow = !!data.moreShow;

  const closePage = useCallback(() => {
    if (closingRef.current || !navigation.canGoBack()) return;
    closingRef.current = true;
    navigation.goBack();
  }, [navigation]);

  const onSwipeClose = useCallback(() => {
    // 只约束当前手势；桥 closePage(pageName) 仍可按名称关闭被覆盖的页面。
    if (navigation.isFocused()) closePage();
  }, [navigation, closePage]);

  const info = useMemo<PageInfo>(
    () => ({
      pageName,
      pageType: String(request?.options.pageType ?? 'app'),
      url: String(request?.options.url ?? ''),
      params,
    }),
    [pageName, request, params],
  );

  useEffect(() => {
    if (!request) {
      router.back();
      return;
    }
    setPageCloser(pageName, closePage);
    emitPageStatus(pageName, 'create');
    emitPageStatus(pageName, 'start');
    return () => {
      if (activeRef.current) emitPageStatus(pageName, 'pause');
      emitPageStatus(pageName, 'stop');
      finishPage(pageName);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageName]);

  usePageActive(
    () => {
      activeRef.current = true;
      emitPageStatus(pageName, 'resume');
      ref.current?.page?.invokeWindow('__onPageResume');
    },
    () => {
      activeRef.current = false;
      emitPageStatus(pageName, 'pause');
      ref.current?.page?.invokeWindow('__onPagePause');
    },
  );

  // 只在获得焦点时接管返回键，否则被扫码/预览等原生页覆盖时仍会抢走返回事件
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => handleBackPress(ref.current?.page));
    return () => sub.remove();
  }, []));

  const onCreateTarget = useCallback((target: string) => {
    const page = ref.current?.page;
    if (page) Promise.resolve(createTarget(page, target)).catch((error) => console.warn('[web] 打开目标失败', error));
  }, []);

  const setMoreShow = (show: boolean) => {
    const page = ref.current?.page;
    if (page) patchWebView(page, { pageData: { ...getPageWebViewState(page).values.pageData, moreShow: show } });
  };

  const onNavigationStateChange = (event: WebViewNavigation) => {
    webViewProps.onNavigationStateChange?.(event);
    setHistory({ canGoBack: event.canGoBack, canGoForward: event.canGoForward });
    if (!titleFixed && isPageTitle(event.title)) setWebTitle(event.title);
    const page = ref.current?.page;
    if (page && !urlFixed && event.url) {
      const pageData = getPageWebViewState(page).values.pageData;
      if (pageData.url !== event.url) patchWebView(page, { pageData: { ...pageData, url: event.url } });
    }
  };

  const menuAction = (action: 'back' | 'forward' | 'browser' | 'refresh') => {
    setMoreShow(false);
    if (action === 'back') ref.current?.webview?.goBack();
    else if (action === 'forward') ref.current?.webview?.goForward();
    else if (action === 'browser') {
      Promise.resolve(openWeb(actionUrl)).catch((error) => console.warn('[web] 浏览器打开失败', error));
    } else if (ref.current?.page) {
      Promise.resolve(setPageUrl(ref.current.page, actionUrl)).catch((error) => console.warn('[web] 刷新失败', error));
    }
  };

  const menuItems = [
    ...(history.canGoBack ? [{ action: 'back' as const, label: String(data.moreBackText ?? backText) }] : []),
    ...(history.canGoForward ? [{ action: 'forward' as const, label: String(data.moreForwardText ?? forwardText) }] : []),
    ...(canOpenInBrowser(actionUrl) ? [{ action: 'browser' as const, label: String(data.moreBrowserText ?? browserText) }] : []),
    { action: 'refresh' as const, label: String(data.moreRefreshText ?? refreshText) },
  ];

  if (!request) return <View style={styles.container} />;

  const content = (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.backgroundColor }]} edges={['top', 'bottom']}>
      <View style={styles.navbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={backText}
          hitSlop={4}
          style={styles.navButton}
          onPress={closePage}
        >
          <Text allowFontScaling={false} style={[styles.backIcon, { color: theme.navColor }]}>‹</Text>
        </Pressable>
        <Text numberOfLines={1} allowFontScaling={false} accessibilityRole="header" style={[styles.title, { color: theme.navColor }]}>{title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="更多" accessibilityState={{ expanded: moreShow }} style={styles.navButton} onPress={() => setMoreShow(!moreShow)}>
          <Text allowFontScaling={false} style={[styles.moreIcon, { color: theme.navColor }]}>•••</Text>
        </Pressable>
      </View>
      {/* eeui softInputMode：nothing 不避让；resize（默认）/ pan / auto 均按 resize 处理（WebView 内 pan 与 resize 效果相近，前端无非默认调用） */}
      <KeyboardInset style={styles.container} enabled={request.options.softInputMode !== 'nothing'}>
        <View ref={captureRef} collapsable={false} style={styles.container}>
          <BridgeWebView
            {...webViewProps}
            ref={ref}
            info={info}
            url={overrideUrl ?? url}
            onPage={onPage}
            onCreateTarget={onCreateTarget}
            onNavigationStateChange={onNavigationStateChange}
            onLoadStart={() => setProgress(0)}
            onLoadProgress={(event) => setProgress(event.nativeEvent.progress)}
            onLoadEnd={(event) => { webViewProps.onLoadEnd?.(event); setProgress(1); }}
            allowFileAccess={allowAccess}
            allowFileAccessFromFileURLs={allowAccess}
            allowUniversalAccessFromFileURLs={Platform.OS === 'android' && allowAccess}
            hideKeyboardAccessoryView={hiddenDone}
            contentInsetAdjustmentBehavior="never"
            automaticallyAdjustContentInsets={false}
          />
        </View>
        <SnapshotOverlay values={webViewValues} />
        {showProgress && progress < 1 && <View pointerEvents="none" style={[styles.progress, { width: `${Math.max(0.02, progress) * 100}%`, backgroundColor: theme.navColor }]} />}
        {moreShow && (
          <View style={StyleSheet.absoluteFill}>
            <Pressable accessibilityLabel="关闭菜单" onPress={() => setMoreShow(false)} style={StyleSheet.absoluteFill} />
            <View style={styles.menuArrow} />
            <View style={styles.menu}>
              {menuItems.map((item, index) => (
                <Pressable key={item.action} accessibilityRole="button" onPress={() => menuAction(item.action)} style={[styles.menuItem, index > 0 && styles.menuLine]}>
                  <Text allowFontScaling={false} style={styles.menuText}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </KeyboardInset>
    </SafeAreaView>
  );

  return (
    <>
      <Stack.Screen options={Platform.OS === 'ios' ? {
        gestureEnabled: swipeBack,
        // iOS 26 默认开启全屏返回，必须显式保留旧壳的边缘默认值。
        fullScreenGestureEnabled: swipeBack && swipeFullBack,
      } : {}} />
      <SwipeBack enabled={swipeBack && isFocused} backgroundColor={theme.backgroundColor} onClose={onSwipeClose}>
        {content}
      </SwipeBack>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  navbar: { height: 48, flexDirection: 'row', alignItems: 'center' },
  navButton: { width: 56, height: 48, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 38, lineHeight: 42 },
  moreIcon: { fontSize: 18, letterSpacing: 2 },
  // 导航栏与菜单 Text 均 allowFontScaling=false：对齐 eeui 原生 header 的固定字号
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
  progress: { position: 'absolute', top: 0, left: 0, height: 2 },
  menuArrow: { position: 'absolute', top: 0, right: 22, borderLeftWidth: 8, borderRightWidth: 8, borderBottomWidth: 10, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#464646' },
  menu: { position: 'absolute', top: 10, right: 10, width: 160, borderRadius: 7, backgroundColor: '#464646', overflow: 'hidden' },
  menuItem: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 10 },
  menuLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#333333' },
  menuText: { color: '#ffffff', fontSize: 15, textAlign: 'center' },
});
