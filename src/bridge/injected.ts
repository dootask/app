import { BRIDGE_CHANNEL, type Snapshot } from './protocol';

/**
 * 生成注入到 WebView 的启动脚本（injectedJavaScriptBeforeContentLoaded）。
 *
 * 提供 window.requireModuleJs(name)，返回 eeui 兼容模块对象：
 * - 同步方法读本地快照（见 SYNC_METHODS）
 * - 其余方法异步 postMessage 给原生，函数参数替换为回调 id
 *
 * 脚本可重复执行（Android 在 onPageStarted 注入，且页面重载时会再次注入），
 * 第二次执行只重置快照。
 */
export function buildInjectedScript(snapshot: Snapshot): string {
  return `(function () {
  var SNAPSHOT = ${JSON.stringify(snapshot)};
  if (window.__eeuiBridge) {
    window.__eeuiBridge.reset(SNAPSHOT);
    return;
  }
  var CHANNEL = ${JSON.stringify(BRIDGE_CHANNEL)};
  var snap = SNAPSHOT;
  var callbacks = {};
  var seq = 0;
  var modules = {};

  function nativePost(payload) {
    var rn = window.ReactNativeWebView;
    if (!rn || typeof rn.postMessage !== 'function') {
      console.warn('[eeuiBridge] ReactNativeWebView not ready', payload.module + '.' + payload.method);
      return;
    }
    rn.postMessage(JSON.stringify(payload));
  }

  function encodeArg(arg, depth) {
    if (typeof arg === 'function') {
      var id = 'cb_' + Date.now().toString(36) + '_' + (++seq);
      callbacks[id] = arg;
      return { __cb: id };
    }
    if (depth < 1 && arg && typeof arg === 'object' && !Array.isArray(arg)) {
      var out = {};
      for (var k in arg) {
        if (Object.prototype.hasOwnProperty.call(arg, k)) out[k] = encodeArg(arg[k], depth + 1);
      }
      return out;
    }
    return arg;
  }

  function call(module, method, args) {
    var list = [];
    for (var i = 0; i < args.length; i++) list.push(encodeArg(args[i], 0));
    nativePost({ channel: CHANNEL, module: module, method: method, args: list });
  }

  function cacheValue(key) {
    var item = snap.caches[key];
    if (!item) return undefined;
    if (item.expiredAt > 0 && item.expiredAt < Date.now()) return undefined;
    return item.value;
  }

  var SYNC_METHODS = {
    eeui: {
      getVersion: function () { return snap.version; },
      getVersionName: function () { return snap.versionName; },
      getLocalVersion: function () { return snap.localVersion; },
      getLocalVersionName: function () { return snap.localVersionName; },
      getThemeName: function () { return snap.themeName; },
      isFullscreen: function () { return snap.isFullscreen; },
      keyboardStatus: function () { return !!(snap.keyboard && snap.keyboard.visible); },
      getPageInfo: function (pageName) {
        if (!pageName || pageName === snap.pageInfo.pageName) return snap.pageInfo;
        return snap.pages[pageName] || null;
      },
      rewriteUrl: function (url) {
        try { return new URL(String(url), location.href).href; } catch (e) { return url; }
      },
      getVariate: function (key, defaultVal) {
        return Object.prototype.hasOwnProperty.call(snap.variates, key) ? snap.variates[key] : defaultVal;
      },
      setVariate: function (key, value) {
        snap.variates[key] = value;
        call('eeui', 'setVariate', [key, value]);
      },
      getCachesString: function (key, defaultVal) {
        var v = cacheValue(key);
        return v === undefined ? defaultVal : v;
      },
      getCaches: function (key, defaultVal) {
        var v = cacheValue(key);
        if (v === undefined) return defaultVal;
        try { return JSON.parse(v); } catch (e) { return v; }
      },
      setCachesString: function (key, value, expired) {
        var sec = Number(expired) || 0;
        snap.caches[key] = { value: String(value), expiredAt: sec > 0 ? Date.now() + sec * 1000 : 0 };
        call('eeui', 'setCachesString', [key, String(value), sec]);
      },
      setCaches: function (key, value, expired) {
        var str = typeof value === 'string' ? value : JSON.stringify(value);
        SYNC_METHODS.eeui.setCachesString(key, str, expired);
      }
    },
    webview: {}
  };

  // 不能代理的属性：避免被当作 thenable / 被序列化 / 被调试器误触发
  var RESERVED = { then: 1, toJSON: 1, toString: 1, valueOf: 1, constructor: 1, inspect: 1, __proto__: 1 };

  function createModule(name) {
    var sync = SYNC_METHODS[name] || {};
    var target = {};
    return new Proxy(target, {
      get: function (_t, prop) {
        if (typeof prop !== 'string' || RESERVED[prop]) return undefined;
        if (sync[prop]) return sync[prop];
        return function () { call(name, prop, Array.prototype.slice.call(arguments)); };
      },
      has: function (_t, prop) {
        return typeof prop === 'string' && !RESERVED[prop];
      }
    });
  }

  window.requireModuleJs = function (name) {
    name = name || 'eeui';
    if (!modules[name]) modules[name] = createModule(name);
    return modules[name];
  };

  window.__eeuiBridge = {
    reset: function (next) {
      snap = next;
    },
    snapshot: function () {
      return snap;
    },
    patch: function (p) {
      if (!p) return;
      if (p.themeName) snap.themeName = p.themeName;
      if (typeof p.isFullscreen === 'boolean') snap.isFullscreen = p.isFullscreen;
      if (p.keyboard) snap.keyboard = p.keyboard;
      ['variates', 'caches', 'pages'].forEach(function (field) {
        var part = p[field];
        if (!part) return;
        for (var k in part) {
          if (!Object.prototype.hasOwnProperty.call(part, k)) continue;
          if (part[k] === null) delete snap[field][k];
          else snap[field][k] = part[k];
        }
      });
    },
    callback: function (id, data, keep) {
      var fn = callbacks[id];
      if (!keep) delete callbacks[id];
      if (typeof fn !== 'function') return;
      try { fn(data); } catch (e) { console.error('[eeuiBridge] callback error', e); }
    },
    release: function (id) {
      delete callbacks[id];
    },
    invoke: function (fnName, args) {
      var fn = window[fnName];
      if (typeof fn !== 'function') return false;
      try { fn.apply(window, args || []); } catch (e) { console.error('[eeuiBridge] ' + fnName + ' error', e); }
      return true;
    }
  };
})();
true;`;
}
