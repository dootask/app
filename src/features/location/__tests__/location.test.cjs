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
  const stats = { asks: 0, services: 0 };
  const warnings = [];
  let methods;
  const location = {
    Accuracy: { High: 4 },
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
  const protocol = { exports: {} };
  vm.runInNewContext(protocolSource, { exports: protocol.exports });
  const module = { exports: {} };
  const mocks = {
    'expo-location': location,
    'react-native': { Platform: { OS: platform } },
    '../../bridge/protocol': protocol.exports,
    '../../bridge/dispatcher': { registerModule(name, handlers) { assert.equal(name, 'eeui'); methods = handlers; } },
  };
  vm.runInNewContext(source, {
    exports: module.exports,
    console: { warn: (...args) => warnings.push(args) },
    setTimeout(run, ms) { assert.equal(ms, 20_000); const timer = { run }; timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
    require(name) { assert.ok(Object.hasOwn(mocks, name), `缺少测试替身：${name}`); return mocks[name]; },
  });
  const page = makePage();
  const ref = { __cb: 'location-test' };
  return {
    page, ref, watches, timers, stats, warnings,
    getGeolocation: methods.getGeolocation,
    start: () => methods.getGeolocation(page, ref),
    expire() { for (const timer of [...timers]) timer.run(); },
  };
}

function assertError(f, error) {
  assert.deepEqual(f.page.events, [{ ref: f.ref, data: { status: 'error', error }, keep: false }]);
  assert.equal(f.page.state.size, 0);
  assert.equal(f.timers.size, 0);
}

for (const platform of ['android', 'ios']) {
  const denied = platform === 'ios' ? 'PERMISSION DENIED' : 'PERMISSION_DENIED';
  const disabled = platform === 'ios' ? 'UNAVAILABLE' : 'LOCATION_DISABLED';

  test(`${platform}：自注册、已授权不弹窗、WGS84 字段与一次性回调`, async () => {
    const f = fixture(platform);
    await f.start();
    assert.equal(f.stats.asks, 0);
    assert.equal(f.watches[0].config.accuracy, 4);
    assert.equal(f.watches[0].config.distanceInterval, 0);
    f.watches[0].success(position());
    f.watches[0].success(position());
    f.watches[0].error('迟到错误');
    f.expire();
    assert.deepEqual(f.page.events, [{
      ref: f.ref, data: { status: 'success', latitude: 39.9042, longitude: 116.4074 }, keep: false,
    }]);
    assert.equal(f.watches[0].removals, 1);
    assert.equal(f.page.state.size, 0);
    assert.equal(f.timers.size, 0);
  });

  test(`${platform}：首次调用请求前台权限，50 米边界可成功`, async () => {
    const f = fixture(platform, { location: { getForegroundPermissionsAsync: async () => ({ granted: false, canAskAgain: true }) } });
    await f.start();
    assert.equal(f.stats.asks, 1);
    f.watches[0].success(position(50));
    assert.equal(f.page.events[0].data.status, 'success');
  });

  for (const canAskAgain of [true, false]) {
    test(`${platform}：${canAskAgain ? '普通' : '永久'}拒绝返回旧错误字符串`, async () => {
      const f = fixture(platform, {
        permission: { granted: false, canAskAgain },
        location: { getForegroundPermissionsAsync: async () => ({ granted: false, canAskAgain }) },
      });
      await f.start();
      assert.equal(f.stats.asks, canAskAgain ? 1 : 0);
      assert.equal(f.watches.length, 0);
      assertError(f, denied);
    });
  }

  test(`${platform}：系统定位关闭及授权期间关闭均明确失败`, async () => {
    for (const enabledInitially of [false, true]) {
      let checks = 0;
      const f = fixture(platform, { location: { hasServicesEnabledAsync: async () => enabledInitially && ++checks === 1 } });
      await f.start();
      assertError(f, disabled);
      assert.equal(f.watches.length, 0);
    }
  });

  test(`${platform}：仅粗略定位或未知精度等待到 20 秒，超时后迟到事件被忽略`, async () => {
    const f = fixture(platform);
    await f.start();
    for (const accuracy of [1000, 50.1, null, -1, NaN]) f.watches[0].success(position(accuracy));
    assert.equal(f.page.events.length, 0);
    f.expire();
    f.watches[0].success(position());
    f.watches[0].error('迟到错误');
    assertError(f, 'TIMEOUT');
    assert.equal(f.watches[0].removals, 1);
  });

  test(`${platform}：运行中权限撤销、服务关闭和原生异常均失败且只回调一次`, async () => {
    for (const [reason, expected] of [
      ['Location permission is required to do this operation', denied],
      ['Location services are disabled', disabled],
      ['原生定位失败', platform === 'ios' ? '原生定位失败' : 'UNEXPECTED_ERROR'],
    ]) {
      const f = fixture(platform);
      await f.start();
      f.watches[0].error(reason);
      f.watches[0].success(position());
      assertError(f, expected);
      assert.equal(f.watches[0].removals, 1);
    }
  });
}

test('权限查询、授权弹窗或系统查询挂起均受 20 秒截止时间约束', async () => {
  for (const location of [
    { hasServicesEnabledAsync: never },
    { getForegroundPermissionsAsync: never },
    { getForegroundPermissionsAsync: async () => ({ granted: false, canAskAgain: true }), requestForegroundPermissionsAsync: never },
  ]) {
    const f = fixture('android', { location });
    void f.start();
    await flush();
    f.expire();
    assertError(f, 'TIMEOUT');
    assert.equal(f.watches.length, 0);
  }
});

test('授权晚于超时完成时不会再启动定位', async () => {
  let resolve;
  const f = fixture('ios', { location: { getForegroundPermissionsAsync: () => new Promise((done) => { resolve = done; }) } });
  const task = f.start();
  await flush();
  f.expire();
  resolve(granted);
  await task;
  assertError(f, 'TIMEOUT');
  assert.equal(f.watches.length, 0);
});

test('定位订阅建立前成功或超时，迟到句柄均被移除且不重复回调', async () => {
  for (const succeed of [true, false]) {
    let resolve;
    const f = fixture('android', { onWatch: () => new Promise((done) => { resolve = done; }) });
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
  for (const method of ['hasServicesEnabledAsync', 'getForegroundPermissionsAsync', 'requestForegroundPermissionsAsync', 'watchPositionAsync']) {
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
  const f = fixture();
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
  const f = fixture('android', { onRemove: () => { throw new Error('停止失败'); } });
  await f.start();
  f.watches[0].success({ coords: { latitude: NaN, longitude: 116, accuracy: 10 } });
  assertError(f, 'UNEXPECTED_ERROR');
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
