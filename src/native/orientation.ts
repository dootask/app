import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as Device from 'expo-device';
import * as ScreenOrientation from 'expo-screen-orientation';

/** 在根布局调用一次；iOS 的设备差异由 Info.plist 控制，保留 iPad 分屏。 */
export function useDeviceOrientation(): void {
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    // SDK 58 优先按最小宽度 >= 600dp 分类；使用设备常量，避免按旋转后的窗口尺寸判断。
    const isTablet = Device.deviceType === Device.DeviceType.TABLET;
    const applyOrientation = () => {
      // unlockAsync 对应旧平板的 SCREEN_ORIENTATION_UNSPECIFIED，仍遵循系统旋转设置。
      const request = isTablet
        ? ScreenOrientation.unlockAsync()
        : ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      void request.catch((error) => {
        console.warn('[native/orientation] 设置屏幕方向失败', error);
      });
    };

    applyOrientation();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') applyOrientation();
    });
    // 卸载时只移除监听，方向策略应持续到应用退出。
    return () => subscription.remove();
  }, []);
}
