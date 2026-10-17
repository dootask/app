import { Linking } from 'react-native';

/** 与旧 openWeb 的 ACTION_VIEW / UIApplication.openURL 一致，交给系统打开。 */
export function openWeb(url: unknown) {
  if (typeof url !== 'string' || !url) return;
  return Linking.openURL(url);
}
