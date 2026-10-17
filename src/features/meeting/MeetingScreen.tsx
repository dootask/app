import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BackHandler, FlatList, Image, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { RenderModeType, RtcSurfaceView, RtcTextureView, VideoSourceType } from 'react-native-agora';
import { SafeAreaView } from 'react-native-safe-area-context';

import { meetingEvent } from './events';
import type { Participant } from './participants';
import { findMeeting } from './registry';
import type { MeetingSession, MeetingSnapshot } from './session';
import { meetingStrings } from './strings';

function closeRoute() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

function ParticipantTile({ participant, snapshot, session }: { participant: Participant; snapshot: MeetingSnapshot; session: MeetingSession }) {
  const VideoView = Platform.OS === 'android' ? RtcTextureView : RtcSurfaceView;
  const name = participant.username || participant.uuid;
  const video = participant.local ? snapshot.video && participant.video : participant.video;
  return (
    <View style={styles.tile}>
      {snapshot.engineReady && snapshot.foreground && (
        <VideoView
          style={StyleSheet.absoluteFill}
          canvas={{
            uid: participant.local ? 0 : participant.uid,
            sourceType: participant.local ? VideoSourceType.VideoSourceCameraPrimary : VideoSourceType.VideoSourceRemote,
            renderMode: RenderModeType.RenderModeHidden,
          }}
        />
      )}
      {(!video || !snapshot.foreground) && (
        <View style={styles.avatar}>
          {participant.avatar ? <Image source={{ uri: participant.avatar }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            : <Text style={styles.initial}>{name.slice(0, 1)}</Text>}
        </View>
      )}
      <View style={styles.tileStatus} pointerEvents="none">
        <Text style={styles.white}>{participant.audio ? '🎙' : '🎙×'} {video ? '▣' : '▣×'}</Text>
      </View>
      <View style={styles.caption} pointerEvents="none">
        <View style={[styles.indicator, (participant.audioState > 2 || participant.videoState > 2) && styles.unstable]} />
        <Text style={styles.name} numberOfLines={1}>{name}{participant.local ? ` (${session.strings.me})` : ''}</Text>
      </View>
    </View>
  );
}

function Control({ label, icon, onPress, active = false, disabled = false, danger = false, toggle = false }: {
  label: string; icon: string; onPress(): void; active?: boolean; disabled?: boolean; danger?: boolean; toggle?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={toggle ? 'switch' : 'button'} accessibilityLabel={label}
      accessibilityState={{ disabled, ...(toggle ? { checked: active } : {}) }}
      disabled={disabled} onPress={onPress}
      style={[styles.control, active && styles.activeControl, danger && styles.leaveControl, disabled && styles.disabled]}
    >
      <Text style={styles.controlIcon}>{icon}</Text>
      <Text style={styles.controlLabel} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

function LiveMeeting({ session }: { session: MeetingSession }) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const { width } = useWindowDimensions();
  const columns = width >= 700 ? 3 : 2;
  const strings = session.strings;
  const closing = useRef(false);
  const disablePrevention = usePreventRemove(!session.ended && !snapshot.minimized, () => session.confirmLeave());

  useEffect(() => session.attachRoute(), [session]);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { session.confirmLeave(); return true; });
    return () => subscription.remove();
  }, [session]));
  useEffect(() => {
    if ((snapshot.phase === 'ended' || snapshot.minimized) && !closing.current) {
      closing.current = true;
      disablePrevention();
      closeRoute();
    }
  }, [disablePrevention, snapshot.phase, snapshot.minimized]);

  const joined = snapshot.phase === 'joined' || snapshot.phase === 'reconnecting';
  const disabled = !joined || snapshot.busy;
  const minimize = () => session.setMinimized(true);
  return (
    <>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={2}>{session.params.name || strings.meeting}</Text>
        <Text style={styles.count}>{snapshot.participants.length}</Text>
      </View>
      {snapshot.phase === 'joining' && <Text accessibilityLiveRegion="polite" style={styles.notice}>{strings.joining}</Text>}
      {snapshot.phase === 'reconnecting' && <Text accessibilityLiveRegion="polite" style={styles.notice}>{strings.reconnecting}</Text>}
      {!!snapshot.notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{snapshot.notice}</Text>}
      <FlatList
        key={columns} data={snapshot.participants} numColumns={columns}
        style={styles.grid} contentContainerStyle={styles.gridContent}
        keyExtractor={(item) => item.uuid} extraData={snapshot}
        removeClippedSubviews={false}
        renderItem={({ item }) => (
          <View style={{ width: `${100 / columns}%`, padding: 5 }}>
            <ParticipantTile participant={item} session={session} snapshot={snapshot} />
          </View>
        )}
      />
      <View style={styles.controls}>
        <Control label={strings.microphone} icon={snapshot.audio ? '🎙' : '🎙×'} toggle active={snapshot.audio} disabled={disabled} onPress={() => { void session.toggle('audio'); }} />
        <Control label={strings.camera} icon={snapshot.video ? '▣' : '▣×'} toggle active={snapshot.video} disabled={disabled} onPress={() => { void session.toggle('video'); }} />
        <Control label={strings.switchCamera} icon="↻" disabled={disabled || !snapshot.video} onPress={() => session.switchCamera()} />
        <Control label={strings.speaker} icon={snapshot.speaker ? '🔊' : '◖'} toggle active={snapshot.speaker} disabled={disabled} onPress={() => session.toggleSpeaker()} />
      </View>
      <View style={styles.controls}>
        <Control label={strings.invite} icon="＋" disabled={!joined} onPress={() => { minimize(); session.send(meetingEvent('invent', session.params.meetingid)); }} />
        <Control label={strings.minimize} icon="↘" disabled={!joined} onPress={minimize} />
        <Control label={strings.leave} icon="⏻" danger onPress={() => session.confirmLeave()} />
      </View>
    </>
  );
}

