import { requireNativeModule } from 'expo-modules-core';

interface LatestPhoto {
  uri: string;
  name: string;
  /** DATE_ADDED，单位为秒 */
  created: number;
  width: number;
  height: number;
}

interface LegacyStoreModule {
  readCaches(): Promise<string>;
  moveTaskToBack(): Promise<void>;
  /** 仅 Android */
  hideSoftInput(): Promise<void>;
  /** 仅 iOS */
  setShakeToEditEnabled(enabled: boolean): Promise<void>;
  isFullscreen(): Promise<boolean>;
  /** 仅 Android，按加入相册时间选择最新图片 */
  getLatestPhoto(): Promise<LatestPhoto | null>;
}

export function getLegacyStoreModule(): LegacyStoreModule {
  return requireNativeModule<LegacyStoreModule>('DooTaskLegacyStore');
}
