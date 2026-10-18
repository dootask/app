import { Alert, Keyboard, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { getLegacyStoreModule } from '../../../../modules/legacy-store';
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
    // 旧 Android 只 hideSoftInput、不移除焦点（弹框取消后光标/选区原样保留）；
    // RN 的 Keyboard.dismiss 只作用于 RN TextInput，对 WebView 内输入框无效，故走原生收起
    if (Platform.OS === 'android') return getLegacyStoreModule().hideSoftInput();
    // 旧 iOS endEditing 会让输入框失焦
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
    if (Platform.OS === 'ios') return getLegacyStoreModule().setShakeToEditEnabled(true);
  },

  shakeToEditOff() {
    if (Platform.OS === 'ios') return getLegacyStoreModule().setShakeToEditEnabled(false);
  },

  getSafeAreaInsets(page, callbackRef: unknown) {
    page.callback(callbackRef, getSafeAreaInsets(page));
  },

  getDeviceInfo(page, callbackRef: unknown) {
    page.callback(callbackRef, getDeviceInfo());
  },
});
