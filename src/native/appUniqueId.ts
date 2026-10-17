import { bridgeStore } from '../bridge/store';

// 与旧壳 appboard/common.js 及前端 functions/common.js 的字符表完全一致。
const CHARACTERS = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678oOLl9gqVvUuI1';

/** 必须在 migrateLegacyCaches 完成后调用，以保留升级前的设备标识。 */
export function ensureAppUniqueId(): string {
  const existing = bridgeStore.getCachesString('appUniqueId');
  if (existing.length >= 5) return existing;
  const value = Array.from({ length: 6 }, () => CHARACTERS.charAt(Math.floor(Math.random() * CHARACTERS.length))).join('');
  bridgeStore.setCachesString('appUniqueId', value, 0);
  return value;
}
