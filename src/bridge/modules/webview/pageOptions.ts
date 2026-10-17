import { useSyncExternalStore } from 'react';

import { bridgeStore } from '../../store';

const LABEL_KEYS = ['languageWebBack', 'languageWebForward', 'languageWebBrowser', 'languageWebRefresh', 'updateDefaultTitle'] as const;
const LABEL_DEFAULTS = ['后退', '前进', '浏览器打开', '刷新', ''] as const;

const subscribe = (listener: () => void) => bridgeStore.subscribe((patch) => {
  if (patch.caches && LABEL_KEYS.some((key) => key in patch.caches!)) listener();
});
const getLabels = () => JSON.stringify(LABEL_KEYS.map((key, index) => bridgeStore.getCachesString(key, LABEL_DEFAULTS[index])));

export function useWebPageLabels() {
  return JSON.parse(useSyncExternalStore(subscribe, getLabels, getLabels)) as [string, string, string, string, string];
}

export function isPageTitle(title: string) {
  return !!title && !['HitoseaTask', 'DooTask', 'about:blank', 'App'].includes(title);
}

export function canOpenInBrowser(url: string) {
  return !!url && !/^(?:https?:\/\/)?localhost(?::\d+)?(?:[/?#]|$)/i.test(url.trim());
}
