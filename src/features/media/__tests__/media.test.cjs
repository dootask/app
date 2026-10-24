/* global __dirname: readonly */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

// 使用现有 TypeScript 转译真实实现；设备 API 由可控替身替代，不增加测试依赖。
function load(file, mocks = {}) {
  const filename = path.resolve(__dirname, '..', file);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, console, URL, queueMicrotask,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      throw new Error(`测试缺少模块替身: ${name}`);
    },
  }, { filename });
  return module.exports;
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const params = load('params.ts');
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

function makePage(name = 'firstPage') {
  const events = [];
  return {
    pageName: name, state: new Map(), events,
    callback(ref, data, keep = false) { events.push({ type: 'callback', ref, data: plain(data), keep }); },
    release(ref) { events.push({ type: 'release', ref }); },
  };
}

test('参数：对象/JSON、multipart 字段、裸路径转 URI，错误参数在上传前拒绝', () => {
  const upload = params.parseUploadParams(JSON.stringify({
    url: 'https://upload.test/photo?a=1', path: '/tmp/中文 a#b?.jpg', data: { token: 'abc', n: 2, b: false },
    headers: { 'X-Test': 12 },
  }));
  assert.equal(upload.fieldName, 'file');
  assert.equal(params.filePath(upload.uri), '/tmp/中文 a#b?.jpg');
  assert.deepEqual(plain(upload.parameters), { token: 'abc', n: '2', b: 'false' });
  assert.deepEqual(plain(upload.headers), { 'X-Test': '12' });
  assert.deepEqual(plain(params.parseUploadParams({ url: 'https://upload.test', path: 'content://media/1', data: [], headers: '{}' }).parameters), {});
  for (const invalid of [null, 'bad', [], {}, { url: 'https://test' }, { url: 'file:///tmp/x', path: '/tmp/a' }, { url: 'https://test', path: 'https://test/a' }]) {
    assert.throws(() => params.parseUploadParams(invalid));
  }
});

test('预览与扫码参数：数组、path 对象、position 边界、语言、iOS 大图及连续扫码', () => {
  assert.deepEqual(plain(params.parsePictures({ paths: ['a', { path: '/tmp/a b.jpg' }, null, { src: 'ignored' }], position: 50, language: 'en' }, 'android')), {
    paths: ['a', 'file:///tmp/a%20b.jpg'], position: 1, language: 'en',
  });
  assert.equal(params.parsePictures({ paths: '["https://test/bmiddle/a"]', position: -3 }, 'ios').paths[0], 'https://test/large/a');
  assert.equal(params.parsePictures({ paths: 'https://test/one', position: 'bad' }, 'android').position, 0);
  assert.equal(params.parsePictures({ paths: [], position: Infinity }, 'ios').position, 0);
  assert.equal(params.parseScannerOptions('{"continuous":"true","title":"扫码"}').continuous, true);
  assert.equal(params.parseScannerOptions({ continuous: 'false' }).continuous, false);
  assert.equal(params.parseScannerOptions('描述').desc, '描述');
});

test('缩略图裁切与缩放：普通横竖图、全景、长截图、小图', () => {
  assert.deepEqual(plain(params.thumbnailPlan(4000, 3000).size), { width: 400, height: 300 });
  assert.deepEqual(plain(params.thumbnailPlan(3000, 4000).size), { width: 300, height: 400 });
  const wide = params.thumbnailPlan(10000, 1000);
  assert.deepEqual(plain(wide.crop), { originX: 2500, originY: 0, width: 5000, height: 1000 });
  assert.deepEqual(plain(wide.size), { width: 1500, height: 300 });
  assert.equal(params.thumbnailPlan(100, 10000).crop.originY, 4750);
  assert.deepEqual(plain(params.thumbnailPlan(20, 20).size), { width: 300, height: 300 });
});

