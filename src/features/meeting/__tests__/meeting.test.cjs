/* global __dirname: readonly */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

// 转译真实 TS，替换设备边界，不安装额外测试库，也不连接真实 Agora 频道。
function load(file, mocks = {}, globals = {}) {
  const filename = path.resolve(__dirname, '..', file);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, console, queueMicrotask, ...globals,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      throw new Error(`缺少测试替身: ${name}`);
    },
  }, { filename });
  return module.exports;
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };
const params = load('params.ts');
const events = load('events.ts');
const participants = load('participants.ts', { './params': params });
const strings = load('strings.ts');
const source = (extra = {}) => ({
  name: '周会', token: 'TOKEN-private', channel: 'meeting-12', uuid: 100001234,
  appid: '00112233445566778899aabbccddeeff', avatar: 'https://example.test/me.png', username: '小明',
  video: true, audio: true, meetingid: 12, sharelink: 'https://example.test/meeting/12',
  alert: { title: '提示', message: '要退出吗？', cancel: '继续', confirm: '离开' }, ...extra,
});

test('前端完整 startMeeting 参数保留字段；兼容 JSON 和数字字符串、false 不被误判为 true', () => {
  const parsed = params.parseMeetingParams(JSON.stringify(source({ uuid: '100001234', audio: 'false', video: '1' })));
  assert.equal(parsed.uuid, 100001234);
  assert.equal(parsed.meetingid, '12');
  assert.equal(parsed.audio, false);
  assert.equal(parsed.video, true);
  assert.equal(parsed.token, 'TOKEN-private');
  assert.deepEqual(plain(parsed.alert), source().alert);
  assert.equal(parsed.sharelink, source().sharelink);
  assert.equal(params.parseMeetingParams(source({ audio: '0', video: 0 })).video, false);
  assert.equal(params.parseMeetingParams(source({ audio: 1 })).audio, true);
});

test('uid 完整 uint32、自动分配；拒绝空值、布尔值、溢出和畸形入会参数', () => {
  assert.equal(params.parseUid(0xffffffff), 0xffffffff);
  assert.equal(params.parseMeetingParams(source({ uuid: 0 })).uuid, 0);
  for (const uuid of [null, undefined, true, -1, 1.2, 0x100000000, '', '1e3', 'NaN']) {
    assert.throws(() => params.parseMeetingParams(source({ uuid })), /uuid/);
  }
  for (const value of [null, [], 'bad', {}, source({ appid: '' }), source({ channel: '' })]) {
    assert.throws(() => params.parseMeetingParams(value));
  }
});

test('全部旧事件字段完全对齐：字符串 uuid / meetingid，布尔 status，保留 invent 拼写', () => {
  for (const act of ['getInfo', 'success', 'error', 'endMeeting']) {
    assert.deepEqual(plain(events.meetingEvent(act, 4294967295)), { act, uuid: '4294967295' });
  }
  assert.deepEqual(plain(events.meetingEvent('invent', 12)), { act: 'invent', meetingid: '12' });
  assert.deepEqual(plain(events.meetingEvent('status', true)), { act: 'status', status: true });
  assert.deepEqual(plain(events.meetingEvent('status', false)), { act: 'status', status: false });
});

test('用户信息早到/晚到均合并，数字和字符串 uid 去重，缺失字段保留、空串可清空', () => {
  const empty = new Map();
  const first = participants.mergeUserInfo(empty, { uuid: '00042', avatar: 'a.png', username: '小王' });
  const second = participants.mergeUserInfo(first, { uuid: 42, avatar: undefined, username: '小王二' });
  assert.equal(empty.size, 0);
  assert.equal(first.get('42').username, '小王');
  assert.deepEqual(plain(second.get('42')), { uuid: '42', avatar: 'a.png', username: '小王二' });
  const joined = participants.addParticipant([], 42, second);
  assert.equal(joined[0].username, '小王二');
  assert.equal(participants.addParticipant(joined, 42, second).length, 1);
  const late = participants.mergeUserInfo(second, { uuid: 42, avatar: '' });
  assert.equal(participants.applyUserInfo(joined, late)[0].avatar, '');
  assert.equal(joined[0].avatar, 'a.png');
  assert.equal(participants.mergeUserInfo(late, { uuid: -1 }).size, 1);
});

