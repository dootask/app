import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, PanResponder, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import { constrainZoom, containSize, pinchZoom, type Point, type Size, type Zoom } from './zoom';
import type { mediaStrings } from './strings';

interface Props {
  uri: string;
  viewport: Size;
  active: boolean;
  onZoomChange: (zoomed: boolean) => void;
  strings: ReturnType<typeof mediaStrings>;
}

function touchPosition(event: GestureResponderEvent, viewport: Size) {
  const touches = event.nativeEvent.touches;
  if (!touches.length) return null;
  const first = touches[0];
  const second = touches[1] ?? first;
  return {
    count: touches.length,
    center: { x: (first.locationX + second.locationX - viewport.width) / 2, y: (first.locationY + second.locationY - viewport.height) / 2 },
    distance: Math.hypot(second.pageX - first.pageX, second.pageY - first.pageY),
  };
}

export default function ZoomableImage({ uri, viewport, active, onZoomChange, strings }: Props) {
  const [imageSize, setImageSize] = useState<Size>(viewport);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const fitted = useMemo(() => containSize(imageSize, viewport), [imageSize, viewport]);
  const zoom = useRef<Zoom>({ scale: 1, x: 0, y: 0 });
  const start = useRef<{ zoom: Zoom; center: Point; distance: number; count: number } | null>(null);
  const [scale] = useState(() => new Animated.Value(1));
  const [translation] = useState(() => new Animated.ValueXY());

  const apply = useCallback((next: Zoom, pinching = false) => {
    const value = constrainZoom(next, fitted, viewport);
    zoom.current = value;
    scale.setValue(value.scale);
    translation.setValue({ x: value.x, y: value.y });
    const isZoomed = value.scale > 1.01;
    setZoomed(isZoomed);
    if (active) onZoomChange(isZoomed || pinching);
  }, [fitted, viewport, scale, translation, onZoomChange, active]);

  const reset = useCallback(() => {
    start.current = null;
    apply({ scale: 1, x: 0, y: 0 });
  }, [apply]);

  const responder = useMemo(() => {
    function begin(event: GestureResponderEvent) {
      const touch = touchPosition(event, viewport);
      start.current = touch ? { ...touch, zoom: { ...zoom.current } } : null;
      onZoomChange(true);
    }
    function end() {
      start.current = null;
      apply(zoom.current);
    }
    // PanResponder.create 只保存这些事件函数，不会在 render 期间调用它们。
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onStartShouldSetPanResponder: (event) => event.nativeEvent.touches.length > 1 || zoom.current.scale > 1.01,
      onStartShouldSetPanResponderCapture: (event) => event.nativeEvent.touches.length > 1,
      onMoveShouldSetPanResponderCapture: (event) => event.nativeEvent.touches.length > 1 || zoom.current.scale > 1.01,
      onPanResponderGrant: begin,
      onPanResponderStart: begin,
      onPanResponderMove: (event) => {
        const touch = touchPosition(event, viewport);
        if (!touch) return;
        const previous = start.current;
        if (!previous || previous.count !== touch.count) { begin(event); return; }
        const ratio = touch.count > 1 && previous.distance > 0 ? touch.distance / previous.distance : 1;
        apply(pinchZoom(previous.zoom, previous.center, touch.center, ratio), touch.count > 1);
      },
      onPanResponderEnd: (event) => { if (event.nativeEvent.touches.length) begin(event); },
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
      onPanResponderTerminationRequest: () => false,
    });
  }, [apply, onZoomChange, viewport]);

  return (
    <View style={[styles.root, viewport]}>
      <View style={styles.gesture} {...responder.panHandlers}>
        <Animated.Image
          pointerEvents="none" source={{ uri }} resizeMode="contain"
          style={{ width: fitted.width, height: fitted.height, transform: [{ translateX: translation.x }, { translateY: translation.y }, { scale }] }}
          onLoad={(event) => {
            setImageSize({ width: event.nativeEvent.source.width, height: event.nativeEvent.source.height });
            setLoading(false);
          }}
          onError={() => { setFailed(true); setLoading(false); }}
          accessible accessibilityLabel={strings.image}
        />
      </View>
      {loading && <ActivityIndicator pointerEvents="none" style={styles.indicator} color="#fff" />}
      {failed && <Text style={styles.message}>{strings.failed}</Text>}
      {zoomed && <Pressable accessibilityRole="button" style={styles.reset} onPress={reset}>
        <Text style={styles.text}>{strings.reset}</Text>
      </Pressable>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { overflow: 'hidden', backgroundColor: '#000' },
  gesture: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  indicator: { position: 'absolute', alignSelf: 'center', top: '48%' },
  message: { position: 'absolute', alignSelf: 'center', top: '48%', color: '#fff' },
  reset: { position: 'absolute', right: 20, bottom: 20, backgroundColor: '#333c', borderRadius: 8, padding: 12 },
  text: { color: '#fff' },
});
