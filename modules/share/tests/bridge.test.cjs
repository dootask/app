const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function setup(platform = 'ios') {
  const handlers = new Map();
  const caches = new Map();
  const writes = [];
  const source = fs.readFileSync(path.resolve(__dirname, '../../../src/features/share/index.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const mocks = {
    'react-native': { Platform: { OS: platform } },
    '../../../modules/share': { getShareModule: () => ({ writeSettings: (settings) => writes.push({ ...settings }) }) },
    '../../bridge/dispatcher': { registerMessage: (name, handler) => handlers.set(name, handler) },
    '../../bridge/store': { bridgeStore: { setCachesString: (key, value, expired) => caches.set(key, { value, expired }) } },
  };
  new Function('require', 'exports', compiled)((name) => {
    assert.ok(name in mocks, `出现未声明的依赖 ${name}`);
    return mocks[name];
  }, {});
  return { handlers, caches, writes, mocks };
}

test('两个 action 副作用注册，保留原参数与键名', () => {
  const { handlers, caches, writes } = setup();
  assert.deepEqual([...handlers.keys()], ['userChatList', 'userUploadUrl']);
  handlers.get('userChatList')({}, { action: 'userChatList', language: 'zh-Hans', url: 'https://example.test/api/users/share/list?token=a%2Bb' });
  assert.deepEqual(writes, [{ language: 'zh-Hans', chatList: 'https://example.test/api/users/share/list?token=a%2Bb' }]);
  assert.deepEqual(caches.get('language'), { value: '"zh-Hans"', expired: 0 });
  assert.equal(JSON.parse(caches.get('chatList').value), writes[0].chatList);
});

test('Android 使用同一份 bridgeStore 快照并写入原生镜像', () => {
  const { handlers, caches, writes } = setup('android');
  handlers.get('userUploadUrl')({}, { dirUrl: 'https://example.test/dir?token=测试', chatUrl: 'https://example.test/chat?token=123' });
  assert.deepEqual(writes[0], { upLoadUrl: 'https://example.test/chat?token=123', fileUpLoadUrl: 'https://example.test/dir?token=测试' });
  assert.deepEqual([...caches.keys()], ['upLoadUrl', 'fileUpLoadUrl']);
  for (const [key, { value, expired }] of caches) { assert.equal(JSON.parse(value), writes[0][key]); assert.equal(expired, 0); }
});

test('省略和空语言不覆盖先前的设置', () => {
  const { handlers, caches, writes } = setup();
  const send = handlers.get('userChatList');
  send({}, { url: 'first', language: 'ja' });
  send({}, { url: 'second' });
  send({}, { url: 'third', language: '' });
  assert.equal(caches.get('language').value, '"ja"');
  assert.deepEqual(writes.slice(1), [{ chatList: 'second' }, { chatList: 'third' }]);
});

test('退出登录或清空 URL 会覆盖原配置，避免继续使用旧 token', () => {
  const { handlers, caches, writes } = setup();
  handlers.get('userChatList')({}, { url: '' });
  handlers.get('userUploadUrl')({}, {});
  assert.deepEqual(writes, [{ chatList: '' }, { upLoadUrl: '', fileUpLoadUrl: '' }]);
  for (const { value } of caches.values()) assert.equal(value, '""');
});

test('原生落盘失败向 dispatcher 传播，不伪装成功', () => {
  const { handlers, mocks } = setup();
  mocks['../../../modules/share'].getShareModule = () => ({ writeSettings: () => { throw new Error('磁盘错误'); } });
  assert.throws(() => handlers.get('userChatList')({}, { url: '' }), /磁盘错误/);
});

test('网页环境保留快照且不加载原生能力', () => {
  const { handlers, caches, writes } = setup('web');
  handlers.get('userChatList')({}, { url: 'https://example.test' });
  assert.equal(caches.get('chatList').value, '"https://example.test"');
  assert.equal(writes.length, 0);
});
