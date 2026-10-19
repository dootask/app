/* global __dirname: readonly */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

// 转译真实实现，以设备替身和可控时钟验证权限、超时与迟到事件，不增加测试依赖。
function compile(relative) {
  const filename = path.resolve(__dirname, relative);
  return ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

const source = compile('../index.ts');
const protocolSource = compile('../../../bridge/protocol.ts');
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const never = () => new Promise(() => {});
const granted = { granted: true, canAskAgain: true };
const position = (accuracy = 10) => ({ coords: { latitude: 39.9042, longitude: 116.4074, accuracy } });

function makePage() {
  return {
    state: new Map(), events: [],
    callback(ref, data, keep) { this.events.push({ ref, data: JSON.parse(JSON.stringify(data)), keep }); },
  };
}

function fixture(platform = 'android', options = {}) {
  const timers = new Set();
  const watches = [];
  const natives = [];
  const stats = { asks: 0, services: 0 };
  const warnings = [];
  let methods;
  const appState = { currentState: options.appState ?? 'active', listeners: new Set() };
  const location = {
    Accuracy: { High: 4 },
    PermissionStatus: { UNDETERMINED: 'undetermined' },
    hasServicesEnabledAsync: async () => { stats.services++; return true; },
    getForegroundPermissionsAsync: async () => granted,
    requestForegroundPermissionsAsync: async () => { stats.asks++; return options.permission ?? granted; },
    watchPositionAsync: async (config, success, error) => {
      const watch = { config, success, error, removals: 0 };
      watch.subscription = { remove: () => { watch.removals++; options.onRemove?.(); } };
      watches.push(watch);
      return options.onWatch ? options.onWatch(watch) : watch.subscription;
    },
    ...options.location,
  };
  const legacy = {
    getPosition: (timeoutMs, minAccuracy, maxAgeMs) => new Promise((resolve, reject) => {
      natives.push({ args: [timeoutMs, minAccuracy, maxAgeMs], resolve, reject });
    }),
    ...options.legacy,
  };
  const protocol = { exports: {} };
  vm.runInNewContext(protocolSource, { exports: protocol.exports });
  const module = { exports: {} };
  const mocks = {
    'expo-location': location,
    'react-native': {
      Platform: { OS: platform },
      AppState: {
        get currentState() { return appState.currentState; },
        addEventListener(type, listener) {
          assert.equal(type, 'change');
          appState.listeners.add(listener);
          return { remove: () => appState.listeners.delete(listener) };
        },
      },
    },
    '../../../modules/legacy-location': { getLegacyLocationModule: () => legacy },
    '../../bridge/protocol': protocol.exports,
    '../../bridge/dispatcher': { registerModule(name, handlers) { assert.equal(name, 'eeui'); methods = handlers; } },
  };
  vm.runInNewContext(source, {
    exports: module.exports,
    console: { warn: (...args) => warnings.push(args) },
    setTimeout(run, ms) {
      assert.ok([20_000, 60_000, 500].includes(ms), `意外的计时：${ms}`);
      const timer = { run, ms };
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer) { timers.delete(timer); },
    require(name) { assert.ok(Object.hasOwn(mocks, name), `缺少测试替身：${name}`); return mocks[name]; },
  });
  const page = makePage();
  const ref = { __cb: 'location-test' };
  return {
    page, ref, watches, natives, timers, stats, warnings,
    getGeolocation: methods.getGeolocation,
    start: () => methods.getGeolocation(page, ref),
    expire() { for (const timer of [...timers]) { timers.delete(timer); timer.run(); } },
    // 只推进轮询等短计时，不触发超时
    tick() { for (const timer of [...timers]) if (timer.ms === 500) { timers.delete(timer); timer.run(); } },
    setAppState(state) { appState.currentState = state; for (const listener of [...appState.listeners]) listener(state); },
    get appListeners() { return appState.listeners.size; },
  };
}

function assertError(f, error) {
  assert.deepEqual(f.page.events, [{ ref: f.ref, data: { status: 'error', error }, keep: false }]);
  assert.equal(f.page.state.size, 0);
  assert.equal(f.timers.size, 0);
}

const success = { status: 'success', latitude: 39.9042, longitude: 116.4074 };

for (const platform of ['android', 'ios']) {
  const denied = platform === 'ios' ? 'PERMISSION DENIED' : 'PERMISSION_DENIED';
  const disabled = platform === 'ios' ? 'UNAVAILABLE' : 'LOCATION_DISABLED';

  test(`${platform}：首次调用请求前台权限，已授权不再弹窗`, async () => {
    for (const grantedBefore of [false, true]) {
      const f = fixture(platform, grantedBefore ? {} : { location: { getForegroundPermissionsAsync: async () => ({ granted: false, canAskAgain: true }) } });
      void f.start();
      await flush();
      assert.equal(f.stats.asks, grantedBefore ? 0 : 1);
      assert.equal(f.watches.length + f.natives.length, 1);
    }
  });

  for (const canAskAgain of [true, false]) {
    test(`${platform}：${canAskAgain ? '普通' : '永久'}拒绝返回旧错误字符串`, async () => {
      const f = fixture(platform, {
        permission: { granted: false, canAskAgain },
        location: { getForegroundPermissionsAsync: async () => ({ granted: false, canAskAgain }) },
      });
      await f.start();
      assert.equal(f.stats.asks, canAskAgain ? 1 : 0);
      assert.equal(f.watches.length + f.natives.length, 0);
      assertError(f, denied);
    });
  }

  test(`${platform}：系统定位关闭及授权期间关闭均明确失败`, async () => {
    for (const enabledInitially of [false, true]) {
      let checks = 0;
      const f = fixture(platform, { location: { hasServicesEnabledAsync: async () => enabledInitially && ++checks === 1 } });
      await f.start();
      assertError(f, disabled);
      assert.equal(f.watches.length + f.natives.length, 0);
    }
  });

  test(`${platform}：权限查询、授权弹窗或系统查询挂起均受 20 秒截止时间约束`, async () => {
    for (const location of [
      { hasServicesEnabledAsync: never },
      { getForegroundPermissionsAsync: never },
      { getForegroundPermissionsAsync: async () => ({ granted: false, canAskAgain: true }), requestForegroundPermissionsAsync: never },
    ]) {
      const f = fixture(platform, { location });
      void f.start();
      await flush();
      f.expire();
      assertError(f, 'TIMEOUT');
      assert.equal(f.watches.length + f.natives.length, 0);
    }
  });

  test(`${platform}：授权晚于超时完成时不会再启动定位`, async () => {
    let resolve;
    const f = fixture(platform, { location: { getForegroundPermissionsAsync: () => new Promise((done) => { resolve = done; }) } });
    const task = f.start();
    await flush();
    f.expire();
    resolve(granted);
    await task;
    assertError(f, 'TIMEOUT');
    assert.equal(f.watches.length + f.natives.length, 0);
  });
}

test('android：走原生系统定位（不经 expo-location 的 Fused 定位），参数对齐旧 LocationHelper', async () => {
  const f = fixture('android');
  const task = f.start();
  await flush();
  assert.equal(f.watches.length, 0);
  assert.equal(f.natives.length, 1);
  const [timeoutMs, minAccuracy, maxAgeMs] = f.natives[0].args;
  assert.ok(timeoutMs >= 1000 && timeoutMs <= 20_000);
  assert.equal(minAccuracy, 50);
  assert.equal(maxAgeMs, 30_000);
  f.natives[0].resolve({ latitude: 39.9042, longitude: 116.4074, accuracy: 12 });
  await task;
  f.expire();
  assert.deepEqual(f.page.events, [{ ref: f.ref, data: success, keep: false }]);
  assert.equal(f.page.state.size, 0);
  assert.equal(f.timers.size, 0);
});

test('android：原生错误码原样返回，未知异常归为 UNEXPECTED_ERROR', async () => {
  for (const [error, expected] of [
    [{ code: 'TIMEOUT', message: '定位超时' }, 'TIMEOUT'],
    [{ code: 'LOCATION_DISABLED' }, 'LOCATION_DISABLED'],
    [{ code: 'SECURITY_EXCEPTION' }, 'SECURITY_EXCEPTION'],
    [new Error('原生定位失败'), 'UNEXPECTED_ERROR'],
  ]) {
    const f = fixture('android');
    const task = f.start();
    await flush();
    f.natives[0].reject(error);
    await task;
    assertError(f, expected);
  }
});

test('android：JS 截止时间先到时回 TIMEOUT，迟到的原生结果被忽略；无效坐标返回错误', async () => {
  const f = fixture('android');
  const task = f.start();
  await flush();
  f.expire();
  f.natives[0].resolve({ latitude: 39.9, longitude: 116.4, accuracy: 5 });
  await task;
  assertError(f, 'TIMEOUT');

  const g = fixture('android');
  const invalid = g.start();
  await flush();
  g.natives[0].resolve({ latitude: NaN, longitude: 116, accuracy: 5 });
  await invalid;
  assertError(g, 'UNEXPECTED_ERROR');
});

test('ios：取第一次回调的位置，不设精度门槛，一次性回调并移除监听', async () => {
  for (const accuracy of [10, 1000, null]) {
    const f = fixture('ios');
    await f.start();
    assert.equal(f.natives.length, 0);
    assert.equal(f.watches[0].config.accuracy, 4);
    assert.equal(f.watches[0].config.distanceInterval, 0);
    f.watches[0].success(position(accuracy));
    f.watches[0].success(position());
    f.watches[0].error('迟到错误');
    f.expire();
    assert.deepEqual(f.page.events, [{ ref: f.ref, data: success, keep: false }]);
    assert.equal(f.watches[0].removals, 1);
    assert.equal(f.page.state.size, 0);
    assert.equal(f.timers.size, 0);
  }
});

test('ios：未收到位置时 20 秒超时，迟到事件被忽略', async () => {
  const f = fixture('ios');
  await f.start();
  f.expire();
  f.watches[0].success(position());
  f.watches[0].error('迟到错误');
  assertError(f, 'TIMEOUT');
  assert.equal(f.watches[0].removals, 1);
});

test('ios：运行中权限撤销、服务关闭和原生异常均失败且只回调一次', async () => {
  for (const [reason, expected] of [
    ['Location permission is required to do this operation', 'PERMISSION DENIED'],
    ['Location services are disabled', 'UNAVAILABLE'],
    ['原生定位失败', '原生定位失败'],
  ]) {
    const f = fixture('ios');
    await f.start();
    f.watches[0].error(reason);
    f.watches[0].success(position());
    assertError(f, expected);
    assert.equal(f.watches[0].removals, 1);
  }
});

test('ios：定位订阅建立前成功或超时，迟到句柄均被移除且不重复回调', async () => {
  for (const succeed of [true, false]) {
    let resolve;
    const f = fixture('ios', { onWatch: () => new Promise((done) => { resolve = done; }) });
    const task = f.start();
    await flush();
    if (succeed) f.watches[0].success(position());
    else f.expire();
    resolve(f.watches[0].subscription);
    await task;
    f.watches[0].success(position());
    assert.equal(f.page.events.length, 1);
    assert.equal(f.page.events[0].data.status, succeed ? 'success' : 'error');
    assert.equal(f.watches[0].removals, 1);
    assert.equal(f.page.state.size, 0);
    assert.equal(f.timers.size, 0);
  }
});

test('各原生 API 抛错均结束回调，Android 安全错误保留旧错误码', async () => {
  for (const method of ['hasServicesEnabledAsync', 'getForegroundPermissionsAsync', 'requestForegroundPermissionsAsync']) {
    const f = fixture('android', { location: {
      getForegroundPermissionsAsync: async () => ({ granted: false, canAskAgain: true }),
      [method]: async () => { throw new Error('SecurityException'); },
    } });
    await f.start();
    assertError(f, 'SECURITY_EXCEPTION');
  }
  const f = fixture('ios', { location: { watchPositionAsync: async () => { throw { code: 'ERR_DENIED_FOREGROUND_LOCATION_PERMISSION' }; } } });
  await f.start();
  assertError(f, 'PERMISSION DENIED');
});

test('并发请求按页面独立登记，成功与超时互不干扰', async () => {
  const f = fixture('ios');
  const otherPage = makePage();
  const secondRef = { __cb: 'same-page-second' };
  const otherRef = { __cb: 'other-page' };
  await Promise.all([f.start(), f.getGeolocation(f.page, secondRef), f.getGeolocation(otherPage, otherRef)]);
  assert.equal(f.page.state.get('location.requests').size, 2);
  assert.equal(otherPage.state.get('location.requests').size, 1);
  f.watches[0].success(position());
  assert.equal(f.page.state.get('location.requests').size, 1);
  f.expire();
  assert.deepEqual(f.page.events.map(({ ref, data }) => [ref.__cb, data.status]), [['location-test', 'success'], ['same-page-second', 'error']]);
  assert.deepEqual(otherPage.events, [{ ref: otherRef, data: { status: 'error', error: 'TIMEOUT' }, keep: false }]);
  assert.equal(f.page.state.size, 0);
  assert.equal(otherPage.state.size, 0);
  assert.ok(f.watches.every((watch) => watch.removals === 1));
});

test('清理监听异常不吞掉回调，无效坐标返回 error', async () => {
  const f = fixture('ios', { onRemove: () => { throw new Error('停止失败'); } });
  await f.start();
  f.watches[0].success({ coords: { latitude: NaN, longitude: 116, accuracy: 10 } });
  assertError(f, 'UNAVAILABLE');
  assert.equal(f.warnings.length, 1);
});

test('没有合法回调参数时不申请权限、不启动定位', async () => {
  const f = fixture();
  await f.getGeolocation(f.page, null);
  await f.getGeolocation(f.page, {});
  assert.equal(f.stats.services, 0);
  assert.equal(f.page.state.size, 0);
  assert.equal(f.timers.size, 0);
});

test('ios：首次弹框时请求以"未决定"返回，继续等待用户选择而不是当作拒绝', async () => {
  let status = 'undetermined';
  const f = fixture('ios', { location: {
    getForegroundPermissionsAsync: async () => (status === 'granted' ? granted : { granted: false, canAskAgain: true, status }),
    requestForegroundPermissionsAsync: async () => ({ granted: false, canAskAgain: true, status: 'undetermined' }),
  } });
  const task = f.start();
  await flush();
  f.tick();
  await flush();
  assert.equal(f.page.events.length, 0);
  assert.equal(f.watches.length, 0);
  status = 'granted';
  f.tick();
  await task;
  assert.equal(f.watches.length, 1);
  assert.deepEqual([...f.timers].map((timer) => timer.ms), [20_000]);
  f.watches[0].success(position());
  assert.deepEqual(f.page.events, [{ ref: f.ref, data: success, keep: false }]);
});

test('ios：等待选择期间用户拒绝则返回权限错误；授权框阶段按 60 秒计时', async () => {
  let status = 'undetermined';
  const f = fixture('ios', { location: {
    getForegroundPermissionsAsync: async () => ({ granted: false, canAskAgain: status === 'undetermined', status }),
    requestForegroundPermissionsAsync: async () => ({ granted: false, canAskAgain: true, status: 'undetermined' }),
  } });
  const task = f.start();
  await flush();
  assert.ok([...f.timers].some((timer) => timer.ms === 60_000));
  status = 'denied';
  f.tick();
  await task;
  assertError(f, 'PERMISSION DENIED');
});

test('ios：App 未回到前台时暂缓回传，active 后才回调网页', async () => {
  const f = fixture('ios', { appState: 'inactive' });
  await f.start();
  f.watches[0].success(position());
  assert.equal(f.page.events.length, 0);
  assert.equal(f.appListeners, 1);
  f.setAppState('background');
  assert.equal(f.page.events.length, 0);
  f.setAppState('active');
  assert.deepEqual(f.page.events, [{ ref: f.ref, data: success, keep: false }]);
  assert.equal(f.appListeners, 0);
  assert.equal(f.timers.size, 0);
});

test('android：不等待前台状态，立即回传', async () => {
  const f = fixture('android', { appState: 'inactive' });
  const task = f.start();
  await flush();
  f.natives[0].reject({ code: 'TIMEOUT' });
  await task;
  assertError(f, 'TIMEOUT');
});