test('照片时间：SDK 58 原生毫秒转换为旧契约的秒，同时兼容类型声明的秒值', () => {
  assert.equal(params.photoCreated(1_700_000_001_234, 'ios'), 1_700_000_001.234);
  assert.equal(params.photoCreated(1_700_000_001_234, 'android'), 1_700_000_001);
  assert.equal(params.photoCreated(1_700_000_001, 'ios'), 1_700_000_001);
  assert.equal(params.photoCreated(null, 'android'), 0);
});

function uploadFixture(platform) {
  const pages = [makePage()];
  const tasks = [];
  class File { constructor(uri) { this.uri = uri; this.exists = !uri.includes('missing'); } }
  class UploadTask {
    constructor(file, url, options) {
      Object.assign(this, { file, url, options, state: 'idle', releases: 0, starts: 0 });
      this.promise = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
      tasks.push(this);
    }
    uploadAsync() { this.starts++; this.state = 'active'; return this.promise; }
    cancel() { this.state = 'cancelled'; if (this.starts) this.reject(new Error('native abort')); }
    release() { this.releases++; }
  }
  const impl = load('upload.ts', {
    'expo-file-system': { File, UploadTask, UploadType: { MULTIPART: 1 } },
    'react-native': { Platform: { OS: platform } },
    '../../bridge/pages': { getAllPages: () => pages }, './params': params,
  });
  const options = { url: 'https://upload.test/file', path: '/tmp/a.jpg', fieldName: 'photo', data: { n: 12 }, headers: { Authorization: 'test' } };
  return { ...impl, pages, page: pages[0], tasks, options };
}

for (const platform of ['ios', 'android']) {
  test(`上传 ${platform}：ready 先到、POST multipart、平台响应与结束释放`, async () => {
    const f = uploadFixture(platform);
    const pending = f.uploadPhoto(f.page, f.options, 'upload');
    assert.deepEqual(f.page.events.map((e) => e.data?.status), ['ready']);
    assert.equal(f.page.events[0].data.id, f.options.url);
    assert.equal(f.tasks[0].options.uploadType, 1);
    assert.equal(f.tasks[0].options.httpMethod, 'POST');
    assert.equal(f.tasks[0].options.fieldName, 'photo');
    assert.equal(f.tasks[0].options.parameters.n, '12');
    assert.equal(f.tasks[0].options.headers.Authorization, 'test');
    const body = '{"ret":1,"data":{"id":3}}';
    f.tasks[0].resolve({ status: 201, body });
    await pending;
    assert.deepEqual(f.page.events.map((e) => e.type), ['callback', 'callback', 'release']);
    assert.equal(f.page.events[0].keep, true);
    assert.equal(f.page.events[1].keep, true);
    assert.deepEqual(f.page.events[1].data, { status: 'success', statusCode: 201, data: platform === 'ios' ? JSON.parse(body) : body });
    assert.equal(f.tasks[0].releases, 1);
    assert.equal(f.page.state.get('media.uploads').size, 0);
    assert.equal(f.uploadResponse({ status: 500, body: 'bad' }, platform).status, platform === 'ios' ? 'error' : 'success');
    assert.equal(f.uploadResponse({ status: 200, body: 'not json' }, platform).data, 'not json');
  });

  test(`取消 ${platform}：取消回调成功，原回调按旧平台行为结束，无迟到成功或重复取消`, async () => {
    const f = uploadFixture(platform);
    const pending = f.uploadPhoto(f.page, f.options, 'upload');
    f.cancelUploadPhoto(f.page, f.options.url, 'cancel');
    await pending;
    const callbacks = f.page.events.filter((e) => e.type === 'callback');
    assert.deepEqual(callbacks.map((e) => [e.ref, e.data.status]), platform === 'ios'
      ? [['upload', 'ready'], ['cancel', 'success']]
      : [['upload', 'ready'], ['cancel', 'success'], ['upload', 'error']]);
    assert.equal(f.page.events.filter((e) => e.type === 'release' && e.ref === 'upload').length, 1);
    f.cancelUploadPhoto(f.page, f.options.url, 'again');
    assert.equal(f.page.events.at(-1).data.error, '未找到上传任务或已取消');
    assert.equal(f.tasks[0].releases, 1);
  });

  test(`ready 内立即取消 ${platform}：登记已完成，原生请求不启动，句柄仍释放`, async () => {
    const f = uploadFixture(platform);
    const callback = f.page.callback;
    f.page.callback = (ref, data, keep) => {
      callback(ref, data, keep);
      if (data.status === 'ready') f.cancelUploadPhoto(f.page, data.id, 'cancel');
    };
    await f.uploadPhoto(f.page, f.options, 'upload');
    assert.equal(f.tasks[0].starts, 0);
    assert.equal(f.tasks[0].releases, 1);
    assert.equal(f.page.events.find((e) => e.ref === 'cancel').data.status, 'success');
  });

  test(`取消后原生迟到成功 ${platform}：完成结果不会再次触发上传回调`, async () => {
    const f = uploadFixture(platform);
    const pending = f.uploadPhoto(f.page, f.options, 'upload');
    f.tasks[0].cancel = function () { this.state = 'cancelled'; };
    f.cancelUploadPhoto(f.page, f.options.url, 'cancel');
    f.tasks[0].resolve({ status: 200, body: '{}' });
    await pending;
    assert.equal(f.page.events.some((e) => e.ref === 'upload' && e.data?.status === 'success'), false);
    assert.equal(f.page.events.filter((e) => e.type === 'release' && e.ref === 'upload').length, 1);
  });
}