export default function MeetingScreen() {
  const { meetingPage, meetingRequest } = useLocalSearchParams();
  const [session] = useState(() => findMeeting(meetingPage, meetingRequest));
  const strings = session?.strings ?? meetingStrings('');
  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false }} />
      <StatusBar style="light" />
      {session ? <LiveMeeting session={session} /> : (
        <View style={styles.expired}>
          <Text style={styles.white}>{strings.expired}</Text>
          <Pressable accessibilityRole="button" onPress={closeRoute} style={styles.expiredButton}><Text style={styles.white}>{strings.close}</Text></Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111827' },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 16 },
  title: { flex: 1, color: '#fff', fontSize: 22, fontWeight: '600' },
  count: { color: '#cbd5e1', fontSize: 16 },
  notice: { color: '#fbbf24', paddingHorizontal: 20, paddingBottom: 10, fontSize: 14 },
  grid: { flex: 1 }, gridContent: { paddingHorizontal: 10, paddingBottom: 16 },
  tile: { aspectRatio: 1, overflow: 'hidden', borderRadius: 12, backgroundColor: '#334155' },
  avatar: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: '#334155' },
  initial: { color: '#e2e8f0', fontSize: 48 },
  tileStatus: { position: 'absolute', right: 6, top: 6, backgroundColor: '#111827cc', borderRadius: 6, padding: 4 },
  caption: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, backgroundColor: '#111827cc' },
  indicator: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#84c56a' },
  unstable: { backgroundColor: '#ff9900' },
  name: { flex: 1, color: '#fff', fontSize: 14 }, white: { color: '#fff' },
  controls: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 10 },
  control: { flex: 1, minHeight: 72, padding: 6, borderRadius: 12, backgroundColor: '#334155', alignItems: 'center', justifyContent: 'center', gap: 4 },
  activeControl: { backgroundColor: '#166534' }, leaveControl: { backgroundColor: '#b93829' },
  controlIcon: { fontSize: 23, color: '#fff' }, controlLabel: { fontSize: 12, color: '#fff', textAlign: 'center' },
  disabled: { opacity: 0.4 },
  expired: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 20 }, expiredButton: { padding: 16 },
});
