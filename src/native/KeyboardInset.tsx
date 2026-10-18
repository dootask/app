import type { ReactNode } from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * WebView 外层的键盘避让容器。
 *
 * - Android：eeui 用 adjustResize 让窗口随键盘缩小；SDK 58 强制 edge-to-edge 后系统不再缩小窗口，
 *   这里按键盘与自身底部的重叠量补 padding，并跟随键盘动画逐帧变化。
 *   automaticOffset 按屏幕坐标计算，子页位于状态栏与导航条下方时也不会少抬。
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
    <KeyboardAvoidingView enabled={enabled} behavior="padding" automaticOffset keyboardVerticalOffset={edgeToEdge ? -insets.bottom : 0} style={style}>
      {children}
    </KeyboardAvoidingView>
  );
}
