import { requireNativeModule } from 'expo-modules-core';

export interface LegacyPosition {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

interface LegacyLocationModule {
  /** 失败时 reject，code 为旧 eeui 错误码（TIMEOUT / LOCATION_DISABLED / SECURITY_EXCEPTION / UNEXPECTED_ERROR） */
  getPosition(timeoutMs: number, minAccuracy: number, maxAgeMs: number): Promise<LegacyPosition>;
}

// 仅 Android 提供；延迟加载，iOS 不读取。
export function getLegacyLocationModule(): LegacyLocationModule {
  return requireNativeModule<LegacyLocationModule>('DooTaskLegacyLocation');
}
