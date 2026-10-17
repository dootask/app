import { router } from 'expo-router';

import type { PageHandle } from './pages';
import { getPage } from './pages';

/**
 * eeui.openPage / closePage 的原生实现
 *
 * openPage 回调状态序列（与 eeui 一致，回调可多次触发）：
 *   ready → create → start → resume →（被覆盖/关闭时）pause → stop →（关闭时）destroy
 * 前端依赖：定位签到在子页 pause 时读取 getVariate（见 actions.js openAppChildPage 调用处）。
 */

export interface OpenPageOptions {
  pageName?: string;
  pageType?: string;
  url?: string;
  params?: Record<string, unknown>;
  softInputMode?: string;
  [key: string]: unknown;
}

export interface OpenRequest {
  pageName: string;
  options: OpenPageOptions;
  opener?: PageHandle;
  callbackRef?: unknown;
  closer?: () => void;
}

const requests = new Map<string, OpenRequest>();

function randomString(len: number) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function openPage(opener: PageHandle | undefined, options: OpenPageOptions, callbackRef?: unknown) {
  let pageName = options.pageName ? String(options.pageName) : `open_${randomString(8)}`;
  if (requests.has(pageName) || getPage(pageName)) {
    pageName = `open_${pageName}_${randomString(6)}`;
  }
  const request: OpenRequest = { pageName, options: { ...options, pageName }, opener, callbackRef };
  requests.set(pageName, request);
  emitPageStatus(pageName, 'ready');
  router.push({ pathname: '/web', params: { pageName } });
  return pageName;
}

export function getOpenRequest(pageName: string): OpenRequest | undefined {
  return requests.get(pageName);
}

/** 向打开者回调页面状态 */
export function emitPageStatus(pageName: string, status: string, extra?: Record<string, unknown>) {
  const req = requests.get(pageName);
  if (!req?.opener || !req.callbackRef) return;
  req.opener.callback(req.callbackRef, { pageName, status, ...extra }, true);
}

/** 二级页面挂载时登记关闭方法 */
export function setPageCloser(pageName: string, closer: () => void) {
  const req = requests.get(pageName);
  if (req) req.closer = closer;
}

/** 二级页面销毁 */
export function finishPage(pageName: string) {
  const req = requests.get(pageName);
  if (!req) return;
  emitPageStatus(pageName, 'destroy');
  if (req.opener && req.callbackRef) req.opener.release(req.callbackRef);
  requests.delete(pageName);
}

/** 关闭页面；不传 pageName 时关闭当前（调用者）页面 */
export function closePage(caller: PageHandle | undefined, pageName?: string) {
  const name = pageName || caller?.pageName;
  if (!name) return;
  const req = requests.get(name);
  if (req?.closer) {
    req.closer();
  } else if (req && router.canGoBack()) {
    router.back();
  }
}

// ---------------- 返回键拦截（eeui.setPageBackPressed） ----------------

const BACK_KEY = 'eeui.backPressed';

/** 设置页面返回键回调；callbackRef 为空时取消拦截 */
export function setPageBackPressed(page: PageHandle, callbackRef: unknown) {
  const prev = page.state.get(BACK_KEY);
  if (prev) page.release(prev);
  if (callbackRef) page.state.set(BACK_KEY, callbackRef);
  else page.state.delete(BACK_KEY);
}

/** 处理 Android 返回键；已被前端拦截时返回 true */
export function handleBackPress(page: PageHandle | null | undefined): boolean {
  const ref = page?.state.get(BACK_KEY);
  if (!page || !ref) return false;
  page.callback(ref, { pageName: page.pageName }, true);
  return true;
}
