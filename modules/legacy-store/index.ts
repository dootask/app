import { requireNativeModule } from 'expo-modules-core';

interface LegacyStoreModule {
  readCaches(): Promise<string>;
  moveTaskToBack(): Promise<void>;
  /** 仅 Android */
  hideSoftInput(): Promise<void>;
}

export function getLegacyStoreModule(): LegacyStoreModule {
  return requireNativeModule<LegacyStoreModule>('DooTaskLegacyStore');
}
