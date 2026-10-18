import { useEffect } from 'react';
import { AppState, Dimensions, Platform } from 'react-native';

import { getLegacyStoreModule } from '../../modules/legacy-store';
import { bridgeStore } from '../bridge/store';

/** 在根布局调用一次，维护 eeui.isFullscreen 的同步快照。 */
export function useWindowState(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;

    let mounted = true;
    let revision = 0;
    const refresh = async () => {
      const current = ++revision;
      try {
        const fullscreen = await getLegacyStoreModule().isFullscreen();
        // 快速切换窗口时，忽略旧查询和卸载后的结果。
        if (mounted && current === revision) bridgeStore.setFullscreen(fullscreen);
      } catch (error) {
        if (mounted && current === revision) console.warn('[native/windowState] 查询窗口状态失败', error);
      }
    };

    const dimensions = Dimensions.addEventListener('change', () => { void refresh(); });
    const appState = AppState.addEventListener('change', () => { void refresh(); });
    void refresh();
    return () => {
      mounted = false;
      dimensions.remove();
      appState.remove();
    };
  }, []);
}
