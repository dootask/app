import {
  Alert,
  Appearance,
  BackHandler,
  Dimensions,
  Keyboard,
  Platform,
  ToastAndroid,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

import {
  broadcastVariate,
  registerWebView,
  unregisterWebView,
} from './webViewRegistry';
import { handleOpenPage } from './handlers/navigation';
import { handleSendMessage } from './handlers/nativeCommands';
import { getLatestPhoto, uploadPhoto } from './handlers/media';
import {
  getCachesString,
  getVariate,
  setCachesString,
  setVariate,
} from './handlers/storage';
import type { BridgeContext, BridgeRequest, BridgeResponse } from './types';

let keyboardVisible = false;
Keyboard.addListener('keyboardDidShow', () => {
  keyboardVisible = true;
});
Keyboard.addListener('keyboardDidHide', () => {
  keyboardVisible = false;
});

export function createBridgeHandler(ctx: BridgeContext) {
  registerWebView(ctx.pageId, ctx.webViewRef);

  return async function handleMessage(msg: BridgeRequest): Promise<BridgeResponse> {
    try {
      const result = await routeRequest(msg, ctx);
      return { type: 'bridge_response', id: msg.id, success: true, data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { type: 'bridge_response', id: msg.id, success: false, error: message };
    }
  };
}

export function disposeBridgeContext(pageId: string): void {
  unregisterWebView(pageId);
}

async function routeRequest(msg: BridgeRequest, ctx: BridgeContext): Promise<unknown> {
  const { module, method, args } = msg;

  if (module === 'eeui') {
    return routeEeui(method, args, ctx, msg.id);
  }

  if (module === 'webview') {
    return routeWebview(method, args, ctx);
  }

  console.warn(`[Bridge] Unknown module: ${module}`);
  return null;
}

async function routeEeui(
  method: string,
  args: unknown[],
  ctx: BridgeContext,
  requestId: string,
): Promise<unknown> {
  switch (method) {
    // ---- basic info ----
    case 'getVersion':
    case 'getLocalVersion':
      return Constants.expoConfig?.version ?? '0.0.0';

    case 'getThemeName':
      return Appearance.getColorScheme() ?? 'light';

    case 'getPageInfo':
      return { pageName: ctx.isFirstPage ? 'firstPage' : ctx.pageId };

    case 'isFullscreen':
      return true;

    case 'getSafeAreaInsets':
      return {
        status: 'success',
        top: ctx.insets.top,
        bottom: ctx.insets.bottom,
        height: Dimensions.get('window').height,
      };

    case 'getDeviceInfo':
      return {
        status: 'success',
        brand: Device.brand ?? 'Unknown',
        model: Device.modelId ?? Device.modelName ?? 'Unknown',
        modelName: Device.modelName ?? 'Unknown',
        deviceName: Device.deviceName ?? 'Unknown',
        systemName: Platform.OS === 'ios' ? 'iOS' : 'Android',
        systemVersion: Device.osVersion ?? '',
      };

    // ---- keyboard ----
    case 'keyboardHide':
      Keyboard.dismiss();
      return null;

    case 'keyboardStatus':
      return keyboardVisible;

    // ---- screen ----
    case 'keepScreenOn':
      await activateKeepAwakeAsync();
      return null;

    case 'keepScreenOff':
      deactivateKeepAwake();
      return null;

    // ---- navigation ----
    case 'openPage':
      return handleOpenPage(args, ctx.navigation);

    case 'openWeb':
      if (typeof args[0] === 'string') await Linking.openURL(args[0]);
      return null;

    case 'goDesktop':
      if (Platform.OS === 'android') BackHandler.exitApp();
      return null;

    case 'setPageBackPressed':
      return null;

    // ---- UI ----
    case 'alert': {
      const obj = (args[0] ?? {}) as {
        title?: string;
        message?: string;
        buttons?: string[];
      };
      return new Promise<number>((resolve) => {
        const buttons = obj.buttons?.length ? obj.buttons : ['确定'];
        Alert.alert(
          obj.title ?? '',
          obj.message ?? '',
          buttons.map((label, index) => ({
            text: label,
            onPress: () => resolve(index),
          })),
        );
      });
    }

    case 'toast': {
      const obj = (args[0] ?? {}) as { message?: string };
      if (Platform.OS === 'android') {
        ToastAndroid.show(obj.message ?? '', ToastAndroid.SHORT);
      }
      return null;
    }

    case 'copyText':
      await Clipboard.setStringAsync(String(args[0] ?? ''));
      return null;

    // ---- scanner ----
    case 'openScaner':
      return new Promise<unknown>((resolve) => {
        if (!ctx.onRequestScan) {
          resolve({ status: 'error', error: 'scanner not available on this screen' });
          return;
        }
        ctx.onRequestScan((result) => {
          resolve({ status: 'success', text: result });
        });
      });

    // ---- media ----
    case 'getLatestPhoto':
      return getLatestPhoto();

    case 'uploadPhoto':
      return uploadPhoto(args[0], requestId, ctx.webViewRef);

    case 'cancelUploadPhoto':
      return null;

    // ---- storage ----
    case 'setVariate': {
      const key = String(args[0] ?? '');
      const value = String(args[1] ?? '');
      setVariate(key, value);
      broadcastVariate(key, value);
      return null;
    }

    case 'getVariate':
      return getVariate(String(args[0] ?? ''), String(args[1] ?? ''));

    case 'setCachesString':
      await setCachesString(
        String(args[0] ?? ''),
        String(args[1] ?? ''),
        Number(args[2] ?? 0),
      );
      return null;

    case 'getCachesString':
      return getCachesString(String(args[0] ?? ''), String(args[1] ?? ''));

    // ---- haptics / misc ----
    case 'setHapticBackEnabled':
      if (args[0]) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      return null;

    case 'checkUpdate':
      // Phase 7: expo-updates
      return null;

    case 'rewriteUrl':
      return args[0];

    case 'shakeToEditOn':
    case 'shakeToEditOff':
      return null;

    default:
      console.warn(`[Bridge] Unknown eeui method: ${method}`);
      return null;
  }
}

async function routeWebview(
  method: string,
  args: unknown[],
  ctx: BridgeContext,
): Promise<unknown> {
  switch (method) {
    case 'sendMessage':
      return handleSendMessage(args[0], ctx);

    case 'setUrl':
      // Phase 2: provide onSetUrl in BridgeContext and call here.
      return null;

    case 'setScrollEnabled':
      ctx.onSetScrollEnabled?.(args[0] !== false);
      return null;

    case 'createSnapshot':
    case 'showSnapshot':
    case 'hideSnapshot':
      // Phase 3: react-native-view-shot
      return null;

    case 'setDisabledUserLongClickSelect': {
      const disabled = Boolean(args[0]);
      const value = disabled ? "'none'" : "'auto'";
      ctx.webViewRef.current?.injectJavaScript(`
        document.body.style.webkitUserSelect = ${value};
        document.body.style.userSelect = ${value};
        true;
      `);
      return null;
    }

    default:
      console.warn(`[Bridge] Unknown webview method: ${method}`);
      return null;
  }
}
