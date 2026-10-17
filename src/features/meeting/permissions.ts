import { Camera } from 'expo-camera';
import { Alert, Linking, PermissionsAndroid, Platform } from 'react-native';

import type { MeetingStrings } from './strings';

export class MeetingPermissionDenied extends Error {}

export async function requireMeetingPermission(kind: 'audio' | 'video') {
  let permission = kind === 'audio' ? await Camera.getMicrophonePermissionsAsync() : await Camera.getCameraPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = kind === 'audio' ? await Camera.requestMicrophonePermissionsAsync() : await Camera.requestCameraPermissionsAsync();
  }
  if (!permission.granted) throw new MeetingPermissionDenied(kind);
}

export async function requestBluetoothPermission() {
  if (Platform.OS === 'android' && Number(Platform.Version) >= 31) {
    // 耳机权限被拒绝时，仍允许通过扬声器/听筒参会。
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT).catch(() => {});
  }
}

export function showMeetingPermissionAlert(strings: MeetingStrings) {
  Alert.alert(strings.permissionTitle, strings.permissionMessage, [
    { text: strings.cancel, style: 'cancel' },
    { text: strings.settings, onPress: () => { void Linking.openSettings().catch(() => {}); } },
  ]);
}
