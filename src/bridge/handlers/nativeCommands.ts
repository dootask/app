import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import type { BridgeContext } from '../types';

interface SendMessagePayload {
  action: string;
  [key: string]: unknown;
}

export async function handleSendMessage(
  raw: unknown,
  ctx: BridgeContext,
): Promise<unknown> {
  const data = (raw ?? {}) as SendMessagePayload;
  const { action, ...params } = data;

  switch (action) {
    case 'initApp':
      ctx.appState.apiUrl = String(params.apiUrl ?? '');
      ctx.appState.userId = String(params.userid ?? '');
      ctx.appState.userToken = String(params.token ?? '');
      ctx.appState.language = String(params.language ?? '');
      // Push registration lives in Phase 4.
      return null;

    case 'setUmengAlias':
    case 'delUmengAlias':
      // Phase 4: wire to UMeng native module.
      return null;

    case 'setVibrate':
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return null;

    case 'setBdageNotify':
      await Notifications.setBadgeCountAsync(Number(params.bdage ?? 0));
      return null;

    case 'callTel': {
      const tel = params.tel ?? params.phone;
      if (tel) await Linking.openURL(`tel:${tel}`);
      return null;
    }

    case 'openUrl':
      if (params.url) await Linking.openURL(String(params.url));
      return null;

    case 'gotoSetting':
      await Linking.openSettings();
      return null;

    case 'getNotificationPermission': {
      const { status } = await Notifications.getPermissionsAsync();
      const granted = status === 'granted' ? 1 : 0;
      ctx.webViewRef.current?.injectJavaScript(`
        typeof window.__onNotificationPermissionStatus === 'function'
          && window.__onNotificationPermissionStatus(${granted});
        true;
      `);
      return null;
    }

    case 'updateTheme':
      // Phase 2+: propagate theme change to all active WebViews.
      return null;

    case 'windowSize':
    case 'userChatList':
    case 'userUploadUrl':
    case 'setPageData':
    case 'createTarget':
    case 'videoPreview':
    case 'picturePreview':
    case 'startMeeting':
    case 'updateMeetingInfo':
      // Implemented in later phases.
      return null;

    default:
      console.warn('[Bridge] Unknown sendMessage action:', action);
      return null;
  }
}
