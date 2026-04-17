import { Alert } from 'react-native';
import * as Updates from 'expo-updates';

interface CheckUpdateResult {
  status: 'success' | 'error' | 'disabled';
  available: boolean;
  error?: string;
}

/**
 * Manual OTA update check, wired to the `eeui.checkUpdate()` bridge call.
 *
 * Flow:
 *   1. Bail early if EAS Update isn't configured (dev builds, standalone without runtimeVersion).
 *   2. Ask the server if there's a compatible update.
 *   3. Download it; when the fetch completes we prompt the user to restart. The automatic
 *      check configured in app.json (`updates.checkAutomatically: ON_LOAD`) already handles
 *      background downloads, but this method keeps the Vue-side manual "检查更新" path alive.
 */
export async function checkForUpdate(options: { silent?: boolean } = {}): Promise<CheckUpdateResult> {
  if (!Updates.isEnabled) {
    return { status: 'disabled', available: false };
  }
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return { status: 'success', available: false };

    const fetchResult = await Updates.fetchUpdateAsync();
    if (!fetchResult.isNew) return { status: 'success', available: false };

    if (options.silent) return { status: 'success', available: true };

    Alert.alert('发现新版本', '已下载完成，是否立即重启生效？', [
      { text: '稍后', style: 'cancel' },
      {
        text: '立即重启',
        onPress: () => {
          Updates.reloadAsync().catch((err) => {
            console.warn('[ota] reloadAsync failed:', err);
          });
        },
      },
    ]);
    return { status: 'success', available: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn('[ota] check failed:', message);
    return { status: 'error', available: false, error: message };
  }
}
