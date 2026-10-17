import { Alert, Keyboard } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { registerModule } from '../../dispatcher';
import { getDeviceInfo, getSafeAreaInsets } from './device';
import { openWeb } from './openWeb';
import { showToast } from './ToastHost';

// 与旧壳的应用级 idleTimerDisabled 对应，避免影响 Expo 开发工具的常亮锁。
const KEEP_AWAKE_TAG = 'dootask.eeui';

registerModule('eeui', {
  alert(page, options: unknown, callbackRef: unknown) {
    const data = options && typeof options === 'object' ? options as Record<string, unknown> : { title: options };
    Alert.alert(
      String(data.title ?? ''),
      String(data.message ?? ''),
      [{ text: String(data.button ?? '确定'), onPress: () => page.callback(callbackRef, null) }],
      {
        cancelable: data.cancelable == null ? true : !!data.cancelable,
        // 旧壳取消时不触发确认回调，但桥内的函数仍需释放。
        onDismiss: () => page.release(callbackRef),
      },
    );
  },

  toast(_page, options: unknown) {
    showToast(options);
  },

  openWeb(_page, url: unknown) {
    return openWeb(url);
  },

  keepScreenOn() {
    return activateKeepAwakeAsync(KEEP_AWAKE_TAG);
  },

  keepScreenOff() {
    return deactivateKeepAwake(KEEP_AWAKE_TAG);
  },

  keyboardHide(page) {
    page.inject('(function(){var el=document.activeElement;if(el&&typeof el.blur==="function")el.blur();})();true;');
    Keyboard.dismiss();
  },

  copyText(_page, text: unknown) {
    return Clipboard.setStringAsync(String(text ?? ''));
  },

  checkUpdate() {
    // 一期保留接口，更新由应用商店处理。
  },

  shakeToEditOn() {
    // 一期保留接口，暂不改变系统的摇动撤销设置。
  },

  shakeToEditOff() {
    // 一期保留接口，暂不改变系统的摇动撤销设置。
  },

  getSafeAreaInsets(page, callbackRef: unknown) {
    page.callback(callbackRef, getSafeAreaInsets(page));
  },

  getDeviceInfo(page, callbackRef: unknown) {
    page.callback(callbackRef, getDeviceInfo());
  },
});
