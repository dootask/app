import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Alert, AppState, DeviceEventEmitter, Platform, type AppStateStatus } from 'react-native';
import {
  ChannelProfileType, ClientRoleType, ConnectionStateType, createAgoraRtcEngine, FrameRate, OrientationMode,
  VideoMirrorModeType, VideoSourceType, type IRtcEngine, type IRtcEngineEventHandler,
} from 'react-native-agora';

import { startMeetingService, stopMeetingService } from '../../../modules/meeting';
import { getPage, type PageHandle } from '../../bridge/pages';
import { meetingEvent, type MeetingEvent } from './events';
import type { MeetingParams } from './params';
import { addParticipant, applyUserInfo, mergeUserInfo, updateMediaState, type Participant, type UserInfo } from './participants';
import { MeetingPermissionDenied, requestBluetoothPermission, requireMeetingPermission, showMeetingPermissionAlert } from './permissions';
import { MEETING_SESSION, notifyMeetingChange } from './runtime';
import { meetingStrings } from './strings';

export interface MeetingSnapshot {
  phase: 'joining' | 'joined' | 'reconnecting' | 'ended';
  participants: Participant[];
  audio: boolean;
  video: boolean;
  speaker: boolean;
  foreground: boolean;
  minimized: boolean;
  engineReady: boolean;
  busy: boolean;
  notice: string;
}

function check(code: number, method: string) {
  if (code < 0) throw new Error(`${method} (${code})`);
}

/** 每个会话连同引擎、监听器、信息缓存都归属调用方的 PageHandle.state。 */
export class MeetingSession {
  readonly strings;
  routePending = false;
  private snapshot: MeetingSnapshot;
  private listeners = new Set<() => void>();
  private infos = new Map<string, UserInfo>();
  private departed = new Set<number>();
  private engine?: IRtcEngine;
  private started = false;
  private joined = false;
  private visible = false;
  private routes = 0;
  private leaveAlert = false;
  private uid: number;
  private serviceCamera = false;
  private serviceAudio = false;
  private serviceStarted = false;
  private joinTimer?: ReturnType<typeof setTimeout>;
  private routeTimer?: ReturnType<typeof setTimeout>;
  private foregroundTimer?: ReturnType<typeof setTimeout>;
  private foregroundReady?: (active: boolean) => void;
  private ownerTimer?: ReturnType<typeof setInterval>;
  private appSubscription?: { remove(): void };
  private taskSubscription?: { remove(): void };

  constructor(readonly page: PageHandle, readonly id: string, readonly params: MeetingParams, language: string) {
    this.strings = meetingStrings(language);
    this.uid = params.uuid;
    this.snapshot = {
      phase: 'joining', participants: [{
        uid: params.uuid, uuid: String(params.uuid), local: true, avatar: params.avatar, username: params.username,
        audio: params.audio, video: params.video, audioState: 0, videoState: 0,
      }],
      audio: params.audio, video: params.video, speaker: true, foreground: AppState.currentState === 'active',
      minimized: false, engineReady: false, busy: false, notice: '',
    };
  }

  get ended() { return this.snapshot.phase === 'ended'; }
  get localUid() { return this.uid; }
  get serviceId() { return `${this.page.pageName}:${this.id}`; }
  get hasRoute() { return this.routes > 0 || this.routePending; }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private patch(values: Partial<MeetingSnapshot>) {
    this.snapshot = { ...this.snapshot, ...values };
    for (const listener of this.listeners) listener();
  }

  send(event: MeetingEvent) {
    if (getPage(this.page.pageName) === this.page) this.page.invokeWindow('__onMeetingEvent', event);
  }

  prepareRoute() {
    this.routePending = true;
    clearTimeout(this.routeTimer);
    this.routeTimer = setTimeout(() => { if (this.routePending) this.fail(this.strings.failed); }, 10_000);
  }

  attachRoute() {
    this.routes++;
    this.routePending = false;
    clearTimeout(this.routeTimer);
    if (!this.started) void this.start();
    return () => {
      this.routes--;
      // Strict Mode 会立即重新挂载；缩小窗口则保留引擎和音视频。
      queueMicrotask(() => { if (!this.routes && !this.routePending && !this.snapshot.minimized) this.finish(); });
    };
  }

  setMinimized(minimized: boolean) {
    if (this.ended) return;
    this.patch({ minimized });
    notifyMeetingChange();
  }

  updateInfo(value: unknown) {
    if (this.ended) return;
    this.infos = mergeUserInfo(this.infos, value);
    this.patch({ participants: applyUserInfo(this.snapshot.participants, this.infos) });
  }

