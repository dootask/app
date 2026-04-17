export function buildInjectedJS(initData: Record<string, unknown> = {}): string {
  const initDataJson = JSON.stringify(initData);
  return `
(function() {
  if (window.__EXPO_BRIDGE_READY__) return;

  var _reqId = 0;
  var _pending = new Map();

  // Multi-callback registry (uploadPhoto etc.)
  window.__bridgeCallbacks__ = window.__bridgeCallbacks__ || {};
  window.__EXPO_INIT_DATA__ = ${initDataJson};
  window.__EXPO_VARIATES__ = window.__EXPO_VARIATES__ || {};

  var MULTI_CALLBACK_METHODS = ['uploadPhoto'];

  function handleIncoming(raw) {
    try {
      var msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'bridge_response' && _pending.has(msg.id)) {
        var entry = _pending.get(msg.id);
        _pending.delete(msg.id);
        if (msg.success) {
          entry.resolve(msg.data);
        } else {
          entry.reject(new Error(msg.error || 'bridge error'));
        }
      } else if (msg.type === 'bridge_event') {
        window.dispatchEvent(new CustomEvent('bridge_event', { detail: msg }));
      }
    } catch (e) {}
  }

  // RN posts messages via document-level "message" events (injected) and window.postMessage.
  document.addEventListener('message', function(event) { handleIncoming(event.data); });
  window.addEventListener('message', function(event) { handleIncoming(event.data); });

  function bridgeCall(module, method, args) {
    return new Promise(function(resolve, reject) {
      var id = 'req_' + (++_reqId);
      _pending.set(id, { resolve: resolve, reject: reject });
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'bridge_request',
        id: id,
        module: module,
        method: method,
        args: args || []
      }));
      setTimeout(function() {
        if (_pending.has(id)) {
          _pending.delete(id);
          reject(new Error('bridge timeout: ' + module + '.' + method));
        }
      }, 30000);
    });
  }

  function createModuleProxy(moduleName) {
    return new Proxy({}, {
      get: function(target, prop) {
        if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
        if (typeof prop !== 'string') return undefined;
        return function() {
          var args = Array.prototype.slice.call(arguments);
          var callback = null;
          if (args.length > 0 && typeof args[args.length - 1] === 'function') {
            callback = args.pop();
          }

          // Multi-callback method: register persistent callback, do not resolve via bridge_response.
          if (callback && MULTI_CALLBACK_METHODS.indexOf(prop) !== -1) {
            var id = 'req_' + (++_reqId);
            window.__bridgeCallbacks__[id] = callback;
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'bridge_request',
              id: id,
              module: moduleName,
              method: prop,
              args: args
            }));
            return;
          }

          var promise = bridgeCall(moduleName, prop, args);
          if (callback) {
            promise.then(function(data) { try { callback(data); } catch (e) {} })
                   .catch(function(e) { try { callback({ status: 'error', error: e && e.message }); } catch (_) {} });
            return;
          }
          return promise;
        };
      }
    });
  }

  window.requireModuleJs = function(name) {
    return createModuleProxy(name || 'eeui');
  };

  window.__EXPO_BRIDGE_READY__ = true;
})();
true;
`;
}