test('上传失败、空 ID、未知任务、原生已完成时取消，以及跨页面取消', async () => {
  const f = uploadFixture('android');
  await f.uploadPhoto(f.page, { ...f.options, path: '/missing.jpg' }, 'missing');
  assert.equal(f.tasks.length, 0);
  assert.equal(f.page.events.at(-1).data.error, '文件不存在');
  f.cancelUploadPhoto(f.page, '', 'empty');
  assert.equal(f.page.events.at(-1).data.error, '上传ID不能为空');
  let pending = f.uploadPhoto(f.page, f.options, 'network');
  f.tasks[0].reject(new Error('offline'));
  await pending;
  assert.match(f.page.events.at(-2).data.error, /offline/);
  pending = f.uploadPhoto(f.page, f.options, 'completed');
  f.tasks[1].state = 'completed';
  f.tasks[1].resolve({ status: 200, body: 'ok' });
  f.cancelUploadPhoto(f.page, f.options.url, 'tooLate');
  assert.equal(f.page.events.at(-1).data.status, 'error');
  await pending;
  assert.equal(f.page.events.at(-2).data.status, 'success');
  pending = f.uploadPhoto(f.page, f.options, 'cross');
  const child = makePage('child'); f.pages.push(child);
  f.cancelUploadPhoto(child, f.options.url, 'crossCancel');
  await pending;
  assert.equal(child.events[0].data.status, 'success');
  assert.equal(f.page.events.at(-1).type, 'release');
});

test('同 URL 并发：先发完成不会移除后发任务，取消指向最新任务', async () => {
  const f = uploadFixture('ios');
  const first = f.uploadPhoto(f.page, f.options, 'first');
  const second = f.uploadPhoto(f.page, f.options, 'second');
  f.tasks[0].resolve({ status: 200, body: '{}' });
  await first;
  assert.equal(f.page.state.get('media.uploads').size, 1);
  f.cancelUploadPhoto(f.page, f.options.url, 'cancel');
  await second;
  assert.equal(f.tasks[1].state, 'cancelled');
  assert.equal(f.page.events.some((e) => e.ref === 'second' && e.data?.status === 'success'), false);
});

