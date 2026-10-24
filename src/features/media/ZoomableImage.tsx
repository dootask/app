import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import {
  GestureDetector, useCompetingGestures, useExclusiveGestures, usePanGesture, usePinchGesture,
  useSimultaneousGestures, useTapGesture,
} from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';

import {
  constrainZoom, containSize, dismissProgress, dismissScale, doubleTapZoom, pinchZoom, shouldDismiss,
  type Size, type Zoom,
} from './zoom';
import type { mediaStrings } from './strings';

const RETURN_SPRING = { damping: 24, stiffness: 240, overshootClamping: true };
/** 点击允许的最大移动距离；RNGH 在 Android 上默认不限制，快速横滑翻页会被识别成单击而关闭预览。 */
const TAP_MAX_DIST = 10;

interface Props {
  uri: string;
  viewport: Size;
  active: boolean;
  /** 下拉关闭进度（0–1），由外层用于背景与指示器的透明度。 */
  dismiss: SharedValue<number>;
  onZoomChange: (zoomed: boolean) => void;
  onClose: () => void;
  strings: ReturnType<typeof mediaStrings>;
}

export default function ZoomableImage({ uri, viewport, active, dismiss, onZoomChange, onClose, strings }: Props) {
  const [imageSize, setImageSize] = useState<Size>({ width: 0, height: 0 });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const fitted = useMemo(() => containSize(imageSize, viewport), [imageSize, viewport]);

  const scale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const start = useSharedValue<Zoom>({ scale: 1, x: 0, y: 0 });
  const focal = useSharedValue({ x: 0, y: 0 });
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);

  const updateZoomed = useCallback((value: boolean) => {
    setZoomed(value);
    onZoomChange(value);
  }, [onZoomChange]);

  // 翻到其他页时复位缩放，回来时从原始大小开始。
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setZoomed(false);
  }
  useEffect(() => {
    if (active) return;
    scale.set(1); x.set(0); y.set(0); dragX.set(0); dragY.set(0);
  }, [active, scale, x, y, dragX, dragY]);

  const animateTo = (zoom: Zoom) => {
    'worklet';
    scale.set(withTiming(zoom.scale));
    x.set(withTiming(zoom.x));
    y.set(withTiming(zoom.y));
  };

  const pinch = usePinchGesture({
    onActivate: (event) => {
      'worklet';
      start.set({ scale: scale.get(), x: x.get(), y: y.get() });
      focal.set({ x: event.focalX - viewport.width / 2, y: event.focalY - viewport.height / 2 });
      // 双指期间先锁住外层翻页，避免缩放时页面横向滚动。
      runOnJS(onZoomChange)(true);
    },
    onUpdate: (event) => {
      'worklet';
      const to = { x: event.focalX - viewport.width / 2, y: event.focalY - viewport.height / 2 };
      const next = constrainZoom(pinchZoom(start.get(), focal.get(), to, event.scale), fitted, viewport);
      scale.set(next.scale); x.set(next.x); y.set(next.y);
    },
    onDeactivate: () => {
      'worklet';
      const next = constrainZoom({ scale: scale.get(), x: x.get(), y: y.get() }, fitted, viewport);
      const isZoomed = next.scale > 1.05;
      animateTo(isZoomed ? next : { scale: 1, x: 0, y: 0 });
      runOnJS(updateZoomed)(isZoomed);
    },
  });

  // 未放大时只接管明显的竖向拖动（下拉关闭），横向留给外层翻页；放大后任意方向拖动查看。
  const pan = usePanGesture({
    maxPointers: 1,
    // Worklets 插件不支持在手势配置里展开对象，按属性逐个取值。
    minDistance: zoomed ? 4 : undefined,
    activeOffsetY: zoomed ? undefined : [-12, 12],
    failOffsetX: zoomed ? undefined : [-20, 20],
    onActivate: () => {
      'worklet';
      start.set({ scale: scale.get(), x: x.get(), y: y.get() });
    },
    onUpdate: (event) => {
      'worklet';
      if (scale.get() > 1.01) {
        const origin = start.get();
        const next = constrainZoom({ ...origin, x: origin.x + event.translationX, y: origin.y + event.translationY }, fitted, viewport);
        x.set(next.x); y.set(next.y);
        return;
      }
      // 向上拖动加阻尼，只有向下才计入关闭进度。
      dragX.set(event.translationX);
      dragY.set(event.translationY > 0 ? event.translationY : event.translationY * 0.3);
      dismiss.set(dismissProgress(event.translationY));
    },
    onDeactivate: (event) => {
      'worklet';
      if (scale.get() > 1.01) return;
      if (!event.canceled && shouldDismiss(event.translationY, event.velocityY)) {
        runOnJS(onClose)();
        return;
      }
      dragX.set(withSpring(0, RETURN_SPRING));
      dragY.set(withSpring(0, RETURN_SPRING));
      dismiss.set(withSpring(0, RETURN_SPRING));
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    maxDistance: TAP_MAX_DIST,
    onActivate: (event) => {
      'worklet';
      const point = { x: event.x - viewport.width / 2, y: event.y - viewport.height / 2 };
      const next = doubleTapZoom({ scale: scale.get(), x: x.get(), y: y.get() }, point, fitted, viewport);
      animateTo(next);
      runOnJS(updateZoomed)(next.scale > 1.01);
    },
  });

  // 与微信一致：单击（排除双击后）直接关闭。
  const singleTap = useTapGesture({
    maxDistance: TAP_MAX_DIST,
    onActivate: () => {
      'worklet';
      runOnJS(onClose)();
    },
  });

  const gesture = useCompetingGestures(
    useSimultaneousGestures(pinch, pan),
    useExclusiveGestures(doubleTap, singleTap),
  );

  const animatedStyle = useAnimatedStyle(() => {
    const shrink = dismissScale(dismiss.get());
    return {
      transform: [
        { translateX: x.get() + dragX.get() },
        { translateY: y.get() + dragY.get() },
        { scale: scale.get() * shrink },
      ],
    };
  });

  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false} style={[styles.root, viewport]}>
        <Animated.View style={[{ width: fitted.width, height: fitted.height }, animatedStyle]}>
          <Image
            source={{ uri }} contentFit="contain" recyclingKey={uri} style={StyleSheet.absoluteFill}
            onLoad={(event) => {
              setImageSize({ width: event.source.width, height: event.source.height });
              setLoading(false);
            }}
            onError={() => { setFailed(true); setLoading(false); }}
            accessible accessibilityLabel={strings.image}
          />
        </Animated.View>
        {loading && <ActivityIndicator pointerEvents="none" style={styles.indicator} color="#fff" />}
        {failed && <Text pointerEvents="none" style={styles.message}>{strings.failed}</Text>}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  indicator: { position: 'absolute', alignSelf: 'center', top: '48%' },
  message: { position: 'absolute', alignSelf: 'center', top: '48%', color: '#fff' },
});