test('媒体状态沿用旧语义，状态更新不丢失头像和姓名', () => {
  const joined = participants.addParticipant([], 42, new Map([['42', { uuid: '42', username: '王', avatar: 'a' }]]));
  for (const state of [0, 1, 2, 3, 4]) {
    const updated = participants.updateMediaState(joined, 42, 'video', state)[0];
    assert.equal(updated.video, [1, 2, 3].includes(state));
    assert.equal(updated.videoState, state);
    assert.equal(updated.username, '王');
  }
  assert.equal(joined[0].videoState, 0);
});

test('弹窗优先保留前端翻译；原生文字支持简中、繁中、英文回退', () => {
  assert.equal(strings.meetingStrings('zh-CN').invite, '邀请');
  assert.equal(strings.meetingStrings('zh-Hant').invite, '邀請');
  assert.equal(strings.meetingStrings('de').invite, 'Invite');
  assert.equal(params.meetingLanguage({ language: 'zh-TW' }, '"en"', 'en'), 'zh-TW');
  assert.equal(params.meetingLanguage({}, '"zh-CN"', 'en'), 'zh-CN');
  assert.equal(params.meetingLanguage({}, 'zh-HK', 'en'), 'zh-HK');
  assert.equal(params.meetingLanguage(null, 'null', 'en'), 'en');
  assert.deepEqual(plain(params.parseMeetingParams(source({ alert: { title: 'Notice', confirm: null } })).alert), { title: 'Notice' });
});

