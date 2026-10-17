import { Dimensions, PixelRatio, Platform } from 'react-native';
import * as Device from 'expo-device';
import { initialWindowMetrics, type EdgeInsets } from 'react-native-safe-area-context';

import type { PageHandle } from '../../pages';

export const SAFE_AREA_KEY = 'eeui.safeAreaInsets';

export function getSafeAreaInsets(page: PageHandle) {
  const insets = page.state.get(SAFE_AREA_KEY) as EdgeInsets | undefined;
  const safeArea = insets ?? initialWindowMetrics?.insets;
  const screen = Dimensions.get('screen');
  // 旧 DeviceUtil 返回 UIKit point；Android DisplayMetrics 返回物理像素。
  const scale = Platform.OS === 'android' ? PixelRatio.get() : 1;
  const convert = (value: number) => Platform.OS === 'android' ? Math.round(value * scale) : value;
  return {
    status: 'success',
    top: convert(safeArea?.top ?? 0),
    bottom: convert(safeArea?.bottom ?? 0),
    width: convert(screen.width),
    height: convert(screen.height),
  };
}

export function getDeviceInfo() {
  const ios = Platform.OS === 'ios';
  const systemVersion = Device.osVersion ?? String(Platform.Version);
  const model = ios
    ? Device.modelId?.startsWith('iPod') ? 'iPod touch' : Platform.OS === 'ios' && Platform.isPad ? 'iPad' : 'iPhone'
    : Device.modelName ?? '';
  return {
    status: 'success',
    manufacturer: ios ? 'Apple' : Device.manufacturer ?? '',
    brand: ios ? 'Apple' : Device.brand ?? '',
    model,
    modelName: Device.modelName ?? model,
    // 旧 Android 始终为空；旧 iOS 16+ 也刻意不返回设备名。
    deviceName: ios && parseInt(systemVersion, 10) < 16 ? Device.deviceName ?? '' : '',
    systemName: ios ? Device.osName ?? 'iOS' : 'Android',
    systemVersion,
  };
}
