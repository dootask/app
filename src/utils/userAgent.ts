import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

export function buildUserAgent(): string {
  const version = Constants.expoConfig?.version ?? '0.0.0';
  const platform = Platform.OS;
  const brand = Device.brand ?? 'Unknown';
  const model = Device.modelName ?? 'Unknown';
  const osVersion = Device.osVersion ?? '';

  return `Mozilla/5.0 (${brand} ${model}; ${platform} ${osVersion}) ${platform}_dootask_expo/${version}`;
}
