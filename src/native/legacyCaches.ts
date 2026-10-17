import { Platform } from 'react-native';

import { getLegacyStoreModule } from '../../modules/legacy-store';
import { bridgeStore } from '../bridge/store';
import { decodeLegacyCaches } from './legacyCacheFormat';

const MIGRATED_KEY = '__legacyCachesMigrated';
let migration: Promise<void> | null = null;

/** 不覆盖新缓存、不删除旧数据；读取或持久化失败时不设置完成标记。 */
export function migrateLegacyCaches(): Promise<void> {
  if (bridgeStore.getCachesString(MIGRATED_KEY) === '1') return Promise.resolve();
  if (migration) return migration;
  migration = (async () => {
    const raw = await getLegacyStoreModule().readCaches();
    bridgeStore.importCaches(decodeLegacyCaches(raw, Platform.OS));
    // importCaches 同步落盘，标记必须在数据导入成功之后写入。
    bridgeStore.importCaches({ [MIGRATED_KEY]: { value: '1', expiredAt: 0 } });
  })().finally(() => { migration = null; });
  return migration;
}