function scannerFixture(platform, continuous = false) {
  const page = makePage();
  const impl = load('requests.ts', { '../../bridge/pages': { getPage: (name) => name === page.pageName ? page : undefined } });
  const request = { kind: 'scanner', users: 0, callbackRef: 'scan', options: params.parseScannerOptions({ continuous }), created: false, finished: false, scanned: false, lastResultAt: -Infinity };
  const id = impl.addRequest(page, request);
  return { ...impl, page, request, id, platform, handle: impl.findRequest(page.pageName, id) };
}

for (const platform of ['ios', 'android']) {
  test(`扫码 ${platform}：create → light → success → destroy，保留/释放回调与格式`, () => {
    const f = scannerFixture(platform);
    f.createScanner(f.page, f.request); f.createScanner(f.page, f.request);
    f.scannerLight(f.page, f.request, true);
    assert.equal(f.scannerResult(f.page, f.request, platform, 'hello', 'qr', 'camera', 1000), true);
    f.scannerResult(f.page, f.request, platform, 'duplicate', 'qr', 'camera', 2000);
    f.removeRequest(f.handle); f.removeRequest(f.handle);
    assert.deepEqual(f.page.events.map((e) => e.data?.status ?? e.type), ['create', 'openLight', 'success', 'destroy', 'release']);
    const result = f.page.events[2].data;
    assert.equal(result.text, 'hello');
    assert.equal(result.format, platform === 'ios' ? 'QRCode' : 'QR_CODE');
    assert.equal(result.pageName, platform === 'ios' ? 'scanPage' : undefined);
    assert.equal(f.page.events.filter((e) => e.type === 'callback').every((e) => e.keep), true);
    assert.equal(f.findRequest(f.page.pageName, f.id), null);
  });
}

test('连续扫码节流、图片来源、提前返回、失效页面与 StrictMode 重挂载清理', async () => {
  const f = scannerFixture('ios', true);
  const release = f.retainRequest(f.handle);
  f.createScanner(f.page, f.request);
  f.scannerResult(f.page, f.request, 'ios', 'one', 'qr', 'photo', 1000);
  f.scannerResult(f.page, f.request, 'ios', 'dup', 'qr', 'photo', 1100);
  f.scannerResult(f.page, f.request, 'ios', 'two', 'ean13', 'camera', 1400);
  assert.deepEqual(f.page.events.filter((e) => e.data?.text).map((e) => e.data.text), ['one', 'two']);
  assert.equal(f.page.events[1].data.source, 'photo');
  release();
  const remount = f.retainRequest(f.handle);
  await flush();
  assert.equal(f.request.finished, false);
  remount(); await flush();
  assert.equal(f.page.events.at(-2).data.status, 'destroy');
  assert.equal(f.findRequest('missing', f.id), null);
  const early = scannerFixture('android');
  early.removeRequest(early.handle);
  assert.deepEqual(early.page.events.map((e) => e.type), ['release']);
});

test('缩放：保持双指中点、1–5 倍限制、平移边界与黑边', () => {
  const { containSize, pinchZoom, constrainZoom } = load('zoom.ts');
  const viewport = { width: 400, height: 800 };
  const image = containSize({ width: 1200, height: 600 }, viewport);
  assert.deepEqual(plain(image), { width: 400, height: 200 });
  assert.deepEqual(plain(containSize({ width: 0, height: 0 }, viewport)), viewport);
  assert.deepEqual(plain(pinchZoom({ scale: 1, x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 0 }, 2)), { scale: 2, x: -50, y: 0 });
  assert.deepEqual(plain(constrainZoom({ scale: 10, x: 9999, y: 9999 }, image, viewport)), { scale: 5, x: 800, y: 100 });
  const reset = constrainZoom({ scale: 0.5, x: 40, y: 50 }, image, viewport);
  assert.equal(reset.scale, 1); assert.equal(Math.abs(reset.x), 0); assert.equal(Math.abs(reset.y), 0);
});

