import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Image, Keyboard, PanResponder, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '../../bridge/messages/theme';
import { activeMeeting, showMeeting } from './registry';
import { subscribeMeetingChange } from './runtime';
import type { MeetingSession } from './session';

const WIDTH = 80;
const HEIGHT = 36;

/** 挂在根布局 Stack 后面；缩小/邀请时让 WebView 继续接收触摸。 */
export default function MeetingOverlay() {
  const session = useSyncExternalStore(subscribeMeetingChange, activeMeeting, () => null);
  return session ? <MeetingBubble key={session.serviceId} session={session} /> : null;
}

function MeetingBubble({ session }: { session: MeetingSession }) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { themeName } = useAppTheme();
  const [position, setPosition] = useState(() => {
    const saved = session.page.state.get('meeting.miniPosition') as { x: number; y: number } | undefined;
    return saved ?? { x: width - WIDTH - 12, y: insets.top + 80 };
  });
  const current = useRef(position);
  const origin = useRef(position);
  const maxX = Math.max(12, width - WIDTH - 12);
  const minY = insets.top + 8;
  const maxY = Math.max(minY, height - HEIGHT - insets.bottom - 8);

  const panResponder = useMemo(() => {
    const clamp = (x: number, y: number) => ({ x: Math.max(12, Math.min(maxX, x)), y: Math.max(minY, Math.min(maxY, y)) });
    const move = (x: number, y: number) => {
      current.current = clamp(x, y);
      setPosition(current.current);
    };
    const snap = () => {
      move(current.current.x < maxX / 2 ? 12 : maxX, current.current.y);
      session.page.state.set('meeting.miniPosition', current.current);
    };
    // PanResponder 仅保存事件函数，手势发生前不会读取 ref。
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_event, gesture) => Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6,
      onPanResponderGrant: () => { origin.current = current.current; },
      onPanResponderMove: (_event, gesture) => move(origin.current.x + gesture.dx, origin.current.y + gesture.dy),
      onPanResponderRelease: snap,
      onPanResponderTerminate: snap,
    });
  }, [maxX, minY, maxY, session]);

  useEffect(() => {
    current.current = { x: Math.max(12, Math.min(maxX, current.current.x)), y: Math.max(minY, Math.min(maxY, current.current.y)) };
    setPosition(current.current);
  }, [maxX, minY, maxY]);

  if (!snapshot.minimized || snapshot.phase === 'ended') return null;
  return (
    <View pointerEvents="box-none" style={styles.host}>
      <View {...panResponder.panHandlers} style={[styles.bubble, themeName === 'dark' && styles.darkBubble, { left: position.x, top: position.y }]}>
        <Pressable
          accessibilityRole="button" accessibilityLabel={session.strings.restore}
          onPress={() => { Keyboard.dismiss(); showMeeting(session); }} style={styles.button}
        >
          <Image source={snapshot.audio ? require('../../../assets/meeting/meeting_white_audio_on.png') : require('../../../assets/meeting/meeting_white_audio_off.png')} style={styles.icon} resizeMode="contain" accessible={false} />
          <Image source={snapshot.video ? require('../../../assets/meeting/meeting_white_video_on.png') : require('../../../assets/meeting/meeting_white_video_off.png')} style={styles.icon} resizeMode="contain" accessible={false} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { ...StyleSheet.absoluteFill, zIndex: 100, elevation: 100 },
  bubble: { position: 'absolute', width: WIDTH, height: HEIGHT, borderRadius: 6, backgroundColor: '#A1A1A1', overflow: 'hidden', elevation: 12 },
  darkBubble: { backgroundColor: '#404040' },
  button: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  icon: { width: 20, height: 20 },
});
