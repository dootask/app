import { buildInjectedScript } from './injected';
import { isCallbackRef, type CallbackRef, type PageInfo, type Snapshot, type SnapshotPatch } from './protocol';
import { bridgeStore } from './store';
import {
  APP_VERSION_CODE,
  APP_VERSION_NAME,
  SHELL_VERSION,
  SHELL_VERSION_NAME,
} from '../config';

/**
 * WebView 页面注册表
 *
 * 每个承载前端的 WebView（主页面 firstPage、openPage 打开的二级页面）注册一个 PageHandle，
 * 模块实现通过 PageHandle 向对应 WebView 回调、执行脚本、读写页面级状态。
 */

export interface PageHandle {
  readonly pageName: string;
  readonly info: PageInfo;
  /** 在该 WebView 中执行脚本 */
  inject(js: string): void;
  /** 回调 Web 侧函数参数；keep=true 时回调可多次触发 */
  callback(ref: unknown, data?: unknown, keep?: boolean): void;
  /** 释放 keep 的回调 */
  release(ref: unknown): void;
  /** 调用 window 上的全局函数（如 __onPageResume），函数不存在时忽略 */
  invokeWindow(fnName: string, ...args: unknown[]): void;
  /** 页面级状态（模块私有数据，如返回键拦截回调），键名建议带模块前缀 */
  readonly state: Map<string, unknown>;
}

type Injector = (js: string) => void;

const pages = new Map<string, PageHandle>();

export function buildSnapshot(info: PageInfo): Snapshot {
  return {
    version: SHELL_VERSION,
    versionName: SHELL_VERSION_NAME,
    localVersion: APP_VERSION_CODE,
    localVersionName: APP_VERSION_NAME,
    themeName: bridgeStore.themeName,
    isFullscreen: bridgeStore.isFullscreen,
    keyboard: bridgeStore.keyboard,
    variates: { ...bridgeStore.variates },
    caches: { ...bridgeStore.caches },
    pageInfo: info,
    pages: { ...bridgeStore.pages },
  };
}

export function getInjectedScript(info: PageInfo): string {
  return buildInjectedScript(buildSnapshot(info));
}

export function registerPage(info: PageInfo, injector: Injector): PageHandle {
  const handle: PageHandle = {
    pageName: info.pageName,
    info,
    state: new Map(),
    inject: injector,
    callback(ref, data, keep = false) {
      if (!isCallbackRef(ref)) return;
      injector(
        `window.__eeuiBridge&&window.__eeuiBridge.callback(${JSON.stringify(ref.__cb)},${JSON.stringify(
          data ?? null,
        )},${keep ? 'true' : 'false'});true;`,
      );
    },
    release(ref) {
      if (!isCallbackRef(ref)) return;
      injector(`window.__eeuiBridge&&window.__eeuiBridge.release(${JSON.stringify(ref.__cb)});true;`);
    },
    invokeWindow(fnName, ...args) {
      injector(
        `window.__eeuiBridge&&window.__eeuiBridge.invoke(${JSON.stringify(fnName)},${JSON.stringify(args)});true;`,
      );
    },
  };
  pages.set(info.pageName, handle);
  bridgeStore.setPage(info);
  return handle;
}

export function unregisterPage(pageName: string) {
  pages.delete(pageName);
  bridgeStore.removePage(pageName);
}

export function getPage(pageName: string): PageHandle | undefined {
  return pages.get(pageName);
}

export function getAllPages(): PageHandle[] {
  return Array.from(pages.values());
}

/** 广播脚本到所有页面 */
export function broadcast(js: string) {
  for (const page of pages.values()) page.inject(js);
}

/** 调用所有页面的 window 全局函数 */
export function invokeWindowAll(fnName: string, ...args: unknown[]) {
  for (const page of pages.values()) page.invokeWindow(fnName, ...args);
}

// 同步值变化 → 广播给所有 WebView，保证同步读取一致
bridgeStore.subscribe((patch: SnapshotPatch) => {
  broadcast(`window.__eeuiBridge&&window.__eeuiBridge.patch(${JSON.stringify(patch)});true;`);
});

export type { CallbackRef };