  confirmLeave() {
    if (this.ended || this.leaveAlert) return;
    this.leaveAlert = true;
    const alert = { ...this.strings.alert, ...this.params.alert };
    Alert.alert(alert.title, alert.message, [
      { text: alert.cancel, style: 'cancel', onPress: () => { this.leaveAlert = false; } },
      { text: alert.confirm, style: 'destructive', onPress: () => { this.leaveAlert = false; this.finish(); } },
    ], { cancelable: true, onDismiss: () => { this.leaveAlert = false; } });
  }

  private async service(video: boolean, audio: boolean) {
    if (this.ended || Platform.OS !== 'android') return;
    if (this.serviceStarted && (!video || this.serviceCamera) && (!audio || this.serviceAudio)) return;
    const camera = this.serviceCamera || video;
    const microphone = this.serviceAudio || audio;
    try {
      await startMeetingService(this.serviceId, camera, microphone, this.params.name || this.strings.meeting, this.strings.background);
      this.serviceStarted = true;
      this.serviceCamera = camera;
      this.serviceAudio = microphone;
    } finally {
      // 离开可能发生在系统权限/服务启动期间；带会话标识的 stop 不会影响下一场会议。
      if (this.ended) this.stopService();
    }
  }

  private stopService() {
    try { stopMeetingService(this.serviceId); } catch (error) { console.warn('[meeting] 停止保活失败', error); }
  }

  private waitForForeground(): Promise<boolean> {
    if (this.ended) return Promise.resolve(false);
    if (AppState.currentState === 'active') return Promise.resolve(true);
    // 系统权限框关闭后，授权 Promise 可能先于 AppState active 到达。
    return new Promise((resolve) => {
      this.foregroundReady = resolve;
      this.foregroundTimer = setTimeout(() => this.resolveForeground(false), 30_000);
    });
  }

  private resolveForeground(active: boolean) {
    clearTimeout(this.foregroundTimer);
    const resolve = this.foregroundReady;
    this.foregroundReady = undefined;
    resolve?.(active);
  }

  private async start() {
    if (this.started || this.ended) return;
    this.started = true;
    this.ownerTimer = setInterval(() => { if (getPage(this.page.pageName) !== this.page) this.finish(); }, 1000);
    this.appSubscription = AppState.addEventListener('change', (state) => this.appStateChanged(state));
    if (Platform.OS === 'android') {
      this.taskSubscription = DeviceEventEmitter.addListener('DooTaskMeetingTaskRemoved', (id: unknown) => {
        if (id === this.serviceId) this.finish();
      });
    }
    try {
      if (this.params.audio) await requireMeetingPermission('audio');
      if (this.ended) return;
      if (this.params.video) await requireMeetingPermission('video');
      if (this.ended) return;
      await requestBluetoothPermission();
      if (this.ended) return;
      if (!await this.waitForForeground()) {
        if (!this.ended) throw new Error('入会前应用未回到前台');
        return;
      }
      await this.service(this.params.video, this.params.audio);
      if (this.ended) return;
      const engine = this.engine = createAgoraRtcEngine();
      check(engine.initialize({ appId: this.params.appid, channelProfile: ChannelProfileType.ChannelProfileCommunication }), 'initialize');
      engine.registerEventHandler(this.events);
      check(engine.enableVideo(), 'enableVideo');
      if (Platform.OS === 'ios') {
        check(engine.setVideoEncoderConfiguration({
          dimensions: { width: 960, height: 720 }, frameRate: FrameRate.FrameRateFps30, bitrate: 0,
          orientationMode: OrientationMode.OrientationModeAdaptive, mirrorMode: VideoMirrorModeType.VideoMirrorModeAuto,
        }), 'setVideoEncoderConfiguration');
      }
      check(engine.enableLocalAudio(this.params.audio), 'enableLocalAudio');
      check(engine.enableLocalVideo(this.params.video), 'enableLocalVideo');
      check(engine.setDefaultAudioRouteToSpeakerphone(true), 'setDefaultAudioRouteToSpeakerphone');
      if (this.params.video) check(engine.startPreview(), 'startPreview');
      this.patch({ engineReady: true });
      this.joinTimer = setTimeout(() => this.fail(this.strings.failed), 45_000);
      check(engine.joinChannel(this.params.token, this.params.channel, this.params.uuid, {
        channelProfile: ChannelProfileType.ChannelProfileCommunication,
        clientRoleType: ClientRoleType.ClientRoleBroadcaster,
        publishCameraTrack: this.params.video, publishMicrophoneTrack: this.params.audio,
        autoSubscribeAudio: true, autoSubscribeVideo: true,
      }), 'joinChannel');
    } catch (error) {
      if (this.ended) return;
      if (error instanceof MeetingPermissionDenied) {
        this.fail('', false);
        showMeetingPermissionAlert(this.strings);
      } else {
        console.warn('[meeting] 加入失败', error);
        this.fail(this.strings.failed);
      }
    }
  }

