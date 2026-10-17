import { dispatchMessage, registerModule } from '../dispatcher';
import { getPage } from '../pages';
import { closePage, openPage, setPageBackPressed, type OpenPageOptions } from '../navigation';
import { bridgeStore } from '../store';

/**
 * 兼容桥核心方法（Claude 维护）
 *
 * 同步方法在页面内由快照直接返回（见 injected.ts），这里只处理其写入/异步部分。
 * 其余 eeui / webview 方法在 modules/eeui、modules/webview 中实现。
 */

registerModule('eeui', {
  setVariate(_page, key: unknown, value: unknown) {
    if (typeof key !== 'string') return;
    bridgeStore.setVariate(key, value);
  },

  setCachesString(_page, key: unknown, value: unknown, expired: unknown) {
    if (typeof key !== 'string') return;
    bridgeStore.setCachesString(key, String(value ?? ''), Number(expired) || 0);
  },

  setCaches(_page, key: unknown, value: unknown, expired: unknown) {
    if (typeof key !== 'string') return;
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    bridgeStore.setCachesString(key, str, Number(expired) || 0);
  },

  openPage(page, options: OpenPageOptions, callbackRef: unknown) {
    openPage(page, options ?? {}, callbackRef);
  },

  setPageBackPressed(page, options: { pageName?: string } | undefined, callbackRef: unknown) {
    const target = (options?.pageName && getPage(options.pageName)) || page;
    setPageBackPressed(target, callbackRef);
  },

  closePage(page, pageName: unknown) {
    closePage(page, typeof pageName === 'string' ? pageName : undefined);
  },
});

registerModule('webview', {
  sendMessage(page, payload: unknown) {
    dispatchMessage(page, payload);
  },
});
