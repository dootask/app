import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Keyboard, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { activeMeeting, showMeeting } from './registry';
import { subscribeMeetingChange } from './runtime';
import type { MeetingSession } from './session';

const WIDTH = 190;
const HEIGHT = 76;

/** 挂在根布局 Stack 后面；缩小/邀请时让 WebView 继续接收触摸。 */
export default function MeetingOverlay() {
  const session = useSyncExternalStore(subscribeMeetingChange, activeMeeting, () => null);
  return session ? <MeetingBubble key={session.serviceId} session={session} /> : null;
}

function MeetingBubble({ session }: { session: MeetingSession }) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
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
      <View {...panResponder.panHandlers} style={[styles.bubble, { left: position.x, top: position.y }]}>
        <Pressable
          accessibilityRole="button" accessibilityLabel={session.strings.restore}
          onPress={() => { Keyboard.dismiss(); showMeeting(session); }} style={styles.button}
        >
          <Text style={styles.name} numberOfLines={1}>{session.params.name || session.strings.meeting}</Text>
          <Text style={styles.media}>{snapshot.audio ? '🎙' : '🎙×'}　{snapshot.video ? '▣' : '▣×'}　↗</Text>
          <Text style={styles.hint} numberOfLines={1}>{session.strings.restore}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { ...StyleSheet.absoluteFill, zIndex: 100, elevation: 100 },
  bubble: { position: 'absolute', width: WIDTH, height: HEIGHT, borderRadius: 12, backgroundColor: '#166534', overflow: 'hidden', elevation: 12 },
  button: { flex: 1, justifyContent: 'center', paddingHorizontal: 12, gap: 2 },
  name: { color: '#fff', fontSize: 13, fontWeight: '600' },
  media: { color: '#fff', fontSize: 17 }, hint: { color: '#dcfce7', fontSize: 11 },
});
