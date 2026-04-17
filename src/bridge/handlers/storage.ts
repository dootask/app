import type { RefObject } from 'react';
import type WebView from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';

// In-memory mirror of the persistent cache. Lazily seeded on the first `getCachesString`
// read for a given key, and kept fresh by `setCachesString`. Used to feed
// `window.__EXPO_CACHES__` so the Vue-side sync `eeuiAppGetCachesString` fallback works.
const cacheMirror = new Map<string, string>();

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

export function getAllCaches(): Record<string, string> {
  return Object.fromEntries(cacheMirror.entries());
}

export function syncCacheToWebView(
  ref: RefObject<WebView | null>,
  key: string,
  value: string,
): void {
  const keyJson = JSON.stringify(key);
  const payload = JSON.stringify(value);
  ref.current?.injectJavaScript(`
    window.__EXPO_CACHES__ = window.__EXPO_CACHES__ || {};
    window.__EXPO_CACHES__[${keyJson}] = ${payload};
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
  cacheMirror.set(key, value);
}

export async function getCachesString(
  key: string,
  defaultVal: string = '',
): Promise<string> {
  const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
  if (!raw) {
    cacheMirror.delete(key);
    return defaultVal;
  }
  try {
    const entry: CachedEntry = JSON.parse(raw);
    if (entry.expired > 0 && Date.now() > entry.expired) {
      await AsyncStorage.removeItem(CACHE_PREFIX + key);
      cacheMirror.delete(key);
      return defaultVal;
    }
    cacheMirror.set(key, entry.value);
    return entry.value;
  } catch {
    cacheMirror.delete(key);
    return defaultVal;
  }
}
