import { NativeModules, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

interface UmengPushNative {
  initPush(): Promise<string | null>;
  setAlias(alias: string, type: string): Promise<void>;
  removeAlias(alias: string, type: string): Promise<void>;
  getDeviceToken(): Promise<string | null>;
}

const UmengPush: UmengPushNative | undefined = (NativeModules as Record<string, unknown>)
  .UmengPush as UmengPushNative | undefined;

const ALIAS_TYPE = 'userid';
let lastRegisteredUserId: string | null = null;
let initialised = false;

export function isPushAvailable(): boolean {
  return !!UmengPush;
}

async function ensureInit(): Promise<void> {
  if (initialised || !UmengPush) return;
  try {
    await UmengPush.initPush();
    initialised = true;
  } catch (e) {
    console.warn('[push] initPush failed:', e);
  }
}

export async function registerPush(userId: string): Promise<void> {
  if (!UmengPush) {
    console.warn('[push] UmengPush native module not installed — skipping registerPush');
    return;
  }
  if (!userId) return;
  await requestNotificationPermission();
  await ensureInit();
  try {
    if (lastRegisteredUserId && lastRegisteredUserId !== userId) {
      await UmengPush.removeAlias(lastRegisteredUserId, ALIAS_TYPE);
    }
    await UmengPush.setAlias(userId, ALIAS_TYPE);
    lastRegisteredUserId = userId;
  } catch (e) {
    console.warn('[push] setAlias failed:', e);
  }
}

export async function unregisterPush(): Promise<void> {
  if (!UmengPush) return;
  if (!lastRegisteredUserId) return;
  try {
    await UmengPush.removeAlias(lastRegisteredUserId, ALIAS_TYPE);
  } catch (e) {
    console.warn('[push] removeAlias failed:', e);
  } finally {
    lastRegisteredUserId = null;
  }
}

export async function getDeviceToken(): Promise<string | null> {
  if (!UmengPush) return null;
  try {
    return await UmengPush.getDeviceToken();
  } catch {
    return null;
  }
}

async function requestNotificationPermission(): Promise<void> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.status === 'granted') return;
    if (Platform.OS === 'ios') {
      await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
    } else {
      await Notifications.requestPermissionsAsync();
    }
  } catch (e) {
    console.warn('[push] permission request failed:', e);
  }
}
