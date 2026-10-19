import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { findNodeHandle, Platform, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { KeyboardControllerNative, KeyboardEvents, useWindowDimensions } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * WebView 外层的键盘避让容器。
 *
 * - Android：eeui 用 adjustResize 让窗口随键盘缩小；SDK 58 强制 edge-to-edge 后系统不再缩小窗口，
 *   这里按键盘与自身底部的重叠量补 padding。与 adjustResize 一样只在键盘开始弹出/收起时一步到位：
 *   跟随键盘动画逐帧改 padding 会让 WebView 每帧重排（严重掉帧），且前端在尺寸未到位时滚动聚焦框会失效。
 *   位置用原生 viewPositionInWindow 按屏幕坐标计算，子页位于状态栏与导航条下方时也不会少抬。
 * - iOS：eeui 不改 WebView 尺寸，由 WKWebView 自行处理（前端依赖 visualViewport），保持原样。
 *
 * edgeToEdge：容器铺到底部导航栏下方、由前端自己画底部安全区占位（--navigation-bar-height）时传 true。
 * 此时少抬一个底部安全区，让占位藏到键盘后面，与 eeui 上报的 keyboardHeight = IME - safeAreaBottom 一致。
 *
 * enabled=false 对应 eeui softInputMode "nothing"（键盘覆盖内容，不做任何避让）。
 */
export function KeyboardInset({ children, style, edgeToEdge = false, enabled = true }: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  edgeToEdge?: boolean;
  enabled?: boolean;
}) {
  const insets = useSafeAreaInsets();
  if (Platform.OS !== 'android') return <View style={style}>{children}</View>;
  return (
    <AndroidKeyboardInset style={style} enabled={enabled} offset={edgeToEdge ? -insets.bottom : 0}>
      {children}
    </AndroidKeyboardInset>
  );
}

function AndroidKeyboardInset({ children, style, enabled, offset }: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  enabled: boolean;
  offset: number;
}) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  // 键盘收起时的屏幕位置（padding 不改变自身外框，键盘打开期间沿用即可）
  const frame = useRef<{ y: number; height: number } | null>(null);
  const keyboardHeight = useRef(0);
  const { height: screenHeight } = useWindowDimensions();
  const [padding, setPadding] = useState(0);

  const update = useCallback(() => {
    const current = frame.current;
    const height = keyboardHeight.current;
    if (!enabled || !current || height <= 0) return setPadding(0);
    const keyboardY = screenHeight - height - offset;
    setPadding(Math.max(Math.round(current.y + current.height - keyboardY), 0));
  }, [enabled, offset, screenHeight]);

  useEffect(() => {
    update();
    const subscriptions = [
      // 弹出时 keyboardWillShow 已带最终高度；输入法切换高度变化也会再次触发
      KeyboardEvents.addListener('keyboardWillShow', (event) => { keyboardHeight.current = event.height; update(); }),
      KeyboardEvents.addListener('keyboardDidShow', (event) => { keyboardHeight.current = event.height; update(); }),
      KeyboardEvents.addListener('keyboardWillHide', () => { keyboardHeight.current = 0; update(); }),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [update]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout;
    const tag = findNodeHandle(ref.current);
    const apply = (y: number) => {
      if (keyboardHeight.current > 0 && frame.current) return;
      frame.current = { y, height };
      update();
    };
    if (tag == null) return apply(event.nativeEvent.layout.y);
    KeyboardControllerNative.viewPositionInWindow(tag)
      .then((position) => apply(position.y))
      .catch(() => apply(event.nativeEvent.layout.y));
  }, [update]);

  return (
    <View ref={ref} collapsable={false} onLayout={onLayout} style={[style, { paddingBottom: padding }]}>
      {children}
    </View>
  );
}