function fixture(platform = 'android', options = {}) {
  const pages = new Map();
  const page = { pageName: 'firstPage', state: new Map(), events: [], invokeWindow(fn, event) { this.events.push({ fn, ...plain(event) }); } };
  pages.set(page.pageName, page);
  const calls = [];
  const alerts = [];
  const timers = [];
  const appListeners = new Set();
  const taskListeners = new Set();
  let creates = 0;
  let handlers;
  const engine = new Proxy({}, { get(_target, method) {
    return (...args) => {
      calls.push([method, ...args]);
      if (method === 'registerEventHandler') handlers = args[0];
      return options.codes?.[method] ?? 0;
    };
  } });
  const AppState = { currentState: 'active', addEventListener(_event, callback) { appListeners.add(callback); return { remove: () => appListeners.delete(callback) }; } };
  const pagesModule = { getPage: (name) => pages.get(name), getAllPages: () => [...pages.values()] };
  class PermissionDenied extends Error {}
  const service = [];
  const permissionCalls = [];
  const runtime = { MEETING_SESSION: 'meeting.session', notifyMeetingChange() {} };
  const impl = load('session.ts', {
    'expo-keep-awake': { activateKeepAwakeAsync: async () => {}, deactivateKeepAwake: async () => {} },
    'react-native': {
      Platform: { OS: platform }, AppState, Alert: { alert: (...args) => alerts.push(args) },
      DeviceEventEmitter: { addListener(_name, callback) { taskListeners.add(callback); return { remove: () => taskListeners.delete(callback) }; } },
    },
    'react-native-agora': {
      ChannelProfileType: { ChannelProfileCommunication: 0 }, ClientRoleType: { ClientRoleBroadcaster: 1 },
      ConnectionStateType: { ConnectionStateFailed: 5, ConnectionStateConnected: 3, ConnectionStateReconnecting: 4 },
      FrameRate: { FrameRateFps30: 30 }, OrientationMode: { OrientationModeAdaptive: 0 }, VideoMirrorModeType: { VideoMirrorModeAuto: 0 },
      VideoSourceType: { VideoSourceCameraPrimary: 0 }, createAgoraRtcEngine() { creates++; return engine; },
    },
    '../../../modules/meeting': {
      startMeetingService: async (...args) => { service.push(['start', ...args]); await options.serviceStart?.(...args); },
      stopMeetingService: (...args) => service.push(['stop', ...args]),
    },
    '../../bridge/pages': pagesModule, './events': events, './participants': participants,
    './runtime': runtime, './strings': strings,
    './permissions': {
      MeetingPermissionDenied: PermissionDenied,
      requireMeetingPermission: async (kind) => { permissionCalls.push(kind); if (options.denied === kind) throw new PermissionDenied(kind); await options.permission?.(kind); },
      requestBluetoothPermission: async () => {}, showMeetingPermissionAlert: () => alerts.push(['permission']),
    },
  }, {
    console: { ...console, warn() {} },
    setTimeout(fn, ms) { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    setInterval(fn, ms) { const timer = { fn, ms, cleared: false, interval: true }; timers.push(timer); return timer; },
    clearInterval(timer) { if (timer) timer.cleared = true; },
  });
  const session = new impl.MeetingSession(page, 'one', params.parseMeetingParams(source(options.params)), 'en');
  page.state.set('meeting.session', session);
  return {
    page, pages, calls, alerts, service, permissionCalls, timers, session, impl, pagesModule, runtime,
    get creates() { return creates; }, get handlers() { return handlers; }, get appListeners() { return appListeners.size; },
    async join(uid = 100001234) { session.attachRoute(); await flush(); handlers?.onJoinChannelSuccess({ localUid: uid }); await flush(); },
    changeApp(state) { AppState.currentState = state; for (const listener of appListeners) listener(state); },
    taskRemoved(id) { for (const listener of taskListeners) listener(id); },
  };
}

test('入会先提升 Android 服务，再按参数开关采集；只发一次 status/success', async () => {
  const f = fixture('android', { params: { audio: false, video: false } });
  await f.join();
  assert.equal(f.creates, 1);
  assert.equal(f.permissionCalls.length, 0);
  assert.deepEqual(f.service[0].slice(0, 4), ['start', 'firstPage:one', false, false]);
  const join = f.calls.find(([name]) => name === 'joinChannel');
  assert.deepEqual(plain(join.slice(1, 4)), ['TOKEN-private', 'meeting-12', 100001234]);
  assert.equal(join[4].publishCameraTrack, false);
  assert.equal(join[4].autoSubscribeAudio, true);
  f.handlers.onJoinChannelSuccess({ localUid: 100001234 });
  f.handlers.onRejoinChannelSuccess({});
  assert.deepEqual(f.page.events.map((event) => event.act), ['status', 'success']);
  assert.equal(f.page.events[0].status, true);
  f.session.finish();
  assert.deepEqual(f.page.events.slice(-2).map((event) => event.act), ['status', 'endMeeting']);
  assert.equal(f.page.events.at(-2).status, false);
});

test('远端媒体/入会回调乱序去重；信息早到/晚到和离线尾部回调不产生幽灵用户', async () => {
  const f = fixture();
  await f.join();
  f.session.updateInfo({ uuid: '42', username: '王', avatar: 'a' });
  f.handlers.onRemoteVideoStateChanged({}, 42, 2);
  f.handlers.onUserJoined({}, 42);
  f.handlers.onUserJoined({}, 42);
  assert.equal(f.session.getSnapshot().participants.length, 2);
  assert.equal(f.page.events.filter((event) => event.act === 'getInfo').length, 1);
  assert.equal(f.session.getSnapshot().participants[1].username, '王');
  f.session.updateInfo({ uuid: 42, username: '王二' });
  assert.equal(f.session.getSnapshot().participants[1].avatar, 'a');
  f.handlers.onUserOffline({}, 42);
  f.handlers.onRemoteVideoStateChanged({}, 42, 0);
  f.session.updateInfo({ uuid: 42, avatar: 'late' });
  assert.equal(f.session.getSnapshot().participants.length, 1);
  f.handlers.onUserJoined({}, 42);
  assert.equal(f.session.getSnapshot().participants[1].avatar, 'late');
  assert.equal(f.page.events.filter((event) => event.act === 'getInfo').length, 2);
  f.session.finish();
});

test('最小化/恢复不离会、不发送 status=false，显式离开确认使用前端 alert', async () => {
  const f = fixture();
  const detach = f.session.attachRoute();
  await flush();
  f.handlers.onJoinChannelSuccess({ localUid: 100001234 });
  f.session.setMinimized(true);
  detach();
  await flush();
  assert.equal(f.session.ended, false);
  assert.equal(f.page.events.filter((event) => event.act === 'status').length, 1);
  f.session.setMinimized(false);
  const detachRestored = f.session.attachRoute();
  await flush();
  assert.equal(f.creates, 1);
  f.session.confirmLeave();
  f.session.confirmLeave();
  assert.equal(f.alerts.length, 1);
  assert.equal(f.alerts[0][0], '提示');
  assert.equal(f.alerts[0][1], '要退出吗？');
  f.alerts[0][2][0].onPress();
  assert.equal(f.session.ended, false);
  f.session.confirmLeave();
  f.alerts[1][2][1].onPress();
  assert.equal(f.session.ended, true);
  detachRestored();
});

test('Strict Mode 重挂不重复创建引擎，真实卸载释放一次并取消全部计时器/监听', async () => {
  const f = fixture();
  const detach = f.session.attachRoute();
  detach();
  const detachAgain = f.session.attachRoute();
  await flush();
  assert.equal(f.creates, 1);
  detachAgain();
  await flush();
  f.session.finish();
  f.handlers.onLeaveChannel({});
  assert.equal(f.calls.filter(([name]) => name === 'release').length, 1);
  assert.equal(f.appListeners, 0);
  assert.ok(f.timers.every((timer) => timer.cleared));
  assert.equal(f.page.state.has('meeting.session'), false);
  assert.equal(f.page.events.filter((event) => event.act === 'endMeeting').length, 1);
});

test('权限等待期间离开，不创建 Agora、不启动服务；拒绝权限回传 error 并提示设置', async () => {
  let allow;
  const pending = new Promise((resolve) => { allow = resolve; });
  const f = fixture('android', { permission: () => pending });
  f.session.attachRoute();
  f.session.finish();
  allow();
  await flush();
  assert.equal(f.creates, 0);
  assert.equal(f.service.filter(([method]) => method === 'start').length, 0);
  const denied = fixture('android', { denied: 'audio' });
  denied.session.attachRoute();
  await flush();
  assert.equal(denied.creates, 0);
  assert.equal(denied.page.events[0].act, 'error');
  assert.equal(denied.session.ended, true);
  assert.equal(denied.alerts[0][0], 'permission');
});

test('保活启动尚未完成就退出，迟到完成仍用旧会话 ID 停服务，避免残留采集', async () => {
  let resolveService;
  const pending = new Promise((resolve) => { resolveService = resolve; });
  const f = fixture('android', { serviceStart: () => pending });
  f.session.attachRoute();
  await flush();
  f.session.finish();
  resolveService();
  await flush();
  assert.equal(f.creates, 0);
  assert.equal(f.service.at(-1)[0], 'stop');
  assert.equal(f.service.at(-1)[1], 'firstPage:one');
});

test('连接失败/Token 到期/加入同步失败均回传 error 并释放；断网重连不会重复 success', async () => {
  for (const failure of ['connection', 'token', 'join']) {
    const f = fixture('android', failure === 'join' ? { codes: { joinChannel: -2 } } : {});
    if (failure === 'join') { f.session.attachRoute(); await flush(); }
    else {
      await f.join();
      f.handlers.onConnectionStateChanged({}, 4);
      assert.equal(f.session.getSnapshot().phase, 'reconnecting');
      f.handlers.onConnectionStateChanged({}, 3);
      assert.equal(f.session.getSnapshot().phase, 'joined');
      if (failure === 'connection') f.handlers.onConnectionStateChanged({}, 5);
      else f.handlers.onRequestToken({});
    }
    assert.equal(f.session.ended, true);
    assert.equal(f.page.events.filter((event) => event.act === 'error').length, 1);
    assert.equal(f.calls.filter(([name]) => name === 'release').length, 1);
  }
});

test('iOS 后台暂停视频、语音持续，前台恢复按用户开关，后台不改变 meeting status', async () => {
  const f = fixture('ios');
  await f.join();
  f.changeApp('background');
  assert.equal(f.session.getSnapshot().video, true);
  assert.ok(f.calls.some(([name, value]) => name === 'enableLocalVideo' && value === false));
  assert.ok(!f.calls.some(([name, value]) => name === 'enableLocalAudio' && value === false));
  f.changeApp('active');
  assert.deepEqual(f.calls.filter(([name]) => name === 'enableLocalVideo').map(([, value]) => value), [true, false, true]);
  assert.equal(f.page.events.filter((event) => event.act === 'status').length, 1);
  f.session.finish();
});

test('媒体开关提升服务类型，发布轨道和实际采集一致；摄像头、扬声器操作可用', async () => {
  const f = fixture('android', { params: { video: false, audio: false } });
  await f.join();
  await f.session.toggle('video');
  await f.session.toggle('audio');
  assert.equal(f.session.getSnapshot().video, true);
  assert.equal(f.session.getSnapshot().audio, true);
  assert.deepEqual(f.service.filter(([name]) => name === 'start').map((args) => args.slice(2, 4)), [[false, false], [true, false], [true, true]]);
  f.session.switchCamera();
  f.session.toggleSpeaker();
  assert.ok(f.calls.some(([name]) => name === 'switchCamera'));
  assert.ok(f.calls.some(([name, value]) => name === 'setEnableSpeakerphone' && value === false));
  await f.session.toggle('video');
  assert.equal(f.session.getSnapshot().video, false);
  assert.ok(f.calls.some(([name, value]) => name === 'updateChannelMediaOptions' && value.publishCameraTrack === false));
  f.session.finish();
});

test('来源 WebView 被替换时终止通话，不给已失效的 PageHandle 回调', async () => {
  const f = fixture();
  await f.join();
  const previous = f.page.events.length;
  f.pages.delete(f.page.pageName);
  f.timers.find((timer) => timer.interval).fn();
  assert.equal(f.session.ended, true);
  assert.equal(f.page.events.length, previous);
});

test('滑走 Android 任务会清理 JS 会话，迟到的旧任务事件不影响当前会议', async () => {
  const f = fixture();
  await f.join();
  f.taskRemoved('previous-session');
  assert.equal(f.session.ended, false);
  f.taskRemoved('firstPage:one');
  assert.equal(f.session.ended, true);
  assert.equal(f.page.events.at(-1).act, 'endMeeting');
});

test('自动 uid 使用 SDK 实际分配值；加入超时结束会话并回传一次 error', async () => {
  const auto = fixture('android', { params: { uuid: 0 } });
  await auto.join(4294967295);
  assert.equal(auto.page.events.find((event) => event.act === 'success').uuid, '4294967295');
  assert.equal(auto.session.getSnapshot().participants[0].uid, 4294967295);
  auto.session.finish();
  const timeout = fixture();
  timeout.session.attachRoute();
  await flush();
  timeout.timers.find((timer) => timer.ms === 45000).fn();
  assert.equal(timeout.session.ended, true);
  assert.deepEqual(timeout.page.events.map((event) => event.act), ['error', 'endMeeting']);
});

test('媒体发布失败回滚采集；授权结果先于 AppState active 时等待前台再开启会议', async () => {
  const rollback = fixture('android', { params: { video: false }, codes: { updateChannelMediaOptions: -2 } });
  await rollback.join();
  await rollback.session.toggle('video');
  assert.equal(rollback.session.getSnapshot().video, false);
  assert.deepEqual(rollback.calls.filter(([name]) => name === 'enableLocalVideo').map(([, value]) => value), [false, true, false]);
  rollback.session.finish();
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const background = fixture('android', { permission: () => pending });
  background.session.attachRoute();
  background.changeApp('background');
  resolve();
  await flush();
  assert.equal(background.creates, 0);
  assert.equal(background.session.ended, false);
  background.changeApp('active');
  await flush();
  assert.equal(background.creates, 1);
  background.session.finish();
});

test('消息注册、路由不携带凭证，重复入会复用引擎、跨 WebView 更新当前会议信息', async () => {
  const f = fixture();
  f.page.state.clear();
  const routes = [];
  const registry = load('registry.ts', {
    'expo-localization': { getLocales: () => [{ languageTag: 'en' }] },
    'expo-router': { router: { push: (route) => routes.push(route) } },
    'react-native': { Alert: { alert: (...args) => f.alerts.push(args) } },
    '../../bridge/pages': f.pagesModule, '../../bridge/store': { bridgeStore: { getCachesString: () => '"zh-CN"', getVariate: () => ({ language: 'zh-CN' }) } },
    './events': events, './params': params, './runtime': f.runtime, './session': f.impl, './strings': strings,
  });
  const handlers = new Map();
  load('index.ts', { '../../bridge/dispatcher': { registerMessage: (action, handler) => handlers.set(action, handler) }, './registry': registry });
  handlers.get('startMeeting')(f.page, { meetingParams: source() });
  const active = registry.activeMeeting();
  assert.equal(routes.length, 1);
  assert.equal(JSON.stringify(routes).includes('TOKEN-private'), false);
  handlers.get('startMeeting')(f.page, { meetingParams: source() });
  assert.equal(registry.activeMeeting(), active);
  assert.equal(routes.length, 1);
  const child = { pageName: 'child', state: new Map() };
  f.pages.set('child', child);
  handlers.get('updateMeetingInfo')(child, { infos: { uuid: 42, username: '晚到' } });
  active.attachRoute();
  await flush();
  f.handlers.onJoinChannelSuccess({ localUid: 100001234 });
  f.handlers.onUserJoined({}, 42);
  assert.equal(active.getSnapshot().participants[1].username, '晚到');
  handlers.get('startMeeting')(f.page, { meetingParams: source({ channel: 'other' }) });
  assert.equal(registry.activeMeeting(), active);
  assert.equal(f.page.events.at(-1).act, 'error');
  active.finish();
});