test('双击：以点击位置为中心放大 2.5 倍并受边界约束，已放大时还原', () => {
  const { doubleTapZoom } = load('zoom.ts');
  const viewport = { width: 400, height: 800 };
  const image = { width: 400, height: 800 };
  assert.deepEqual(plain(doubleTapZoom({ scale: 1, x: 0, y: 0 }, { x: 100, y: -100 }, image, viewport)), { scale: 2.5, x: -150, y: 150 });
  // 点在角落时平移被限制在图片边缘内。
  assert.deepEqual(plain(doubleTapZoom({ scale: 1, x: 0, y: 0 }, { x: 200, y: 400 }, image, viewport)), { scale: 2.5, x: -300, y: -600 });
  assert.deepEqual(plain(doubleTapZoom({ scale: 2.5, x: -150, y: 150 }, { x: 0, y: 0 }, image, viewport)), { scale: 1, x: 0, y: 0 });
});

test('下拉关闭：只计向下进度，距离或快速下甩触发，上滑与回拉不关闭', () => {
  const { dismissProgress, dismissScale, shouldDismiss, DISMISS_DISTANCE } = load('zoom.ts');
  assert.equal(dismissProgress(-80), 0);
  assert.equal(dismissProgress(120), 0.5);
  assert.equal(dismissProgress(9999), 1);
  assert.equal(dismissScale(0), 1);
  assert.ok(Math.abs(dismissScale(1) - 0.6) < 1e-9);
  assert.equal(shouldDismiss(DISMISS_DISTANCE, 0), true);
  assert.equal(shouldDismiss(DISMISS_DISTANCE - 1, 100), false);
  assert.equal(shouldDismiss(40, 1200), true);
  assert.equal(shouldDismiss(10, 1200), false);
  assert.equal(shouldDismiss(200, -300), false);
  assert.equal(shouldDismiss(-200, 2000), false);
});

function photoFixture(platform, options = {}) {
  const page = makePage();
  const calls = [];
  const files = new Map();
  let saved = 0;
  class File {
    constructor(...parts) { this.uri = parts.join('/'); }
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri) ?? 123; }
    async copy(destination) { calls.push(['copy', this.uri]); files.set(destination.uri, 4000); }
    delete() { calls.push(['delete', this.uri]); files.delete(this.uri); }
  }
  const asset = {
    id: 'content://media/123', getUri: async () => 'file:///library/a.heic', getFilename: async () => 'a.heic',
    getCreationTime: async () => 1_700_000_001_000, getShape: async () => options.missingSize ? null : { width: 4000, height: 3000 },
  };
  class Query {
    eq(...args) { calls.push(['eq', ...args]); return this; }
    orderBy(order) { calls.push(['order', plain(order)]); return this; }
    limit(n) { calls.push(['limit', n]); return this; }
    async exe() { return options.empty ? [] : [asset]; }
  }
  const ImageManipulator = {
    manipulate(uri, loadOptions) {
      calls.push(['manipulate', typeof uri === 'string' ? uri : 'image', loadOptions]);
      let size = { width: 4000, height: 3000 };
      return {
        crop(value) { calls.push(['crop', plain(value)]); },
        resize(value) { size = value; },
        async renderAsync() {
          return {
            ...size, release() { calls.push(['image.release']); },
            async saveAsync(saveOptions) {
              calls.push(['save', plain(saveOptions)]);
              if (options.thumbnailError && saveOptions.base64) throw new Error('thumbnail failed');
              const uri = `file:///cache/out${++saved}.jpg`;
              files.set(uri, 500);
              return { uri, ...size, ...(saveOptions.base64 ? { base64: 'aGVsbG8=' } : {}) };
            },
          };
        },
        release() { calls.push(['context.release']); },
      };
    },
  };
  const permission = options.denied ? { granted: false, canAskAgain: false }
    : options.request ? { granted: false, canAskAgain: true } : { granted: true, accessPrivileges: 'limited' };
  const impl = load('latestPhoto.ts', {
    'expo-file-system': { File, Paths: { cache: 'file:///cache' } },
    'expo-image-manipulator': { ImageManipulator, SaveFormat: { JPEG: 'jpeg' } },
    'expo-media-library': {
      Query, AssetField: { MEDIA_TYPE: 'mediaType', CREATION_TIME: 'creationTime' }, MediaType: { IMAGE: 'image' },
      async getPermissionsAsync(writeOnly, granular) { calls.push(['permission', writeOnly, plain(granular)]); return permission; },
      async requestPermissionsAsync(writeOnly, granular) {
        if (!options.request) throw new Error('已决定的权限不能再次请求');
        calls.push(['requestPermission', writeOnly, plain(granular)]);
        return { granted: true };
      },
    },
    'react-native': { Platform: { OS: platform } }, './params': params,
    '../../../modules/legacy-store': {
      getLegacyStoreModule: () => ({
        // Android 原生按 DATE_ADDED DESC 取一条，created 已是秒值
        async getLatestPhoto() {
          calls.push(['nativeLatest']);
          if (options.empty) return null;
          const size = options.missingSize ? { width: 0, height: 0 } : { width: 4000, height: 3000 };
          return { uri: 'content://media/123', name: 'a.heic', created: 1_700_000_001, ...size };
        },
      }),
    },
  });
  return { ...impl, page, calls, files };
}