  private remoteJoined(uid: number) {
    if (this.ended || uid === this.uid || this.snapshot.participants.some((participant) => participant.uid === uid)) return;
    this.patch({ participants: addParticipant(this.snapshot.participants, uid, this.infos) });
    this.send(meetingEvent('getInfo', uid));
  }

  private mediaState(uid: number, kind: 'audio' | 'video', state: number) {
    if (this.ended || uid !== this.uid && this.departed.has(uid)) return;
    // 某些平台的媒体回调早于 userJoined；同样只补一个格子和一次 getInfo。
    if (uid !== this.uid) this.remoteJoined(uid);
    this.patch({ participants: updateMediaState(this.snapshot.participants, uid, kind, state) });
  }

  private readonly events: IRtcEngineEventHandler = {
    onJoinChannelSuccess: (connection) => {
      if (this.ended || this.joined) return;
      this.joined = true;
      clearTimeout(this.joinTimer);
      this.uid = connection.localUid ?? this.uid;
      this.patch({ phase: 'joined', participants: this.snapshot.participants.map((participant) => participant.local
        ? { ...participant, uid: this.uid, uuid: String(this.uid) } : participant) });
      this.visible = true;
      this.send(meetingEvent('status', true));
      this.send(meetingEvent('success', this.uid));
      this.keepAwake();
      if (Platform.OS === 'ios' && !this.snapshot.foreground && this.snapshot.video) {
        try { this.applyVideo(false); } catch { this.patch({ notice: this.strings.operationFailed }); }
      }
    },
    onRejoinChannelSuccess: () => { if (!this.ended) this.patch({ phase: 'joined', notice: '' }); },
    onUserJoined: (_connection, uid) => { this.departed.delete(uid); this.remoteJoined(uid); },
    onUserOffline: (_connection, uid) => {
      if (!this.ended) {
        this.departed.add(uid);
        this.patch({ participants: this.snapshot.participants.filter((participant) => participant.uid !== uid) });
      }
    },
    onLocalAudioStateChanged: (_connection, state) => this.mediaState(this.uid, 'audio', state),
    onLocalVideoStateChanged: (source, state) => {
      if (source === VideoSourceType.VideoSourceCameraPrimary) this.mediaState(this.uid, 'video', state);
    },
    onRemoteAudioStateChanged: (_connection, uid, state) => this.mediaState(uid, 'audio', state),
    onRemoteVideoStateChanged: (_connection, uid, state) => this.mediaState(uid, 'video', state),
    onUserMuteAudio: (_connection, uid, muted) => this.mediaState(uid, 'audio', muted ? 0 : 1),
    onUserMuteVideo: (_connection, uid, muted) => this.mediaState(uid, 'video', muted ? 0 : 1),
    onAudioRoutingChanged: (route) => { if (!this.ended) this.patch({ speaker: route === 3 }); },
    onConnectionStateChanged: (_connection, state) => {
      if (this.ended) return;
      if (state === ConnectionStateType.ConnectionStateFailed) this.fail(this.strings.failed);
      else if (this.joined && state === ConnectionStateType.ConnectionStateReconnecting) this.patch({ phase: 'reconnecting' });
      else if (this.joined && state === ConnectionStateType.ConnectionStateConnected) this.patch({ phase: 'joined' });
    },
    onLeaveChannel: () => this.finish(),
    onError: (code) => {
      if (this.ended) return;
      console.warn('[meeting] Agora 错误', code);
      if (!this.joined || [17, 101, 102, 109, 110, 119].includes(code)) this.fail(this.strings.failed);
      else this.patch({ notice: this.strings.operationFailed });
    },
    onTokenPrivilegeWillExpire: () => { if (!this.ended) this.patch({ notice: this.strings.tokenExpiring }); },
    onRequestToken: () => this.fail(this.strings.tokenExpired),
  };

