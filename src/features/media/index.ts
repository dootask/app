import { Camera } from 'expo-camera';
import { router } from 'expo-router';
import { Alert, Linking, Platform } from 'react-native';

import { registerMessage, registerModule } from '../../bridge/dispatcher';
import { getPage, type PageHandle } from '../../bridge/pages';
import { getLatestPhoto } from './latestPhoto';
import { fileUri, parsePictures, parseScannerOptions } from './params';
import { addRequest, createScanner, findRequest, removeRequest, type MediaRequest, type ScannerRequest } from './requests';
import { cancelUploadPhoto, uploadPhoto } from './upload';

function pushRequest(page: PageHandle, request: MediaRequest, id = addRequest(page, request)) {
  try {
    router.push({
      pathname: request.kind === 'scanner' ? '/scanner' : '/media-preview',
      params: { mediaPage: page.pageName, mediaRequest: id },
    });
  } catch (error) {
    const handle = findRequest(page.pageName, id);
    if (handle) removeRequest(handle);
    throw error;
  }
}

async function openScaner(page: PageHandle, options: unknown, callbackRef: unknown) {
  const request: ScannerRequest = {
    kind: 'scanner', options: parseScannerOptions(options), callbackRef,
    users: 0, created: false, finished: false, scanned: false, lastResultAt: -Infinity,
  };
  const handle = { page, request, id: addRequest(page, request) };
  // iOS 的桥在推入扫描控制器之前发送 create；Android 在授权后的 Activity 创建时发送。
  if (Platform.OS === 'ios') createScanner(page, request);
  try {
    let permission = await Camera.getCameraPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) permission = await Camera.requestCameraPermissionsAsync();
    if (!permission.granted) {
      removeRequest(handle);
      Alert.alert('无法使用相机', '请在系统设置中允许 DooTask 使用相机，以便扫描二维码或条码。', [
        { text: '取消', style: 'cancel' },
        { text: '前往设置', onPress: () => { void Linking.openSettings().catch((error) => console.warn('[media] 无法打开设置', error)); } },
      ]);
      return;
    }
    if (getPage(page.pageName) !== page) { removeRequest(handle); return; }
    pushRequest(page, request, handle.id);
  } catch (error) {
    removeRequest(handle);
    console.warn('[media] 打开扫码页失败', error);
  }
}

registerModule('eeui', { openScaner, getLatestPhoto, uploadPhoto, cancelUploadPhoto });

registerMessage('picturePreview', (page, payload) => {
  const parsed = parsePictures(payload, Platform.OS);
  if (parsed.paths.length) pushRequest(page, { kind: 'pictures', ...parsed, users: 0 });
});

registerMessage('videoPreview', (page, payload) => {
  if (typeof payload.path !== 'string' || !payload.path) return;
  pushRequest(page, { kind: 'video', path: fileUri(payload.path), language: String(payload.language ?? ''), users: 0 });
});