for (const platform of ['ios', 'android']) {
  test(`最近照片 ${platform}：有限权限、时间单位、前缀、路径、元数据与资源释放`, async () => {
    const f = photoFixture(platform, { missingSize: true });
    await f.getLatestPhoto(f.page, 'photo');
    assert.equal(f.page.events.length, 1);
    const result = f.page.events[0].data;
    assert.equal(result.status, 'success');
    assert.equal(result.created, 1_700_000_001);
    assert.equal(result.thumbnail.base64, 'data:image/jpeg;base64,aGVsbG8=');
    assert.equal(result.original.path.startsWith('/cache/'), true);
    assert.equal(result.original.width, 4000);
    assert.equal(result.original.name, 'a.heic');
    assert.deepEqual(f.calls.find((c) => c[0] === 'permission'), ['permission', false, ['photo']]);
    if (platform === 'ios') assert.deepEqual(f.calls.find((c) => c[0] === 'order')[1], { key: 'creationTime', ascending: false });
    else {
      assert.equal(f.calls.some((c) => c[0] === 'order'), false);
      assert.deepEqual(f.calls.find((c) => c[0] === 'copy'), ['copy', 'content://media/123']);
    }
    assert.equal(f.calls.filter((c) => c[0] === 'save' && !c[1].base64).length, platform === 'ios' ? 1 : 0);
    assert.equal(f.calls.filter((c) => c[0] === 'context.release').length, f.calls.filter((c) => c[0] === 'image.release').length);
    assert.equal(f.calls.some((c) => c[0] === 'delete'), false);
  });
}

test('照片拒权/空相册/缩略图异常：均单次错误回调，失败产物清理', async () => {
  for (const options of [{ denied: true }, { empty: true }, { thumbnailError: true }]) {
    const f = photoFixture('android', options);
    await f.getLatestPhoto(f.page, 'photo');
    assert.equal(f.page.events.length, 1);
    assert.equal(f.page.events[0].data.status, 'error');
    assert.equal(f.files.size, 0);
  }
});

test('照片首次授权只申请 photo 粒度，授权后返回完整数据', async () => {
  const f = photoFixture('android', { request: true });
  await f.getLatestPhoto(f.page, 'photo');
  assert.deepEqual(f.calls.find((c) => c[0] === 'requestPermission'), ['requestPermission', false, ['photo']]);
  assert.equal(f.page.events[0].data.status, 'success');
});

