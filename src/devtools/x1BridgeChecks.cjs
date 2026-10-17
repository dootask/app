/* global __dirname */
/**
 * 无设备的桥协议回归：node src/devtools/x1BridgeChecks.cjs
 * 原生 API 和路由使用替身；不会验证截图画面、系统弹窗或模拟器生命周期。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function createHarness() {
  const modules = new Map();
  const calls = { urls: [], alerts: [], toasts: [], awake: [], vibration: [], styles: [], backgrounds: [], released: [] };
  const platform = { OS: 'ios', Version: '18.0', isPad: false };
  const router = { push() {}, back() {}, canGoBack: () => true };
  const storage = new Map();
  const mocks = {
    'react-native': {
      Platform: platform,
      Appearance: { getColorScheme: () => 'light' },
      Dimensions: { get: () => ({ width: 390, height: 844, scale: 3 }) },
      PixelRatio: { get: () => 3 },
      processColor: (value) => /^#[\da-f]{6}$/i.test(value) ? 1 : undefined,
      Linking: { openURL: async (url) => { calls.urls.push(url); }, openSettings: async () => { calls.settings = true; } },
      Alert: { alert: (...args) => calls.alerts.push(args) },
      Keyboard: { dismiss: () => { calls.keyboard = true; } },
      Vibration: { cancel() {}, vibrate: (duration) => calls.vibration.push(duration) },
      ToastAndroid: { TOP: 1, CENTER: 2, BOTTOM: 3, LONG: 1, SHORT: 0, showWithGravityAndOffset: (...args) => calls.toasts.push(args) },
      StyleSheet: { create: (styles) => styles },
    },
    'expo-router': { router },
    'expo-device': { manufacturer: 'Vendor', brand: 'Brand', modelId: 'iPhone17,1', modelName: 'Phone Model', deviceName: '设备名', osName: 'iOS', osVersion: '18.0' },
    'expo-application': { nativeApplicationVersion: '1.9.66', nativeBuildVersion: '10966' },
    'expo-constants': { default: {} },
    'expo-clipboard': { setStringAsync: async (text) => { calls.clipboard = text; } },
    'expo-keep-awake': {
      activateKeepAwakeAsync: async (tag) => calls.awake.push(['on', tag]),
      deactivateKeepAwake: async (tag) => calls.awake.push(['off', tag]),
    },
    'expo-status-bar': { StatusBar: { setStyle: (style) => calls.styles.push(style) } },
    'expo-system-ui': { setBackgroundColorAsync: async (color) => calls.backgrounds.push(color) },
    'react-native-view-shot': { releaseCapture: (uri) => calls.released.push(uri) },
    'react-native-safe-area-context': { initialWindowMetrics: { insets: { top: 47, bottom: 34, left: 0, right: 0 } } },
    'expo-sqlite/kv-store': {
      SQLiteStorage: class {
        getAllKeysSync() { return [...storage.keys()]; }
        getItemSync(key) { return storage.get(key); }
        setItemSync(key, value) { storage.set(key, value); }
        async setItemAsync(key, value) { storage.set(key, value); }
        removeItemSync(key) { storage.delete(key); }
        async removeItemAsync(key) { storage.delete(key); }
      },
    },
  };

  function load(file) {
    file = path.resolve(root, file);
    if (!path.extname(file)) {
      file = [file + '.ts', file + '.tsx', path.join(file, 'index.ts')].find(fs.existsSync);
    }
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const localRequire = (name) => {
      if (name in mocks) return mocks[name];
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
      return require(name);
    };
    vm.runInThisContext(`(function(require,module,exports,__DEV__){${source}\n})`, { filename: file })(localRequire, module, module.exports, false);
    return module.exports;
  }

  load('bridge/modules/index');
  const { dispatchCall, dispatchMessage } = load('bridge/dispatcher');
  const { bridgeStore } = load('bridge/store');
  function page(name) {
    const callbacks = [];
    const scripts = [];
    const releases = [];
    return {
      pageName: name,
      info: { pageName: name, pageType: 'app', url: 'web.js', params: { url: 'https://example.com/start' } },
      state: new Map(), callbacks, scripts, releases,
      callback: (ref, data, keep = false) => callbacks.push({ ref, data, keep }),
      inject: (script) => scripts.push(script),
      release: (ref) => releases.push(ref),
    };
  }
  function call(page, module, method, ...args) {
    dispatchCall(page, { channel: '__eeui__', module, method, args });
  }
  return { load, calls, platform, mocks, router, page, call, dispatchMessage, bridgeStore };
}

test('X1 接口注册，alert 确认值与取消释放，剪贴板、常亮及键盘调用', async () => {
  const h = createHarness();
  const { hasMethod, hasMessage } = h.load('bridge/dispatcher');
  for (const method of ['alert', 'toast', 'openWeb', 'keepScreenOn', 'keepScreenOff', 'keyboardHide', 'copyText', 'checkUpdate', 'shakeToEditOn', 'shakeToEditOff', 'getSafeAreaInsets', 'getDeviceInfo']) assert.ok(hasMethod('eeui', method), method);
  for (const method of ['setUrl', 'createSnapshot', 'showSnapshot', 'hideSnapshot', 'setHapticBackEnabled', 'setDisabledUserLongClickSelect', 'setScrollEnabled']) assert.ok(hasMethod('webview', method), method);
  for (const action of ['initApp', 'windowSize', 'updateTheme', 'callTel', 'setVibrate', 'gotoSetting', 'setUmengAlias', 'delUmengAlias', 'setPageData', 'createTarget', 'openUrl']) assert.ok(hasMessage(action), action);
  const p = h.page('one');
  h.call(p, 'eeui', 'alert', { title: '提示', message: '正文', button: '好的', cancelable: false }, 'alert-cb');
  const [title, message, buttons, options] = h.calls.alerts[0];
  assert.equal(title, '提示');
  assert.equal(message, '正文');
  assert.equal(buttons[0].text, '好的');
  assert.equal(options.cancelable, false);
  buttons[0].onPress();
  assert.deepEqual(p.callbacks, [{ ref: 'alert-cb', data: null, keep: false }]);
  options.onDismiss();
  assert.deepEqual(p.releases, ['alert-cb']);
  h.call(p, 'eeui', 'copyText', '中文');
  h.call(p, 'eeui', 'keepScreenOn');
  h.call(p, 'eeui', 'keepScreenOff');
  h.call(p, 'eeui', 'keyboardHide');
  assert.equal(h.calls.clipboard, '中文');
  assert.deepEqual(h.calls.awake, [['on', 'dootask.eeui'], ['off', 'dootask.eeui']]);
  assert.equal(h.calls.keyboard, true);
  assert.match(p.scripts[0], /\.blur\(/);
});

test('iOS point / Android 物理像素，设备信息字段和设备名规则', () => {
  const h = createHarness();
  const p = h.page('device');
  h.call(p, 'eeui', 'getSafeAreaInsets', 'safe');
  assert.deepEqual(p.callbacks.at(-1).data, { status: 'success', top: 47, bottom: 34, width: 390, height: 844 });
  h.call(p, 'eeui', 'getDeviceInfo', 'device');
  assert.deepEqual(p.callbacks.at(-1).data, { status: 'success', manufacturer: 'Apple', brand: 'Apple', model: 'iPhone', modelName: 'Phone Model', deviceName: '', systemName: 'iOS', systemVersion: '18.0' });
  h.platform.OS = 'android';
  h.call(p, 'eeui', 'getSafeAreaInsets', 'safe');
  assert.deepEqual(p.callbacks.at(-1).data, { status: 'success', top: 141, bottom: 102, width: 1170, height: 2532 });
  h.call(p, 'eeui', 'getDeviceInfo', 'device');
  assert.equal(p.callbacks.at(-1).data.model, 'Phone Model');
  assert.equal(p.callbacks.at(-1).data.deviceName, '');
  assert.equal(p.callbacks.at(-1).data.systemName, 'Android');
});

test('toast 字符串与对象、initApp / 尺寸 / 主题的共享快照和系统调用', async () => {
  const h = createHarness();
  const p = h.page('messages');
  h.call(p, 'eeui', 'toast', '测试');
  assert.equal(h.bridgeStore.getVariate('eeui.toast').message, '测试');
  h.platform.OS = 'android';
  h.call(p, 'eeui', 'toast', { message: '上方', gravity: 'top', long: true });
  assert.deepEqual(h.calls.toasts[0], ['上方', 1, 1, 0, 0]);
  h.call(p, 'eeui', 'toast', { message: '偏移', gravity: 'middle', x: 10, y: 20 });
  assert.deepEqual(h.calls.toasts[1], ['偏移', 0, 2, 15, 31]);
  const login = { action: 'initApp', apiUrl: 'https://example.com', userid: 7, token: 'test-token', language: 'zh', userAgent: 'ua' };
  h.dispatchMessage(p, login);
  assert.deepEqual(h.bridgeStore.getVariate('appMessage'), login);
  h.dispatchMessage(p, { action: 'windowSize', width: '430.9', height: '900' });
  assert.equal(h.bridgeStore.getVariate('windowWidth'), 430);
  assert.equal(h.bridgeStore.getVariate('windowHeight'), 900);
  h.dispatchMessage(p, { action: 'updateTheme', themeName: 'dark', themeDefault: { theme: { dark: '#111111' }, nav: { dark: '#eeeeee' } } });
  assert.equal(h.bridgeStore.getCachesString('themeName'), 'dark');
  assert.equal(h.bridgeStore.themeName, 'light');
  assert.equal(h.calls.styles.at(-1), 'light');
  assert.equal(h.calls.backgrounds.at(-1), '#111111');
  h.dispatchMessage(p, { action: 'callTel', tel: '123' });
  h.dispatchMessage(p, { action: 'openUrl', url: 'mailto:test@example.com' });
  h.dispatchMessage(p, { action: 'setVibrate' });
  h.dispatchMessage(p, { action: 'setVibrate', time: '25' });
  h.dispatchMessage(p, { action: 'gotoSetting' });
  assert.deepEqual(h.calls.urls, ['tel:123', 'mailto:test@example.com']);
  assert.deepEqual(h.calls.vibration, [500, 25]);
  assert.equal(h.calls.settings, true);
});

test('URL / 参数按页面隔离，同 URL 刷新，createTarget 白名单', () => {
  const h = createHarness();
  const { getPageWebViewState } = h.load('bridge/modules/webview/state');
  const a = h.page('a');
  const b = h.page('b');
  const actions = [];
  const state = getPageWebViewState(a);
  state.controller = { navigate: (...args) => actions.push(args) };
  h.call(a, 'webview', 'setUrl', 'https://example.com/start');
  assert.deepEqual(actions[0], ['https://example.com/start', true]);
  state.currentUrl = 'https://example.com/elsewhere';
  h.call(a, 'webview', 'setUrl', 'https://example.com/start');
  assert.deepEqual(actions[1], ['https://example.com/start', false]);
  h.call(a, 'webview', 'setUrl', 'https://example.com/elsewhere');
  assert.deepEqual(actions[2], ['https://example.com/elsewhere', true]);
  h.dispatchMessage(a, { action: 'createTarget', url: 'https://example.com/target' });
  assert.equal(state.values.url, 'https://example.com/target');
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'dootask://x', '//example.com']) h.dispatchMessage(a, { action: 'createTarget', url });
  assert.equal(state.values.url, 'https://example.com/target');
  h.dispatchMessage(a, { action: 'createTarget', url: 'tel:123' });
  assert.deepEqual(h.calls.urls, ['tel:123']);
  h.dispatchMessage(a, { action: 'setPageData', data: { titleFixed: true, urlFixed: true, moreBackText: 'Back', url: 'https://example.com/menu' } });
  assert.equal(state.values.pageData.urlFixed, true);
  assert.equal(state.values.url, 'https://example.com/target');
  assert.equal(getPageWebViewState(b).values.url, undefined);
  assert.deepEqual(getPageWebViewState(b).values.pageData, {});
});

test('快照 BOOL 回调、页面隔离、重复截图、hide 和销毁与异步截图的竞争', async () => {
  const h = createHarness();
  const { getPageWebViewState, createSnapshot, hideSnapshot, disposeWebView } = h.load('bridge/modules/webview/state');
  const a = h.page('a');
  const b = h.page('b');
  const state = getPageWebViewState(a);
  state.controller = { capture: async () => 'file:///first.png' };
  await createSnapshot(a, 'first');
  assert.equal(a.callbacks.at(-1).data, true);
  h.call(a, 'webview', 'showSnapshot');
  assert.equal(state.values.snapshotVisible, true);
  assert.equal(getPageWebViewState(b).values.snapshotVisible, false);
  let resolveCapture;
  state.controller.capture = () => new Promise((resolve) => { resolveCapture = resolve; });
  const pending = createSnapshot(a, 'pending');
  hideSnapshot(a);
  resolveCapture('file:///stale.png');
  await pending;
  assert.equal(a.callbacks.at(-1).data, false);
  assert.equal(state.values.snapshotVisible, false);
  assert.ok(h.calls.released.includes('file:///stale.png'));
  const older = createSnapshot(a, 'older');
  const resolveOlder = resolveCapture;
  const newer = createSnapshot(a, 'newer');
  resolveCapture('file:///newer.png');
  await newer;
  resolveOlder('file:///older.png');
  await older;
  assert.equal(state.values.snapshotUri, 'file:///newer.png');
  assert.deepEqual(a.callbacks.slice(-2).map((item) => [item.ref, item.data]), [['newer', true], ['older', false]]);
  const closing = createSnapshot(a, 'closing');
  disposeWebView(a);
  resolveCapture('file:///closing.png');
  await closing;
  assert.equal(a.callbacks.at(-1).data, false);
  assert.ok(h.calls.released.includes('file:///first.png'));
  assert.ok(h.calls.released.includes('file:///newer.png'));
  await createSnapshot(b, 'unbound');
  assert.equal(b.callbacks.at(-1).data, false);
});

test('滚动与选择禁用可以恢复，脚本重放不重复监听，iOS 不禁用长按', () => {
  const h = createHarness();
  const { getPageWebViewState } = h.load('bridge/modules/webview/state');
  const { webViewPreferencesScript } = h.load('bridge/modules/webview/scripts');
  const { isPageTitle, canOpenInBrowser } = h.load('bridge/modules/webview/pageOptions');
  const p = h.page('prefs');
  h.platform.OS = 'android';
  h.call(p, 'webview', 'setScrollEnabled', false);
  h.call(p, 'webview', 'setDisabledUserLongClickSelect', true);
  h.call(p, 'webview', 'setHapticBackEnabled', false);
  const values = getPageWebViewState(p).values;
  assert.equal(values.hapticBackEnabled, false);
  const elements = new Map();
  const listeners = new Map();
  const context = vm.createContext({ window: {}, document: {
    documentElement: {}, head: { appendChild: (el) => elements.set(el.id, el) },
    createElement: () => ({}), getElementById: (id) => elements.get(id),
    addEventListener: (name, fn) => { assert.ok(!listeners.has(name), name); listeners.set(name, fn); },
  } });
  const apply = (settings, android) => vm.runInContext(webViewPreferencesScript(settings, android), context);
  apply(values, true);
  assert.match([...elements.values()][0].textContent, /user-select:none/);
  let prevented = false;
  listeners.get('touchmove')({ preventDefault: () => { prevented = true; } });
  assert.ok(prevented);
  apply({ ...values, scrollEnabled: true, disabledUserLongClickSelect: false }, true);
  assert.equal([...elements.values()][0].textContent, '');
  apply({ ...values, scrollEnabled: true }, false);
  assert.equal([...elements.values()][0].textContent, '');
  for (const title of ['HitoseaTask', 'DooTask', 'about:blank', 'App']) assert.equal(isPageTitle(title), false);
  assert.equal(isPageTitle('项目'), true);
  assert.equal(canOpenInBrowser('http://localhost:22223/a'), false);
  assert.equal(canOpenInBrowser('https://example.com'), true);
  assert.equal(canOpenInBrowser('https://localhost.example.com'), true);
});

test('原 bridgeTestHtml 全部断言（WebView、时钟和路由为替身）', async () => {
  const h = createHarness();
  const pages = h.load('bridge/pages');
  const navigation = h.load('bridge/navigation');
  const { BRIDGE_TEST_HTML } = h.load('devtools/bridgeTestHtml');
  const base = Date.now();
  let now = base;
  const timers = [];
  const scriptOf = (html) => html.match(/<script>([\s\S]*)<\/script>/)[1];
  function mount(info, html) {
    const nodes = new Map();
    const node = () => ({ textContent: '', className: '', appendChild() {} });
    const document = { createElement: node, getElementById: (id) => {
      if (!nodes.has(id)) nodes.set(id, node());
      return nodes.get(id);
    } };
    let handle;
    const context = vm.createContext({
      console: { log() {}, warn() {}, error: console.error }, document, URL,
      Date: class extends Date { static now() { return now; } },
      navigator: { userAgent: 'test;system_theme/light;ios_kuaifan_eeui/1.9.66;idiom/iPhone' },
      location: { href: info.params.url ?? info.url },
      setTimeout: (fn, delay) => { timers.push({ fn, at: now + delay }); },
      ReactNativeWebView: { postMessage: (raw) => h.load('bridge/dispatcher').dispatchCall(handle, JSON.parse(raw)) },
    });
    context.window = context;
    handle = pages.registerPage(info, (js) => vm.runInContext(js, context));
    vm.runInContext(pages.getInjectedScript(info), context);
    vm.runInContext(scriptOf(html), context);
    return context;
  }
  h.router.push = ({ params: { pageName } }) => {
    const request = navigation.getOpenRequest(pageName);
    const childUrl = request.options.params.url;
    const info = { pageName, pageType: 'app', url: 'web.js', params: request.options.params };
    navigation.setPageCloser(pageName, () => {
      navigation.emitPageStatus(pageName, 'pause');
      navigation.emitPageStatus(pageName, 'stop');
      navigation.finishPage(pageName);
      pages.unregisterPage(pageName);
    });
    mount(info, decodeURIComponent(childUrl.slice(childUrl.indexOf(',') + 1)));
    navigation.emitPageStatus(pageName, 'create');
    navigation.emitPageStatus(pageName, 'start');
    navigation.emitPageStatus(pageName, 'resume');
  };
  const context = mount({ pageName: 'bridgeTest', pageType: 'app', url: 'https://example.com', params: {} }, BRIDGE_TEST_HTML);
  await Promise.resolve();
  while (timers.length) {
    timers.sort((a, b) => a.at - b.at);
    const timer = timers.shift();
    now = timer.at;
    timer.fn();
    await Promise.resolve();
  }
  const result = JSON.parse(JSON.stringify(context.__bridgeTest));
  assert.equal(result.pending, 0);
  assert.equal(result.pass, result.total, JSON.stringify(result.results.filter((item) => !item.ok)));
  assert.equal(result.total, 19);
  console.log(`[bridge-test/vm] ${result.pass} / ${result.total} passed`);
});
