import type { CacheEntry } from '../bridge/protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 旧 expired / storage_expired 是 Unix 秒；桥快照的 expiredAt 是 Unix 毫秒。 */
export function decodeLegacyCaches(raw: string, platform: string, now = Date.now()): Record<string, CacheEntry> {
  const caches: unknown = JSON.parse(raw);
  if (!isRecord(caches)) throw new Error('旧 eeui 缓存必须是字典');
  const entries: Record<string, CacheEntry> = Object.create(null);
  for (const [key, entry] of Object.entries(caches)) {
    if (!isRecord(entry) || key === '__legacyCachesMigrated') continue;
    const expired = Number(entry[platform === 'ios' ? 'storage_expired' : 'expired'] ?? 0);
    if (!Number.isFinite(expired) || expired < 0 || expired > Number.MAX_SAFE_INTEGER / 1000) continue;
    const expiredAt = expired === 0 ? 0 : Math.trunc(expired * 1000);
    if (expiredAt > 0 && expiredAt <= now) continue;
    let value = entry[key];
    if (platform === 'ios' && Number(entry.version) === 2) {
      // v2 用 JSON {value: 原值} 包装，v1 则直接存原值。
      try {
        const wrapper: unknown = typeof value === 'string' ? JSON.parse(value) : null;
        if (!isRecord(wrapper) || !Object.prototype.hasOwnProperty.call(wrapper, 'value')) continue;
        value = wrapper.value;
      } catch {
        continue;
      }
    }
    if (value === undefined) continue;
    entries[key] = { value: typeof value === 'string' ? value : JSON.stringify(value), expiredAt };
  }
  return entries;
}
