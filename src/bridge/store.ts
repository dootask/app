import { Appearance } from 'react-native';
import { SQLiteStorage } from 'expo-sqlite/kv-store';

import type { CacheEntry, KeyboardState, PageInfo, SnapshotPatch } from './protocol';

/**
 * 桥接全局状态（原生侧唯一数据源）
 *
 * - variates：内存全局变量，所有 WebView 共享，App 重启清空（对应 eeui.setVariate）
 * - caches：持久化缓存，带过期时间（对应 eeui.setCachesString），启动时同步加载进内存
 * - themeName / keyboard / isFullscreen / pages：同步方法所需的运行时状态
 *
 * 任何变更都会产生 SnapshotPatch 并通知订阅者（由 pages.ts 广播给所有 WebView）。
 */

type Listener = (patch: SnapshotPatch) => void;

const CACHE_PREFIX = 'caches:';
const storage = new SQLiteStorage('dootask-bridge');

function loadCaches(): Record<string, CacheEntry> {
  const result: Record<string, CacheEntry> = {};
  const now = Date.now();
  try {
    for (const storageKey of storage.getAllKeysSync()) {
      if (!storageKey.startsWith(CACHE_PREFIX)) continue;
      const raw = storage.getItemSync(storageKey);
      if (raw == null) continue;
      const entry = JSON.parse(raw) as CacheEntry;
      if (entry.expiredAt > 0 && entry.expiredAt < now) {
        storage.removeItemSync(storageKey);
        continue;
      }
      result[storageKey.slice(CACHE_PREFIX.length)] = entry;
    }
  } catch (e) {
    console.warn('[bridge/store] load caches failed', e);
  }
  return result;
}

class BridgeStore {
  variates: Record<string, unknown> = {};
  caches: Record<string, CacheEntry> = loadCaches();
  themeName: 'light' | 'dark' = Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
  isFullscreen = false;
  keyboard: KeyboardState = { visible: false, height: 0 };
  pages: Record<string, PageInfo> = {};

  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(patch: SnapshotPatch) {
    for (const listener of this.listeners) {
      try {
        listener(patch);
      } catch (e) {
        console.warn('[bridge/store] listener error', e);
      }
    }
  }

  // ---------------- variates ----------------

  getVariate<T = unknown>(key: string, defaultVal?: T): T | undefined {
    return key in this.variates ? (this.variates[key] as T) : defaultVal;
  }

  setVariate(key: string, value: unknown) {
    this.variates[key] = value;
    this.emit({ variates: { [key]: value } });
  }

  // ---------------- caches ----------------

  getCachesString(key: string, defaultVal = ''): string {
    const entry = this.caches[key];
    if (!entry) return defaultVal;
    if (entry.expiredAt > 0 && entry.expiredAt < Date.now()) {
      this.removeCaches(key);
      return defaultVal;
    }
    return entry.value;
  }

  /** @param expiredSeconds 过期秒数，0 为永久（与 eeui 一致） */
  setCachesString(key: string, value: string, expiredSeconds = 0) {
    const entry: CacheEntry = {
      value: String(value),
      expiredAt: expiredSeconds > 0 ? Date.now() + expiredSeconds * 1000 : 0,
    };
    this.caches[key] = entry;
    storage.setItemAsync(CACHE_PREFIX + key, JSON.stringify(entry)).catch((e) => {
      console.warn('[bridge/store] persist cache failed', key, e);
    });
    this.emit({ caches: { [key]: entry } });
  }

  removeCaches(key: string) {
    if (!(key in this.caches)) return;
    delete this.caches[key];
    storage.removeItemAsync(CACHE_PREFIX + key).catch(() => {});
    this.emit({ caches: { [key]: null } });
  }

  /** 批量导入（旧 eeui 缓存迁移用），不覆盖已存在的键 */
  importCaches(entries: Record<string, CacheEntry>) {
    const patch: Record<string, CacheEntry> = {};
    for (const [key, entry] of Object.entries(entries)) {
      if (key in this.caches) continue;
      this.caches[key] = entry;
      patch[key] = entry;
      storage.setItemSync(CACHE_PREFIX + key, JSON.stringify(entry));
    }
    if (Object.keys(patch).length > 0) this.emit({ caches: patch });
  }

  // ---------------- runtime ----------------

  setThemeName(themeName: 'light' | 'dark') {
    if (this.themeName === themeName) return;
    this.themeName = themeName;
    this.emit({ themeName });
  }

  setFullscreen(isFullscreen: boolean) {
    if (this.isFullscreen === isFullscreen) return;
    this.isFullscreen = isFullscreen;
    this.emit({ isFullscreen });
  }

  setKeyboard(keyboard: KeyboardState) {
    if (this.keyboard.visible === keyboard.visible && this.keyboard.height === keyboard.height) return;
    this.keyboard = keyboard;
    this.emit({ keyboard });
  }

  setPage(info: PageInfo) {
    this.pages[info.pageName] = info;
    this.emit({ pages: { [info.pageName]: info } });
  }

  removePage(pageName: string) {
    if (!(pageName in this.pages)) return;
    delete this.pages[pageName];
    this.emit({ pages: { [pageName]: null } });
  }
}

export const bridgeStore = new BridgeStore();
