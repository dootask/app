import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { GestureDetector, GestureHandlerRootView, GestureStateManager, usePanGesture } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

const EDGE_WIDTH = 24;
const ACTIVATION_DISTANCE = 12;
const DISTANCE_RATIO = 0.3;
const FLING_DISTANCE = 32;
const FLING_VELOCITY = 800;
const RETURN_SPRING = { damping: 24, stiffness: 240, overshootClamping: true };

interface SwipeBackProps {
  children: ReactNode;
  enabled: boolean;
  backgroundColor: string;
  onClose: () => void;
}

/** Android 子页的边缘返回；iOS 由原生 Stack 管理。 */
export function SwipeBack(props: SwipeBackProps) {
  if (Platform.OS !== 'android') return <>{props.children}</>;

  // 手势只作用于子页，在本地提供根容器，首页及其他原生页无需接入。
  return (
    <GestureHandlerRootView style={[styles.container, { backgroundColor: props.backgroundColor }]}>
      <AndroidSwipeBack {...props} />
    </GestureHandlerRootView>
  );
}

function AndroidSwipeBack({ children, enabled, onClose }: SwipeBackProps) {
  const { width } = useWindowDimensions();
  const translateX = useSharedValue(0);
  const startOffset = useSharedValue(0);
  const closing = useSharedValue(false);
  const activeRef = useRef(false);

  useEffect(() => {
    activeRef.current = enabled;
    if (enabled) {
      cancelAnimation(translateX);
      translateX.set(0);
      closing.set(false);
    } else if (!closing.get()) {
      translateX.set(withSpring(0, RETURN_SPRING));
    }
    return () => {
      activeRef.current = false;
      cancelAnimation(translateX);
    };
  }, [enabled, width, translateX, closing]);

  const close = useCallback(() => {
    // 失焦或卸载后到达 JS 线程的旧事件不能关闭后续页面。
    if (activeRef.current) onClose();
  }, [onClose]);

  const pan = usePanGesture({
    enabled,
    // 限制原生识别区域，不放覆盖 WebView 的透明触摸层。
    hitSlop: { left: 0, width: EDGE_WIDTH },
    shouldCancelWhenOutside: false,
    activeOffsetX: ACTIVATION_DISTANCE,
    failOffsetX: -8,
    failOffsetY: [-ACTIVATION_DISTANCE, ACTIVATION_DISTANCE],
    maxPointers: 1,
    onTouchesDown: (event) => {
      'worklet';
      if (closing.get() || event.numberOfTouches !== 1) GestureStateManager.fail(event.handlerTag);
    },
    onActivate: () => {
      'worklet';
      cancelAnimation(translateX);
      startOffset.set(translateX.get());
    },
    onUpdate: (event) => {
      'worklet';
      translateX.set(Math.min(width, Math.max(0, startOffset.get() + event.translationX)));
    },
    onDeactivate: (event) => {
      'worklet';
      // 系统接管边缘触摸会取消手势，此时只回弹，不再发起一次返回。
      if (event.canceled) return;
      const distance = Math.max(0, startOffset.get() + event.translationX);
      const passedDistance = distance >= width * DISTANCE_RATIO && event.velocityX >= 0;
      const flungRight = event.translationX >= FLING_DISTANCE
        && event.velocityX >= FLING_VELOCITY
        && event.velocityX > Math.abs(event.velocityY);
      if (passedDistance || flungRight) {
        closing.set(true);
        // 成功后交给 Stack 完成关闭转场，复用导航按钮的关闭及生命周期逻辑。
        runOnJS(close)();
      }
    },
    onFinalize: () => {
      'worklet';
      if (!closing.get()) translateX.set(withSpring(0, RETURN_SPRING));
    },
  });
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.get() }] }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View collapsable={false} style={[styles.container, animatedStyle]}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
