import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { AppState, Appearance, Dimensions, Keyboard, PixelRatio, Platform } from 'react-native';
import { useIsFocused } from 'expo-router';
import { initialWindowMetrics, type EdgeInsets } from 'react-native-safe-area-context';

import { FIRST_PAGE_NAME } from '../config';
import { SAFE_AREA_KEY } from './modules/eeui/device';
import { getPage, invokeWindowAll } from './pages';
import { bridgeStore } from './store';

export function useThemeName() {
  const [themeName, setThemeName] = useState(bridgeStore.themeName);
  useEffect(
    () =>
      bridgeStore.subscribe((patch) => {
        if (patch.themeName) setThemeName(patch.themeName);
      }),
    [],
  );
  return themeName;
}

export function useAppActive() {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

/**
 * 页面激活状态 = 当前路由聚焦 && App 在前台（与 eeui Activity onResume/onPause 语义一致）。
 * 首次激活也会触发 onResume。
 */
export function usePageActive(onResume: () => void, onPause: () => void) {
  const focused = useIsFocused();
  const appActive = useAppActive();
  const active = focused && appActive;
  const last = useRef<boolean | null>(null);
  const resume = useEffectEvent(onResume);
  const pause = useEffectEvent(onPause);

  useEffect(() => {
    if (last.current === active) return;
    const prev = last.current;
    last.current = active;
    if (active) resume();
    // Android 进入后台由原生模块 page-lifecycle 当场执行 __onPagePause（此时 Fabric 已暂停，injectJavaScript 要等回前台才执行）
    else if (prev !== null && !(Platform.OS === 'android' && focused && !appActive)) pause();
  }, [active, focused, appActive]);
}

/**
 * 全局运行时：系统主题、键盘、前后台 → 写入桥状态并通知所有 WebView。
 * 在根布局调用一次。
 */
export function useBridgeRuntime() {
  useEffect(() => {
    const appearanceSub = Appearance.addChangeListener(({ colorScheme }) => {
      bridgeStore.setThemeName(colorScheme === 'dark' ? 'dark' : 'light');
    });

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    // 前端按旧壳单位比较阈值（keyboardHeight > 120）：iOS 按屏宽 750 换算并截断，Android 为物理 px（RN 已扣除导航栏）
    const legacyHeight = (height: number) => Platform.OS === 'ios'
      ? Math.trunc(height * 750 / Dimensions.get('screen').width)
      : PixelRatio.getPixelSizeForLayoutSize(height);
    let lastVisible = false;
    const notifyKeyboard = (visible: boolean, height: number) => {
      bridgeStore.setKeyboard({ visible, height });
      // 旧 Android 只在显隐切换时上报；iOS 每次 Will 通知都上报（候选栏等高度变化）
      if (Platform.OS === 'android' && visible === lastVisible) return;
      lastVisible = visible;
      // 旧壳只有首页 index.vue 转发该事件，子页（web.vue）不转发
      const page = getPage(FIRST_PAGE_NAME);
      if (!page) return;
      // 旧壳同时附带安全区（单位同 keyboardHeight）
      const insets = (page.state.get(SAFE_AREA_KEY) as EdgeInsets | undefined) ?? initialWindowMetrics?.insets;
      page.invokeWindow('__onKeyboardStatus', {
        keyboardType: visible ? 'show' : 'hide',
        keyboardHeight: visible ? legacyHeight(height) : 0,
        safeAreaTop: legacyHeight(insets?.top ?? 0),
        safeAreaBottom: legacyHeight(insets?.bottom ?? 0),
      });
    };
    const showSub = Keyboard.addListener(showEvent, (e) => notifyKeyboard(true, Math.round(e.endCoordinates.height)));
    const hideSub = Keyboard.addListener(hideEvent, () => notifyKeyboard(false, 0));

    let lastState = AppState.currentState;
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === lastState) return;
      const wasActive = lastState === 'active';
      lastState = state;
      if (state === 'active') invokeWindowAll('__onAppActive');
      else if (wasActive) invokeWindowAll('__onAppDeactive');
    });

    return () => {
      appearanceSub.remove();
      showSub.remove();
      hideSub.remove();
      appStateSub.remove();
    };
  }, []);
}
