import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { VideoView, useVideoPlayer } from 'expo-video';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { PictureRequest } from './requests';
import { mediaStrings } from './strings';
import { closeMediaRoute, useMediaActive, useMediaRoute } from './useMediaRoute';
import ZoomableImage from './ZoomableImage';
import { dismissProgress, dismissScale, shouldDismiss, type Size } from './zoom';

const RETURN_SPRING = { damping: 24, stiffness: 240, overshootClamping: true };
/** 超过该数量时圆点过密，改为“当前/总数”文字。 */
const MAX_DOTS = 9;

/** 下拉、单击等多个入口可能同时触发关闭，只执行一次。 */
function useCloseOnce() {
  const closed = useRef(false);
  return useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    closeMediaRoute();
  }, []);
}

function Indicator({ count, position, dismiss }: { count: number; position: number; dismiss: SharedValue<number> }) {
  const insets = useSafeAreaInsets();
  const style = useAnimatedStyle(() => ({ opacity: 1 - dismiss.get() }));
  if (count < 2) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.indicatorBar, { bottom: insets.bottom + 20 }, style]}>
      {count > MAX_DOTS
        ? <Text style={styles.counter} accessibilityLiveRegion="polite">{position + 1} / {count}</Text>
        : Array.from({ length: count }, (_item, index) => (
          <View key={index} style={[styles.dot, index === position && styles.dotActive]} />
        ))}
    </Animated.View>
  );
}

function PicturePreview({ request, dismiss, onClose }: { request: PictureRequest; dismiss: SharedValue<number>; onClose: () => void }) {
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [position, setPosition] = useState(request.position);
  const [pagingEnabled, setPagingEnabled] = useState(true);
  const onZoomChange = useCallback((zoomed: boolean) => setPagingEnabled(!zoomed), []);
  const strings = mediaStrings(request.language);

  return (
    <View style={styles.content} onLayout={(event) => {
      const { width, height } = event.nativeEvent.layout;
      setViewport((previous) => previous.width === width && previous.height === height ? previous : { width, height });
      setPagingEnabled(true);
    }}>
      {viewport.width > 0 && viewport.height > 0 && (
        <FlatList
          // 旋转时重建布局，初始索引取当前图，避免沿用旧页面宽度的偏移量。
          key={`${viewport.width}:${viewport.height}`}
          data={request.paths} horizontal pagingEnabled scrollEnabled={pagingEnabled}
          initialScrollIndex={position} initialNumToRender={1} maxToRenderPerBatch={2} windowSize={3}
          showsHorizontalScrollIndicator={false} bounces={false} removeClippedSubviews={false}
          keyExtractor={(_item, index) => String(index)}
          getItemLayout={(_data, index) => ({ length: viewport.width, offset: viewport.width * index, index })}
          onMomentumScrollEnd={(event) => {
            const index = Math.max(0, Math.min(request.paths.length - 1, Math.round(event.nativeEvent.contentOffset.x / viewport.width)));
            setPosition(index);
            setPagingEnabled(true);
          }}
          renderItem={({ item, index }) => (
            <ZoomableImage
              uri={item} viewport={viewport} active={position === index} dismiss={dismiss}
              onZoomChange={onZoomChange} onClose={onClose} strings={strings}
            />
          )}
        />
      )}
      <Indicator count={request.paths.length} position={position} dismiss={dismiss} />
    </View>
  );
}

function VideoPreview({ path, language, dismiss, onClose }: { path: string; language: string; dismiss: SharedValue<number>; onClose: () => void }) {
  const active = useMediaActive();
  const resume = useRef(false);
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(path, (instance) => {
    instance.loop = false;
    instance.staysActiveInBackground = false;
    if (Platform.OS === 'android') instance.play();
  });
  const [status, setStatus] = useState(player.status);
  const strings = mediaStrings(language);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);

  useEffect(() => {
    const subscription = player.addListener('statusChange', (event) => setStatus(event.status));
    return () => subscription.remove();
  }, [player]);

  useEffect(() => {
    if (active) {
      if (resume.current) player.play();
    } else {
      resume.current = player.playing;
      player.pause();
    }
  }, [active, player]);

  // 只响应向下拖动，横向留给进度条，点击留给原生播放控件。
  const pan = usePanGesture({
    maxPointers: 1,
    activeOffsetY: 12,
    failOffsetY: -12,
    failOffsetX: [-20, 20],
    onUpdate: (event) => {
      'worklet';
      dragX.set(event.translationX);
      dragY.set(Math.max(0, event.translationY));
      dismiss.set(dismissProgress(event.translationY));
    },
    onDeactivate: (event) => {
      'worklet';
      if (!event.canceled && shouldDismiss(event.translationY, event.velocityY)) {
        runOnJS(onClose)();
        return;
      }
      dragX.set(withSpring(0, RETURN_SPRING));
      dragY.set(withSpring(0, RETURN_SPRING));
      dismiss.set(withSpring(0, RETURN_SPRING));
    },
  });
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.get() }, { translateY: dragY.get() }, { scale: dismissScale(dismiss.get()) }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View collapsable={false} style={[styles.content, { paddingTop: insets.top, paddingBottom: insets.bottom }, animatedStyle]}>
        <VideoView
          player={player} style={styles.content} nativeControls contentFit="contain"
          fullscreenOptions={{ enable: false }} allowsPictureInPicture={false}
        />
        {status === 'loading' && <ActivityIndicator pointerEvents="none" style={styles.loading} color="#fff" />}
        {status === 'error' && <View pointerEvents="none" style={styles.error}><Text style={styles.text}>{strings.videoFailed}</Text></View>}
      </Animated.View>
    </GestureDetector>
  );
}

export default function PreviewScreen() {
  const handle = useMediaRoute();
  const request = handle?.request;
  const strings = mediaStrings(request && 'language' in request ? request.language : '');
  const onClose = useCloseOnce();
  const dismiss = useSharedValue(0);
  // 页面以透明模态呈现，下拉时背景变透明，露出下层页面。
  const backdropStyle = useAnimatedStyle(() => ({ opacity: 1 - dismiss.get() }));

  return (
    <GestureHandlerRootView style={styles.root} accessibilityViewIsModal onAccessibilityEscape={onClose}>
      <StatusBar style="light" />
      <Animated.View pointerEvents="none" style={[styles.backdrop, backdropStyle]} />
      {request?.kind === 'pictures' ? <PicturePreview request={request} dismiss={dismiss} onClose={onClose} />
        : request?.kind === 'video' ? <VideoPreview path={request.path} language={request.language} dismiss={dismiss} onClose={onClose} />
          : <View style={styles.error}>
            <Text style={styles.text}>{strings.expired}</Text>
            <Pressable accessibilityRole="button" onPress={onClose}><Text style={styles.button}>{strings.close}</Text></Pressable>
          </View>}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: '#000' },
  button: { color: '#fff', fontSize: 16, paddingVertical: 12 },
  text: { color: '#fff', fontSize: 16 },
  content: { flex: 1 },
  loading: { position: 'absolute', alignSelf: 'center', top: '48%' },
  error: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 16 },
  indicatorBar: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255, 255, 255, 0.4)' },
  dotActive: { backgroundColor: '#fff' },
  counter: { color: '#fff', fontSize: 14 },
});
