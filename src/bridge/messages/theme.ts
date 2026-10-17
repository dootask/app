import { useMemo, useSyncExternalStore } from 'react';
import { processColor } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';

import { bridgeStore } from '../store';

const DEFAULT_COLORS = {
  theme: { dark: '#131313', light: '#f8f8f8' },
  nav: { dark: '#cdcdcd', light: '#232323' },
};

function validColor(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  try {
    return processColor(value) == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function themeSnapshot() {
  return JSON.stringify([
    bridgeStore.themeName,
    bridgeStore.getCachesString('themeName'),
    bridgeStore.getCachesString('themeDefault', '{}'),
  ]);
}

function resolveTheme(snapshot: string) {
  const [systemTheme, cachedTheme, colors] = JSON.parse(snapshot) as [string, string, string];
  const themeName = cachedTheme === 'dark' || cachedTheme === 'light' ? cachedTheme : systemTheme === 'dark' ? 'dark' : 'light';
  let config: Record<string, Record<string, unknown>> = {};
  try {
    config = JSON.parse(colors) ?? {};
  } catch {
    // 缓存损坏时使用旧壳的默认配色。
  }
  return {
    themeName,
    backgroundColor: validColor(config.theme?.[themeName], DEFAULT_COLORS.theme[themeName]),
    navColor: validColor(config.nav?.[themeName], DEFAULT_COLORS.nav[themeName]),
  };
}

const subscribe = (listener: () => void) => bridgeStore.subscribe((patch) => {
  if (patch.themeName || patch.caches?.themeName !== undefined || patch.caches?.themeDefault !== undefined) listener();
});

/** 应用选择的主题与 eeui.getThemeName 返回的系统主题分开，均由 bridgeStore 提供。 */
export function useAppTheme() {
  const snapshot = useSyncExternalStore(subscribe, themeSnapshot, themeSnapshot);
  return useMemo(() => resolveTheme(snapshot), [snapshot]);
}

export function updateTheme(payload: Record<string, unknown>) {
  if (payload.themeDefault && typeof payload.themeDefault === 'object' && !Array.isArray(payload.themeDefault)) {
    bridgeStore.setCachesString('themeDefault', JSON.stringify(payload.themeDefault), 0);
  }
  if (typeof payload.themeName === 'string' && payload.themeName) {
    bridgeStore.setCachesString('themeName', payload.themeName, 0);
  }
  const theme = resolveTheme(themeSnapshot());
  StatusBar.setStyle(theme.themeName === 'dark' ? 'light' : 'dark');
  return SystemUI.setBackgroundColorAsync(theme.backgroundColor);
}
