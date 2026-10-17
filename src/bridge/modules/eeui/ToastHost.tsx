import { useEffect, useSyncExternalStore } from 'react';
import { Dimensions, PixelRatio, Platform, StyleSheet, Text, ToastAndroid, View } from 'react-native';

import { bridgeStore } from '../../store';

const TOAST_KEY = 'eeui.toast';

interface ToastRequest {
  message: string;
  gravity: 'top' | 'middle' | 'bottom';
  messageColor: string;
  backgroundColor: string;
  x: number;
  y: number;
  expiresAt: number;
}

const subscribe = (listener: () => void) => bridgeStore.subscribe((patch) => {
  if (patch.variates && TOAST_KEY in patch.variates) listener();
});
const getToast = () => bridgeStore.getVariate<ToastRequest | null>(TOAST_KEY, null) ?? null;

export function showToast(options: unknown) {
  if (options == null) return;
  const data = typeof options === 'object' ? options as Record<string, unknown> : { message: options };
  const message = String(data.message ?? '');
  const gravity = data.gravity === 'top' ? 'top'
    : data.gravity === 'middle' || data.gravity === 'center' ? 'middle' : 'bottom';
  const x = Number(data.x) || 0;
  const y = Number(data.y) || 0;
  if (Platform.OS === 'android') {
    const position = gravity === 'top' ? ToastAndroid.TOP : gravity === 'middle' ? ToastAndroid.CENTER : ToastAndroid.BOTTOM;
    // 旧 Android 的偏移量是 750 设计宽度，ToastAndroid 接收物理像素。
    const scale = Dimensions.get('screen').width * PixelRatio.get() / 750;
    ToastAndroid.showWithGravityAndOffset(
      message, data.long ? ToastAndroid.LONG : ToastAndroid.SHORT, position,
      Math.trunc(x * scale), Math.trunc(y * scale),
    );
    return;
  }
  bridgeStore.setVariate(TOAST_KEY, {
    message,
    gravity,
    messageColor: typeof data.messageColor === 'string' ? data.messageColor : '#ffffff',
    backgroundColor: typeof data.backgroundColor === 'string' ? data.backgroundColor : '#000000',
    x,
    y,
    expiresAt: Date.now() + (data.long ? 3500 : 1800),
  } satisfies ToastRequest);
}

/** 由集成方在根布局的 Stack 后挂载一次，覆盖所有页面且不阻拦触摸。 */
export function ToastHost() {
  const toast = useSyncExternalStore(subscribe, getToast, getToast);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      if (getToast() === toast) bridgeStore.setVariate(TOAST_KEY, null);
    }, Math.max(0, toast.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [toast]);

  if (Platform.OS === 'android' || !toast) return null;
  return (
    <View
      pointerEvents="none"
      style={[styles.host, { justifyContent: toast.gravity === 'top' ? 'flex-start' : toast.gravity === 'middle' ? 'center' : 'flex-end' }]}
    >
      <Text
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.toast, {
          color: toast.messageColor,
          backgroundColor: toast.backgroundColor,
          transform: [{ translateX: toast.x }, { translateY: toast.y }],
        }]}
      >{toast.message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', paddingVertical: 60, paddingHorizontal: 30, zIndex: 10000 },
  toast: { minWidth: 200, maxWidth: '100%', minHeight: 30, padding: 10, borderRadius: 7, overflow: 'hidden', fontSize: 12, textAlign: 'center' },
});
