import type { RefObject } from 'react';
import type WebView from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';

const variateStore = new Map<string, string>();

export function setVariate(key: string, value: string): void {
  variateStore.set(key, value);
}

export function getVariate(key: string, defaultVal: string = ''): string {
  return variateStore.get(key) ?? defaultVal;
}

export function getAllVariates(): Record<string, string> {
  return Object.fromEntries(variateStore.entries());
}

export function syncVariateToWebView(
  ref: RefObject<WebView | null>,
  key: string,
  value: string,
): void {
  const payload = JSON.stringify(value);
  const keyJson = JSON.stringify(key);
  ref.current?.injectJavaScript(`
    window.__EXPO_VARIATES__ = window.__EXPO_VARIATES__ || {};
    window.__EXPO_VARIATES__[${keyJson}] = ${payload};
    true;
  `);
}

const CACHE_PREFIX = 'cache_';

interface CachedEntry {
  value: string;
  expired: number;
}

export async function setCachesString(
  key: string,
  value: string,
  expired: number = 0,
): Promise<void> {
  const entry: CachedEntry = {
    value,
    expired: expired > 0 ? Date.now() + expired * 1000 : 0,
  };
  await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
}

export async function getCachesString(
  key: string,
  defaultVal: string = '',
): Promise<string> {
  const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
  if (!raw) return defaultVal;
  try {
    const entry: CachedEntry = JSON.parse(raw);
    if (entry.expired > 0 && Date.now() > entry.expired) {
      await AsyncStorage.removeItem(CACHE_PREFIX + key);
      return defaultVal;
    }
    return entry.value;
  } catch {
    return defaultVal;
  }
}
