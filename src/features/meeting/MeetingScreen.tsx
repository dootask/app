import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, BackHandler, FlatList, Image, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
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
      {(!participant.audio || !video) && (
        <View style={styles.tileStatus} pointerEvents="none">
          {!participant.audio && (
            <View style={styles.statusBadge}>
              <Image source={require('../../../assets/meeting/meeting_audio_err.png')} style={styles.statusIcon} resizeMode="contain" accessible={false} />
            </View>
          )}
          {!video && (
            <View style={styles.statusBadge}>
              <Image source={require('../../../assets/meeting/meeting_video_err.png')} style={styles.statusIcon} resizeMode="contain" accessible={false} />
            </View>
          )}
        </View>
      )}
      <View style={styles.caption} pointerEvents="none">
        <View style={[styles.indicator, (participant.audioState > 2 || participant.videoState > 2) && styles.unstable]} />
        <Text style={styles.name} numberOfLines={1}>{name}{participant.local ? ` (${session.strings.me})` : ''}</Text>
      </View>
    </View>
  );
}

function Control({ label, icon, onPress, active = false, disabled = false, danger = false, toggle = false }: {
  label: string; icon: ImageSourcePropType; onPress(): void; active?: boolean; disabled?: boolean; danger?: boolean; toggle?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={toggle ? 'switch' : 'button'} accessibilityLabel={label}
      accessibilityState={{ disabled, ...(toggle ? { checked: active } : {}) }}
      disabled={disabled} onPress={onPress}
      style={[styles.control, active && styles.activeControl, danger && styles.leaveControl, disabled && styles.disabled]}
    >
      <Image source={icon} style={styles.controlIcon} resizeMode="contain" accessible={false} />
      <Text style={styles.controlLabel} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

function MeetingToast({ notice }: { notice: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 2500);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;
  return (
    <View style={styles.toastContainer} pointerEvents="none">
      <View style={styles.toast}>
        <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>
      </View>
    </View>
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
  const loadingLabel = snapshot.phase === 'joining' ? strings.joining : snapshot.phase === 'reconnecting' ? strings.reconnecting : '';
  const minimize = () => session.setMinimized(true);
  return (
    <View style={styles.content}>
      <View style={styles.header}>
        <View style={styles.titleContainer}>
          <Text style={styles.title} numberOfLines={2}>{session.params.name || strings.meeting}</Text>
          <View style={styles.titleLoading}>
            {!!loadingLabel && <ActivityIndicator size="small" color="#cbd5e1" accessibilityLabel={loadingLabel} />}
          </View>
        </View>
        <Text style={styles.count}>{snapshot.participants.length}</Text>
      </View>
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
        <Control label={strings.microphone} icon={snapshot.audio ? require('../../../assets/meeting/meeting_audio_on.png') : require('../../../assets/meeting/meeting_audio_off.png')} toggle active={snapshot.audio} disabled={disabled} onPress={() => { void session.toggle('audio'); }} />
        <Control label={strings.camera} icon={snapshot.video ? require('../../../assets/meeting/meeting_video_on.png') : require('../../../assets/meeting/meeting_video_off.png')} toggle active={snapshot.video} disabled={disabled} onPress={() => { void session.toggle('video'); }} />
        <Control label={strings.switchCamera} icon={snapshot.video ? require('../../../assets/meeting/meeting_camera_reverse.png') : require('../../../assets/meeting/meeting_camera_reverse_off.png')} disabled={disabled || !snapshot.video} onPress={() => session.switchCamera()} />
        <Control label={strings.speaker} icon={snapshot.speaker ? require('../../../assets/meeting/meeting_speaker_on.png') : require('../../../assets/meeting/meeting_speaker_off.png')} toggle active={snapshot.speaker} disabled={disabled} onPress={() => session.toggleSpeaker()} />
      </View>
      <View style={styles.controls}>
        <Control label={strings.invite} icon={require('../../../assets/meeting/meeting_invent.png')} disabled={!joined} onPress={() => { minimize(); session.send(meetingEvent('invent', session.params.meetingid)); }} />
        <Control label={strings.minimize} icon={require('../../../assets/meeting/meeting_mini.png')} disabled={!joined} onPress={minimize} />
        <Control label={strings.leave} icon={require('../../../assets/meeting/meeting_exit.png')} danger onPress={() => session.confirmLeave()} />
      </View>
      {!!snapshot.notice && <MeetingToast key={snapshot.notice} notice={snapshot.notice} />}
    </View>
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
  content: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 16 },
  titleContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flexShrink: 1, color: '#fff', fontSize: 22, fontWeight: '600' },
  titleLoading: { width: 20, height: 20, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  count: { color: '#cbd5e1', fontSize: 16 },
  toastContainer: { position: 'absolute', top: 64, left: 20, right: 20, zIndex: 10, elevation: 10, alignItems: 'center' },
  toast: { maxWidth: '100%', borderRadius: 12, backgroundColor: '#111827e6', paddingHorizontal: 16, paddingVertical: 10 },
  notice: { color: '#fff', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  grid: { flex: 1 }, gridContent: { paddingHorizontal: 10, paddingBottom: 16 },
  tile: { aspectRatio: 1, overflow: 'hidden', borderRadius: 12, backgroundColor: '#334155' },
  avatar: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: '#334155' },
  initial: { color: '#e2e8f0', fontSize: 48 },
  tileStatus: { position: 'absolute', right: 6, top: 6, flexDirection: 'row', gap: 6 },
  statusBadge: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#111827cc', alignItems: 'center', justifyContent: 'center' },
  statusIcon: { width: 20, height: 20 },
  caption: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, backgroundColor: '#111827cc' },
  indicator: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#84c56a' },
  unstable: { backgroundColor: '#ff9900' },
  name: { flex: 1, color: '#fff', fontSize: 14 }, white: { color: '#fff' },
  controls: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 10 },
  control: { flex: 1, minHeight: 72, padding: 6, borderRadius: 12, backgroundColor: '#334155', alignItems: 'center', justifyContent: 'center', gap: 4 },
  activeControl: { backgroundColor: '#166534' }, leaveControl: { backgroundColor: '#b93829' },
  controlIcon: { width: 26, height: 26 }, controlLabel: { fontSize: 12, color: '#fff', textAlign: 'center' },
  disabled: { opacity: 0.4 },
  expired: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 20 }, expiredButton: { padding: 16 },
});
