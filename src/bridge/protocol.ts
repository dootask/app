/**
 * eeui 兼容桥协议
 *
 * Web → Native：window.ReactNativeWebView.postMessage(JSON.stringify(BridgeCall))
 *   - 函数参数被替换为 { __cb: "<id>" }，原生通过 callback 回传
 * Native → Web：通过 injectJavaScript 调用 window.__eeuiBridge 上的方法
 *   - callback(id, data, keep)   回调；keep=true 时保留回调（可多次触发）
 *   - patch(SnapshotPatch)       同步值快照增量（变量、缓存、主题、键盘等）
 *
 * 同步方法（getVariate、getCachesString、getThemeName 等）直接读取页面内的快照，
 * 原生在值变化时向所有 WebView 广播 patch，保证同步读取的一致性。
 */

export const BRIDGE_CHANNEL = '__eeui__';

export interface CallbackRef {
  __cb: string;
}

export interface BridgeCall {
  channel: typeof BRIDGE_CHANNEL;
  module: string;
  method: string;
  args: unknown[];
}

export interface CacheEntry {
  value: string;
  /** 过期时间戳（毫秒），0 表示永久 */
  expiredAt: number;
}

export interface KeyboardState {
  visible: boolean;
  height: number;
}

export interface PageInfo {
  pageName: string;
  pageType: string;
  url: string;
  params: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Snapshot {
  version: number;
  versionName: string;
  localVersion: number;
  localVersionName: string;
  themeName: 'light' | 'dark';
  isFullscreen: boolean;
  keyboard: KeyboardState;
  variates: Record<string, unknown>;
  caches: Record<string, CacheEntry>;
  /** 当前 WebView 所在页面 */
  pageInfo: PageInfo;
  /** 所有已打开页面（getPageInfo(pageName) 查询其他页面时使用） */
  pages: Record<string, PageInfo>;
}

/** 广播增量：值为 null 表示删除该键 */
export interface SnapshotPatch {
  themeName?: Snapshot['themeName'];
  isFullscreen?: boolean;
  keyboard?: KeyboardState;
  variates?: Record<string, unknown>;
  caches?: Record<string, CacheEntry | null>;
  pages?: Record<string, PageInfo | null>;
}

export function isCallbackRef(value: unknown): value is CallbackRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as CallbackRef).__cb === 'string'
  );
}

export function parseBridgeCall(raw: string): BridgeCall | null {
  if (!raw || raw[0] !== '{') return null;
  try {
    const data = JSON.parse(raw);
    if (
      data?.channel === BRIDGE_CHANNEL &&
      typeof data.module === 'string' &&
      typeof data.method === 'string' &&
      Array.isArray(data.args)
    ) {
      return data as BridgeCall;
    }
  } catch {
    // 非桥接消息
  }
  return null;
}
