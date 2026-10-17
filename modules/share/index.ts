import { requireNativeModule } from 'expo-modules-core';

export type ShareKey = 'language' | 'chatList' | 'upLoadUrl' | 'fileUpLoadUrl';

interface ShareModule {
  /** 同步落盘，确保紧接着切到系统分享时原生读取到本次配置。 */
  writeSettings(settings: Partial<Record<ShareKey, string>>): void;
}

export function getShareModule(): ShareModule {
  return requireNativeModule<ShareModule>('DooTaskShare');
}