test('副作用注册、扫码授权和路由参数：请求留在调用页面，不把媒体数组塞入 URL', async () => {
  const modules = {};
  const messages = {};
  const pages = [makePage(), makePage('child')];
  const requests = load('requests.ts', { '../../bridge/pages': { getPage: (name) => pages.find((p) => p.pageName === name) } });
  const pushes = [];
  let granted = true;
  load('index.ts', {
    'expo-camera': { Camera: { async getCameraPermissionsAsync() { return { granted, canAskAgain: false }; } } },
    'expo-router': { router: { push: (value) => pushes.push(plain(value)) } },
    'react-native': { Alert: { alert() {} }, Linking: {}, Platform: { OS: 'android' } },
    '../../bridge/dispatcher': {
      registerModule(name, handlers) { modules[name] = handlers; },
      registerMessage(name, handler) { messages[name] = handler; },
    },
    '../../bridge/pages': { getPage: (name) => pages.find((p) => p.pageName === name) },
    './latestPhoto': { getLatestPhoto() {} }, './upload': { uploadPhoto() {}, cancelUploadPhoto() {} },
    './params': params, './requests': requests,
  });
  assert.deepEqual(Object.keys(modules.eeui).sort(), ['cancelUploadPhoto', 'getLatestPhoto', 'openScaner', 'uploadPhoto']);
  messages.picturePreview(pages[1], { paths: ['https://test/1', 'https://test/2'], position: 1 });
  assert.equal(pushes[0].pathname, '/media-preview');
  assert.equal(pushes[0].params.mediaPage, 'child');
  assert.equal(Object.hasOwn(pushes[0].params, 'paths'), false);
  const preview = requests.findRequest('child', pushes[0].params.mediaRequest);
  assert.equal(preview.request.position, 1);
  assert.equal(requests.findRequest('firstPage', pushes[0].params.mediaRequest), null);
  messages.picturePreview(pages[0], { paths: [] });
  messages.videoPreview(pages[0], { path: '' });
  assert.equal(pushes.length, 1);
  await modules.eeui.openScaner(pages[0], {}, 'scan');
  assert.equal(pushes[1].pathname, '/scanner');
  granted = false;
  await modules.eeui.openScaner(pages[0], {}, 'denied');
  assert.equal(pushes.length, 2);
  assert.deepEqual(pages[0].events.at(-1), { type: 'release', ref: 'denied' });
});

test('iOS 扫码拒权仍按 create → destroy 结束；授权期间调用页销毁时不再推路由', async () => {
  const page = makePage();
  let owner = page;
  let method;
  let permission = Promise.resolve({ granted: false, canAskAgain: false });
  const requests = load('requests.ts', { '../../bridge/pages': { getPage: () => owner } });
  let pushes = 0;
  load('index.ts', {
    'expo-camera': { Camera: { getCameraPermissionsAsync: () => permission } },
    'expo-router': { router: { push() { pushes++; } } },
    'react-native': { Alert: { alert() {} }, Linking: {}, Platform: { OS: 'ios' } },
    '../../bridge/dispatcher': { registerModule(_name, handlers) { method = handlers.openScaner; }, registerMessage() {} },
    '../../bridge/pages': { getPage: () => owner }, './latestPhoto': { getLatestPhoto() {} },
    './upload': { uploadPhoto() {}, cancelUploadPhoto() {} }, './params': params, './requests': requests,
  });
  await method(page, {}, 'denied');
  assert.deepEqual(page.events.map((e) => e.data?.status ?? e.type), ['create', 'destroy', 'release']);
  let resolvePermission;
  permission = new Promise((resolve) => { resolvePermission = resolve; });
  const pending = method(page, {}, 'gone');
  owner = undefined;
  resolvePermission({ granted: true });
  await pending;
  assert.equal(pushes, 0);
  assert.equal(page.state.get('media.requests').size, 0);
});