  async toggle(kind: 'audio' | 'video') {
    if (!this.engine || !this.joined || this.ended || this.snapshot.busy || AppState.currentState !== 'active') return;
    const enabled = !this.snapshot[kind];
    this.patch({ busy: true });
    try {
      if (enabled) {
        await requireMeetingPermission(kind);
        if (this.ended) return;
        if (!await this.waitForForeground()) return;
        await this.service(kind === 'video' || this.snapshot.video, kind === 'audio' || this.snapshot.audio);
      }
      if (this.ended) return;
      if (kind === 'video') this.applyVideo(enabled);
      else {
        check(this.engine.enableLocalAudio(enabled), 'enableLocalAudio');
        check(this.engine.updateChannelMediaOptions({ publishMicrophoneTrack: enabled }), 'publishMicrophoneTrack');
      }
      this.patch({
        [kind]: enabled, notice: '',
        participants: updateMediaState(this.snapshot.participants, this.uid, kind, enabled ? 1 : 0),
      });
    } catch (error) {
      if (!this.ended) {
        // SDK 多步操作失败时回滚采集/发布，防止按钮显示关闭但实际仍在采集。
        if (!(error instanceof MeetingPermissionDenied)) {
          try {
            if (kind === 'video') this.applyVideo(!enabled);
            else {
              this.engine?.enableLocalAudio(!enabled);
              this.engine?.updateChannelMediaOptions({ publishMicrophoneTrack: !enabled });
            }
          } catch { /* 后续媒体状态回调仍会显示实际状态。 */ }
        }
        if (error instanceof MeetingPermissionDenied) showMeetingPermissionAlert(this.strings);
        else { console.warn('[meeting] 切换媒体失败', error); this.patch({ notice: this.strings.operationFailed }); }
      }
    } finally { if (!this.ended) this.patch({ busy: false }); }
  }

  private applyVideo(enabled: boolean) {
    if (!this.engine) return;
    check(this.engine.enableLocalVideo(enabled), 'enableLocalVideo');
    check(this.engine.updateChannelMediaOptions({ publishCameraTrack: enabled }), 'publishCameraTrack');
    check(enabled ? this.engine.startPreview() : this.engine.stopPreview(), 'preview');
  }

  switchCamera() {
    if (!this.engine || !this.snapshot.video || this.snapshot.busy || this.ended) return;
    try { check(this.engine.switchCamera(), 'switchCamera'); }
    catch { this.patch({ notice: this.strings.operationFailed }); }
  }

  toggleSpeaker() {
    if (!this.engine || !this.joined || this.ended) return;
    const speaker = !this.snapshot.speaker;
    try { check(this.engine.setEnableSpeakerphone(speaker), 'setEnableSpeakerphone'); this.patch({ speaker }); }
    catch { this.patch({ notice: this.strings.operationFailed }); }
  }

  private keepAwake() {
    if (!this.joined || this.ended || !this.snapshot.foreground) return;
    void activateKeepAwakeAsync(this.serviceId).then(() => {
      if (this.ended || !this.snapshot.foreground) void deactivateKeepAwake(this.serviceId).catch(() => {});
    }).catch(() => {});
  }

  private appStateChanged(state: AppStateStatus) {
    if (this.ended) return;
    const foreground = state === 'active';
    this.patch({ foreground });
    if (foreground) this.resolveForeground(true);
    if (foreground) this.keepAwake();
    else void deactivateKeepAwake(this.serviceId).catch(() => {});
    // iOS 后台保留语音；恢复时按用户开关恢复摄像头。Android 由已启动的前台服务保活。
    if (Platform.OS === 'ios' && this.engine && this.joined && this.snapshot.video) {
      try { this.applyVideo(foreground); }
      catch { this.patch({ notice: this.strings.operationFailed }); }
    }
  }

  fail(message: string, showAlert = true) {
    if (this.ended) return;
    this.send(meetingEvent('error', this.uid));
    this.finish();
    if (showAlert && message) Alert.alert(this.strings.meeting, message, [{ text: this.strings.ok }]);
  }

  finish() {
    if (this.ended) return;
    this.patch({ phase: 'ended', engineReady: false, busy: false });
    clearTimeout(this.joinTimer);
    clearTimeout(this.routeTimer);
    this.resolveForeground(false);
    clearInterval(this.ownerTimer);
    this.appSubscription?.remove();
    this.taskSubscription?.remove();
    const engine = this.engine;
    this.engine = undefined;
    if (engine) {
      // 任一清理步骤失败仍继续释放其余资源；先解除回调，避免 leave 递归。
      for (const release of [
        () => engine.unregisterEventHandler(this.events), () => engine.stopPreview(),
        () => engine.leaveChannel(), () => engine.release(),
      ]) { try { release(); } catch (error) { console.warn('[meeting] 释放资源失败', error); } }
    }
    this.stopService();
    void deactivateKeepAwake(this.serviceId).catch(() => {});
    if (this.visible) this.send(meetingEvent('status', false));
    this.send(meetingEvent('endMeeting', this.uid));
    this.infos.clear();
    this.departed.clear();
    if (this.page.state.get(MEETING_SESSION) === this) this.page.state.delete(MEETING_SESSION);
    notifyMeetingChange();
  }
}
