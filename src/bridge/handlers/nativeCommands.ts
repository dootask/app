import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import type { BridgeContext } from '../types';
import { broadcastScript } from '../webViewRegistry';
import { setCurrentTheme, type ThemeMode } from '../../services/themeBus';
import { registerPush, unregisterPush } from '../../services/push';

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
    case 'initApp': {
      const userid = String(params.userid ?? '');
      ctx.appState.apiUrl = String(params.apiUrl ?? '');
      ctx.appState.userId = userid;
      ctx.appState.userToken = String(params.token ?? '');
      ctx.appState.language = String(params.language ?? '');
      if (userid) await registerPush(userid);
      return null;
    }

    case 'setUmengAlias': {
      const alias = String(params.alias ?? params.userid ?? ctx.appState.userId ?? '');
      if (alias) await registerPush(alias);
      return null;
    }

    case 'delUmengAlias':
      await unregisterPush();
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

    case 'updateTheme': {
      const theme = String(params.theme ?? '') as ThemeMode;
      if (theme === 'light' || theme === 'dark') {
        setCurrentTheme(theme);
        // Every active WebView also gets a bridge_event so listeners (e.g. window.__onThemeChanged)
        // can react without polling.
        broadcastScript(`
          window.__EXPO_INIT_DATA__ = window.__EXPO_INIT_DATA__ || {};
          window.__EXPO_INIT_DATA__.themeName = ${JSON.stringify(theme)};
          window.dispatchEvent(new CustomEvent('bridge_event', {
            detail: { type: 'bridge_event', event: 'themeChanged', data: { theme: ${JSON.stringify(theme)} } }
          }));
          typeof window.__onThemeChanged === 'function' && window.__onThemeChanged(${JSON.stringify(theme)});
          true;
        `);
      }
      return null;
    }

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
