/* global __dirname: readonly */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

// 使用当前已安装的 TypeScript 和 Node 内置测试工具，不安装测试依赖。
function load(file, mocks = {}, globals = {}) {
  const filename = path.resolve(__dirname, '..', file);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, URL, Date, setTimeout, clearTimeout, console,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      throw new Error(`测试缺少模块替身: ${name}`);
    },
    ...globals,
  }, { filename });
  return module.exports;
}

function makeStore(initial = {}) {
  const caches = { ...initial };
  const variates = {};
  const writes = [];
  return {
    caches, writes,
    getCachesString: (key) => caches[key]?.value ?? '',
    setCachesString(key, value, expiredSeconds) { caches[key] = { value }; writes.push([key, value, expiredSeconds]); },
    importCaches(entries) {
      for (const [key, entry] of Object.entries(entries)) if (!Object.hasOwn(caches, key)) caches[key] = entry;
    },
    getVariate: (key, fallback) => variates[key] ?? fallback,
    setVariate: (key, value) => { variates[key] = value; },
  };
}

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function makeClock() {
  let now = 1_000_000;
  let id = 0;
  const timers = new Map();
  return {
    globals: {
      Date: class extends Date { static now() { return now; } },
      setTimeout(fn, ms) { timers.set(++id, { at: now + ms, fn }); return id; },
      clearTimeout(key) { timers.delete(key); },
    },
    async advance(ms) {
      await flush();
      const end = now + ms;
      while (true) {
        const next = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

test('迁移格式：Android、iOS v1/v2、JSON 值、永久/过期/无效条目', () => {
  const { decodeLegacyCaches } = load('legacyCacheFormat.ts');
  const now = 1_700_000_000_000;
  const android = decodeLegacyCaches(JSON.stringify({
    token: { token: 'old-token', expired: 0 },
    future: { future: { enabled: true }, expired: now / 1000 + 60 },
    expired: { expired: now / 1000 - 1 },
    stale: { stale: 'drop', expired: now / 1000 - 1 },
    invalid: { invalid: 'drop', expired: 'oops' },
  }), 'android', now);
  assert.equal(android.token.value, 'old-token');
  assert.equal(android.token.expiredAt, 0);
  assert.equal(android.future.value, '{"enabled":true}');
  assert.equal(android.future.expiredAt, now + 60_000);
  assert.equal(android.stale, undefined);
  assert.equal(android.invalid, undefined);
  const ios = decodeLegacyCaches(JSON.stringify({
    appUniqueId: { appUniqueId: '{"value":"Abc123"}', version: 2, storage_expired: 0 },
    v1: { v1: 'raw-string', storage_expired: now / 1000 + 60 },
    object: { object: '{"value":{"a":1}}', version: 2, storage_expired: 0 },
    broken: { broken: 'invalid-json', version: 2 },
    __legacyCachesMigrated: { __legacyCachesMigrated: 'old-marker' },
  }), 'ios', now);
  assert.equal(ios.appUniqueId.value, 'Abc123');
  assert.equal(ios.v1.expiredAt, now + 60_000);
  assert.equal(ios.object.value, '{"a":1}');
  assert.equal(ios.broken, undefined);
  assert.equal(ios.__legacyCachesMigrated, undefined);
  assert.throws(() => decodeLegacyCaches('[]', 'ios'));
});

test('迁移只执行一次、合并并发、不覆盖新值，读取失败后允许重试', async () => {
  const bridgeStore = makeStore({ token: { value: 'new-token', expiredAt: 0 } });
  let calls = 0;
  let fail = true;
  const { migrateLegacyCaches } = load('legacyCaches.ts', {
    'react-native': { Platform: { OS: 'android' } },
    '../../modules/legacy-store': { getLegacyStoreModule: () => ({ async readCaches() {
      calls++;
      if (fail) throw new Error('读取失败');
      return '{"token":{"token":"old-token","expired":0},"appUniqueId":{"appUniqueId":"Abc123","expired":0}}';
    } }) },
    '../bridge/store': { bridgeStore },
    './legacyCacheFormat': load('legacyCacheFormat.ts'),
  });
  await assert.rejects(migrateLegacyCaches(), /读取失败/);
  assert.equal(bridgeStore.getCachesString('__legacyCachesMigrated'), '');
  fail = false;
  const first = migrateLegacyCaches();
  assert.equal(first, migrateLegacyCaches());
  await first;
  await migrateLegacyCaches();
  assert.equal(calls, 2);
  assert.equal(bridgeStore.getCachesString('token'), 'new-token');
  assert.equal(bridgeStore.getCachesString('appUniqueId'), 'Abc123');
  assert.equal(bridgeStore.getCachesString('__legacyCachesMigrated'), '1');
});

test('设备标识保留迁移值，新标识使用旧字符表且永久保存', () => {
  const bridgeStore = makeStore();
  const { ensureAppUniqueId } = load('appUniqueId.ts', { '../bridge/store': { bridgeStore } });
  const id = ensureAppUniqueId();
  assert.match(id, /^[ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678oOLl9gqVvUuI1]{6}$/);
  assert.equal(bridgeStore.writes[0][2], 0);
  assert.equal(ensureAppUniqueId(), id);
  bridgeStore.caches.appUniqueId = { value: 'from-old-install' };
  assert.equal(ensureAppUniqueId(), 'from-old-install');
});

test('服务启动失败后重试三次，并发合并，仅就绪后记录端口', async () => {
  const clock = makeClock();
  const bridgeStore = makeStore();
  let calls = 0;
  const { ensureWebServer } = load('webServer.ts', {
    react: {}, 'react-native': {},
    '../../modules/web-server': { getWebServerModule: () => ({
      async start(port) { if (++calls <= 3) throw new Error('端口暂不可用'); return { port }; },
      async isRunning() { return true; },
    }) },
    '../bridge/store': { bridgeStore },
    '../config': { LOCAL_WEB_PORT: 22223, LOCAL_WEB_ORIGIN: 'http://localhost:22223' },
  }, clock.globals);
  const first = ensureWebServer();
  assert.equal(first, ensureWebServer());
  assert.equal(bridgeStore.writes.length, 0);
  await clock.advance(3000);
  assert.equal(await first, 'http://localhost:22223');
  assert.equal(calls, 4);
  assert.deepEqual(bridgeStore.writes, [['appWebServerPort', '22223', 0]]);
});

test('开发地址直接就绪且不读取原生服务', () => {
  const effects = [];
  const { useLocalWebReady } = load('webServer.ts', {
    react: { useState: (value) => [value, () => {}], useEffect: (fn) => effects.push(fn) },
    'react-native': {},
    '../../modules/web-server': { getWebServerModule() { throw new Error('开发模式不能读取原生模块'); } },
    '../bridge/store': {}, '../config': { DEV_WEB_URL: 'https://dev.example.test' },
  });
  assert.equal(useLocalWebReady(), 'https://dev.example.test');
  effects.forEach((fn) => fn());
});

test('前台检查：存活时复用、停止时重启、卸载时释放监听', async () => {
  const effects = [];
  let listener;
  let removed = false;
  let running = false;
  let starts = 0;
  let url = null;
  const { useLocalWebReady } = load('webServer.ts', {
    react: { useState: (value) => [value, (next) => { url = next; }], useEffect: (fn) => effects.push(fn) },
    'react-native': { AppState: { addEventListener(event, handler) {
      listener = handler; return { remove() { removed = true; } };
    } } },
    '../../modules/web-server': { getWebServerModule: () => ({
      async start(port) { starts++; running = true; return { port }; },
      async isRunning() { return running; },
    }) },
    '../bridge/store': { bridgeStore: makeStore() },
    '../config': { DEV_WEB_URL: '', MAIN_WEB_URL: 'http://localhost:22223/', LOCAL_WEB_ORIGIN: 'http://localhost:22223', LOCAL_WEB_PORT: 22223 },
  });
  useLocalWebReady();
  const cleanup = effects[0]();
  await flush();
  assert.equal(url, 'http://localhost:22223/');
  listener('active'); await flush(); assert.equal(starts, 1);
  running = false;
  listener('background'); await flush(); assert.equal(starts, 1);
  listener('active'); await flush(); assert.equal(starts, 2);
  cleanup(); assert.equal(removed, true);
});

test('深链：初始与后续事件去重、等待页面及两秒、保留测试路由、卸载清理', async () => {
  const clock = makeClock();
  const effects = [];
  const bridgeStore = makeStore();
  const calls = [];
  let page = null;
  let listener;
  let resolveInitial;
  let removed = false;
  const initial = new Promise((resolve) => { resolveInitial = resolve; });
  const { useDeepLinkHandler } = load('deepLink.ts', {
    react: { useRef: (current) => ({ current }), useEffect: (fn) => effects.push(fn) },
    'expo-linking': {
      getInitialURL: () => initial,
      addEventListener(event, handler) { listener = handler; return { remove() { removed = true; } }; },
    },
    '../bridge/store': { bridgeStore },
    './linkRouting': load('linkRouting.ts'),
  }, clock.globals);
  useDeepLinkHandler(() => page);
  const cleanups = effects.map((fn) => fn());
  const link = 'dootask://task?id=1&title="你好"';
  listener({ url: link });
  resolveInitial(link);
  await flush();
  listener({ url: link });
  await clock.advance(5000);
  assert.equal(calls.length, 0);
  assert.equal(bridgeStore.getVariate('__nativeInitialLinkHandled', false), false);
  page = { state: new Map(), invokeWindow: (...args) => calls.push(args) };
  await clock.advance(2000); assert.equal(calls.length, 0);
  await clock.advance(250); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['__handleLink', link.replace('dootask://', '')]);
  assert.equal(bridgeStore.getVariate('__nativeInitialLinkHandled', false), true);
  listener({ url: 'dootask://bridge-test?case=1' }); assert.equal(calls.length, 1);
  listener({ url: link }); assert.equal(calls.length, 2);
  cleanups.forEach((fn) => fn?.());
  listener({ url: link }); await clock.advance(3000);
  assert.equal(calls.length, 2);
  assert.equal(removed, true);
});

test('Router 业务链接回到首页，测试路由及开发客户端地址保持原路由', () => {
  const { redirectSystemPath } = load('../app/+native-intent.tsx', { '../native/linkRouting': load('linkRouting.ts') });
  assert.equal(redirectSystemPath({ path: 'dootask://task/123', initial: true }), '/');
  assert.equal(redirectSystemPath({ path: 'dootask://bridge-test?case=1', initial: false }), 'dootask://bridge-test?case=1');
  assert.equal(redirectSystemPath({ path: 'dootask:///bridge-test', initial: true }), 'dootask:///bridge-test');
  assert.equal(redirectSystemPath({ path: 'exp+dootask://expo-development-client/?url=123', initial: true }), 'exp+dootask://expo-development-client/?url=123');
});
