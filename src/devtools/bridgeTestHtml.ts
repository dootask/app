/**
 * 桥接自测页（开发用）：dootask://bridge-test
 *
 * 验证 requireModuleJs 的同步快照、变量/缓存、多次回调、跨页面变量广播与 openPage 生命周期。
 * 结果显示在页面上，同时以 [bridge-test] 前缀输出到控制台。
 */

const CHILD_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:15px -apple-system,Roboto,sans-serif;padding:20px}</style></head><body>
<h3>Bridge child page</h3><div id="s">running…</div>
<script>
// Android 的启动脚本在 onPageStarted 注入，可能晚于内联脚本，需等待
(function wait(n) {
  if (typeof window.requireModuleJs !== 'function') return n < 100 ? setTimeout(function () { wait(n + 1); }, 50) : null;
  var eeui = requireModuleJs('eeui');
  var info = eeui.getPageInfo();
  eeui.setVariate('bridge-test::child', JSON.stringify({ from: info.pageName, at: Date.now() }));
  document.getElementById('s').textContent = 'pageName=' + info.pageName + '，0.8 秒后自动关闭';
  setTimeout(function () { eeui.closePage(); }, 800);
})(0);
</script></body></html>`;

const CHILD_URL = 'data:text/html;charset=utf-8,' + encodeURIComponent(CHILD_HTML);

export const BRIDGE_TEST_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Bridge Test</title>
<style>
  body{font:14px -apple-system,Roboto,sans-serif;margin:0;padding:calc(env(safe-area-inset-top) + 12px) 14px 40px}
  h2{margin:0 0 8px} .row{padding:6px 0;border-bottom:1px solid #eee;word-break:break-all}
  .ok{color:#18a058} .fail{color:#d03050} .wait{color:#999}
  #summary{font-weight:bold;margin:8px 0} button{margin:4px 4px 0 0;padding:6px 10px}
  @media (prefers-color-scheme: dark){body{background:#131313;color:#ddd}.row{border-color:#333}}
</style></head><body>
<h2>eeui Bridge Test</h2>
<div id="summary" class="wait">running…</div>
<div><button onclick="location.reload()">Reload</button><button onclick="runChild()">Open child again</button></div>
<div id="list"></div>
<script>
(function () {
  var list = document.getElementById('list');
  var results = [];
  function report(name, ok, detail) {
    results.push({ name: name, ok: ok, detail: detail });
    var div = document.createElement('div');
    div.className = 'row ' + (ok ? 'ok' : 'fail');
    div.textContent = (ok ? '✔ ' : '✘ ') + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '');
    list.appendChild(div);
    console.log('[bridge-test]', ok ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail));
    summary();
  }
  function summary() {
    var pass = results.filter(function (r) { return r.ok; }).length;
    var el = document.getElementById('summary');
    el.textContent = pass + ' / ' + results.length + ' passed' + (pending ? '（等待 ' + pending + ' 项）' : '');
    el.className = pass === results.length ? (pending ? 'wait' : 'ok') : 'fail';
    window.__bridgeTest = { pass: pass, total: results.length, pending: pending, results: results };
  }
  var pending = 0;
  function check(name, fn) {
    try { var r = fn(); report(name, r.ok, r.detail); } catch (e) { report(name, false, String(e)); }
  }

  // Android 的启动脚本在 onPageStarted 注入，可能晚于内联脚本（前端 app.js 同样会等待）
  var waited = 0;
  (function wait() {
    if (typeof window.requireModuleJs === 'function') {
      report('requireModuleJs 已注入', true, waited ? { waitedMs: waited } : undefined);
      run();
    } else if (waited >= 5000) {
      report('requireModuleJs 已注入', false);
    } else {
      waited += 50;
      setTimeout(wait, 50);
    }
  })();

  function run() {
  var eeui = requireModuleJs('eeui');
  var webview = requireModuleJs('webview');

  check('getVersion 为数字', function () { var v = eeui.getVersion(); return { ok: typeof v === 'number' && v > 0, detail: v }; });
  check('getLocalVersion 为数字', function () { var v = eeui.getLocalVersion(); return { ok: typeof v === 'number' && v > 0, detail: v }; });
  check('getLocalVersionName', function () { var v = eeui.getLocalVersionName(); return { ok: /^\\d+\\.\\d+\\.\\d+/.test(v), detail: v }; });
  check('getThemeName', function () { var v = eeui.getThemeName(); return { ok: v === 'light' || v === 'dark', detail: v }; });
  check('getPageInfo().pageName', function () { var v = eeui.getPageInfo(); return { ok: !!(v && v.pageName), detail: v && v.pageName }; });
  check('keyboardStatus 为布尔', function () { var v = eeui.keyboardStatus(); return { ok: typeof v === 'boolean', detail: v }; });
  check('isFullscreen 为布尔', function () { var v = eeui.isFullscreen(); return { ok: typeof v === 'boolean', detail: v }; });
  check('rewriteUrl 补全', function () { var v = eeui.rewriteUrl('https://a.com/b/c'); return { ok: v === 'https://a.com/b/c', detail: v }; });
  check('UA 含 kuaifan_eeui/版本', function () {
    var m = navigator.userAgent.match(/(android|ios)_kuaifan_eeui\\/([\\d.]+)/);
    return { ok: !!m && m[2] === eeui.getLocalVersionName() && /system_theme\\/(light|dark)/.test(navigator.userAgent), detail: navigator.userAgent.slice(-80) };
  });
  check('模块对象不是 thenable', function () { return { ok: eeui.then === undefined && webview.then === undefined }; });
  check('未知方法不抛异常', function () { eeui.__notExistMethod__(1, function () {}); return { ok: true }; });
  check('setVariate → getVariate（同步）', function () {
    eeui.setVariate('bridge-test::v', 'hello');
    return { ok: eeui.getVariate('bridge-test::v') === 'hello' && eeui.getVariate('bridge-test::none', 'dft') === 'dft' };
  });
  check('setCachesString → getCachesString（同步）', function () {
    eeui.setCachesString('bridge-test::c', 'world', 0);
    return { ok: eeui.getCachesString('bridge-test::c') === 'world' && eeui.getCachesString('bridge-test::none', 'dft') === 'dft' };
  });
  check('缓存持久化（启动计数）', function () {
    var n = parseInt(eeui.getCachesString('bridge-test::launch', '0')) || 0;
    eeui.setCachesString('bridge-test::launch', String(n + 1), 0);
    return { ok: true, detail: '本次为第 ' + (n + 1) + ' 次加载（重启 App 后应递增）' };
  });

  pending++;
  eeui.setCachesString('bridge-test::exp', 'x', 1);
  setTimeout(function () {
    pending--;
    var v = eeui.getCachesString('bridge-test::exp', 'expired');
    report('缓存过期（1 秒）', v === 'expired', v);
  }, 1500);

  pending++;
  Promise.resolve(eeui).then(function (m) {
    pending--;
    report('Promise.resolve(module) 可解析', m === eeui);
  });

  window.runChild = function () {
    pending++;
    summary();
    eeui.setVariate('bridge-test::child', '');
    var statuses = [];
    var done = false;
    eeui.openPage({ pageType: 'app', url: 'web.js', params: { url: ${JSON.stringify(CHILD_URL)}, titleFixed: true } }, function (res) {
      statuses.push(res.status);
      if (res.status === 'pause' && !done) {
        done = true;
        pending--;
        var raw = eeui.getVariate('bridge-test::child');
        var data = {};
        try { data = JSON.parse(raw); } catch (e) {}
        report('子页面 pause 时同步读到子页变量', !!data.from && data.from !== eeui.getPageInfo().pageName, data);
      }
      if (res.status === 'destroy') {
        var expect = ['ready', 'create', 'start', 'resume', 'pause', 'stop', 'destroy'];
        report('openPage 回调状态序列', statuses.join(',') === expect.join(','), statuses.join(','));
      }
    });
  };
  setTimeout(window.runChild, 300);
  summary();
  }
})();
</script></body></html>`;
