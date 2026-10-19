import { Linking, Vibration } from 'react-native';

import { registerMessage } from '../dispatcher';
import { bridgeStore } from '../store';
import { openWeb } from '../modules/eeui/openWeb';
import { createTarget, getPageWebViewState, patchWebView } from '../modules/webview/state';
import { updateTheme } from './theme';

registerMessage('initApp', (_page, payload) => {
  // 沿用旧 index.vue 的 appMessage 名称，供后续推送、会议读取。
  bridgeStore.setVariate('appMessage', { ...payload });
});

registerMessage('windowSize', (_page, payload) => {
  bridgeStore.setVariate('windowWidth', parseInt(String(payload.width), 10) || 0);
  bridgeStore.setVariate('windowHeight', parseInt(String(payload.height), 10) || 0);
});

registerMessage('updateTheme', (_page, payload) => updateTheme(payload));

registerMessage('callTel', (_page, payload) => {
  if (typeof payload.tel !== 'string' && typeof payload.tel !== 'number') return;
  const tel = String(payload.tel);
  return tel ? Linking.openURL(/^tel:/i.test(tel) ? tel : `tel:${tel}`) : undefined;
});

registerMessage('setVibrate', (_page, payload) => {
  const time = parseInt(String(payload.time), 10) || 0;
  Vibration.cancel();
  Vibration.vibrate(time > 0 ? time : 500);
});

registerMessage('gotoSetting', () => Linking.openSettings());

registerMessage('setPageData', (page, payload) => {
  if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) return;
  const { pageData } = getPageWebViewState(page).values;
  // 与旧 web.vue 一样合并页面数据，数据放在独立字段中，不会覆写桥的控制器和句柄。
  patchWebView(page, { pageData: { ...pageData, ...payload.data } });
});

registerMessage('createTarget', (page, payload) => createTarget(page, payload.url));
registerMessage('openUrl', (_page, payload) => openWeb(payload.url));
