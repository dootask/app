import { releaseCapture } from 'react-native-view-shot';

import type { PageHandle } from '../../pages';
import { openWeb } from '../eeui/openWeb';

const STATE_KEY = 'webview.overrides';
const WEB_SCHEME = /^(?:https?|about|data|blob|file):/i;
export const ALLOWED_TARGET_URL = /^(?:https?|mailto|tel|callto):/i;

export interface WebViewOverrideValues {
  url?: string;
  scrollEnabled: boolean;
  disabledUserLongClickSelect: boolean;
  hapticBackEnabled?: boolean;
  snapshotUri?: string;
  snapshotVisible: boolean;
  pageData: Record<string, unknown>;
}

export const DEFAULT_OVERRIDES: WebViewOverrideValues = {
  scrollEnabled: true,
  disabledUserLongClickSelect: false,
  snapshotVisible: false,
  pageData: {},
};

interface WebViewController {
  capture(): Promise<string>;
  navigate(url: string, reload: boolean): void;
}

export interface PageWebViewState {
  values: WebViewOverrideValues;
  currentUrl: string;
  listeners: Set<() => void>;
  controller?: WebViewController;
  captureVersion: number;
}

/** 所有页面状态（含订阅和原生视图访问器）归属于 PageHandle，不另建全局页面表。 */
export function getPageWebViewState(page: PageHandle): PageWebViewState {
  let state = page.state.get(STATE_KEY) as PageWebViewState | undefined;
  if (!state) {
    state = {
      values: { ...DEFAULT_OVERRIDES, pageData: {} },
      currentUrl: String(page.info.params.url ?? page.info.url),
      listeners: new Set(),
      captureVersion: 0,
    };
    page.state.set(STATE_KEY, state);
  }
  return state;
}

export function patchWebView(page: PageHandle, patch: Partial<WebViewOverrideValues>) {
  const state = getPageWebViewState(page);
  state.values = { ...state.values, ...patch };
  for (const listener of state.listeners) listener();
}

export function setPageUrl(page: PageHandle, value: unknown) {
  if (typeof value !== 'string' || !value) return;
  const state = getPageWebViewState(page);
  let url = value;
  try {
    url = new URL(value, state.currentUrl).href;
  } catch {
    // 非标准 URL 仍沿用 WebView / 系统的处理方式。
  }
  if (!WEB_SCHEME.test(url)) return openWeb(url);
  const sourceUrl = state.values.url ?? String(page.info.params.url ?? page.info.url);
  if (state.controller && (url === sourceUrl || url === state.currentUrl)) {
    // RN 会忽略与当前文档相同的 source；原 setUrl 对相同 URL 也会重新加载。
    if (url !== sourceUrl) patchWebView(page, { url });
    state.controller.navigate(url, state.currentUrl === url);
  } else {
    patchWebView(page, { url });
  }
}

export function createTarget(page: PageHandle, url: unknown) {
  if (typeof url !== 'string' || !ALLOWED_TARGET_URL.test(url)) return;
  return setPageUrl(page, url);
}

export async function createSnapshot(page: PageHandle, callbackRef: unknown) {
  const state = getPageWebViewState(page);
  const version = ++state.captureVersion;
  if (!state.controller) {
    page.callback(callbackRef, false);
    return;
  }
  try {
    const uri = await state.controller.capture();
    if (version !== state.captureVersion || !state.controller) {
      releaseCapture(uri);
      page.callback(callbackRef, false);
      return;
    }
    const previous = state.values.snapshotUri;
    patchWebView(page, { snapshotUri: uri });
    if (previous && previous !== uri) releaseCapture(previous);
    // 旧 iOS eeuiWKWebViewComponent.m:494/497 回传的是 BOOL，不是 {status}。
    page.callback(callbackRef, true);
  } catch (error) {
    console.warn('[bridge/webview] 创建快照失败', error);
    page.callback(callbackRef, false);
  }
}

export function hideSnapshot(page: PageHandle) {
  // 前台 hide 使正在后台创建的快照失效，避免异步完成后重新盖住页面。
  const state = getPageWebViewState(page);
  state.captureVersion++;
  patchWebView(page, { snapshotVisible: false });
}

export function disposeWebView(page: PageHandle) {
  const state = getPageWebViewState(page);
  state.controller = undefined;
  state.captureVersion++;
  if (state.values.snapshotUri) releaseCapture(state.values.snapshotUri);
  state.values = { ...state.values, snapshotUri: undefined, snapshotVisible: false };
}
