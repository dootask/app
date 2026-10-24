import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { useBridgeRuntime } from '../bridge/hooks';
import { useAppTheme } from '../bridge/messages/theme';
import { ToastHost } from '../bridge/modules/eeui/ToastHost';
import MeetingOverlay from '../features/meeting/MeetingOverlay';
import { useDeviceOrientation, useWindowState } from '../native';

export default function RootLayout() {
  useBridgeRuntime();
  useDeviceOrientation();
  useWindowState();
  const { themeName, backgroundColor } = useAppTheme();

  return (
    <KeyboardProvider>
      <StatusBar style={themeName === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor },
        }}
      >
        {/* Android 原生栈会把被完全覆盖的页面从窗口卸下，下层 WebView 的 postMessage 要等重新挂载才派发，
            发起会议的页面回传的参会人名字/头像因此丢失；透明模态让下层页面保持挂载（会议页背景不透明，外观不变）。
            presentation 须在此静态声明：页面内 setOptions 晚于入栈，不影响下层是否卸下 */}
        <Stack.Screen
          name="meeting"
          options={{ presentation: Platform.OS === 'android' ? 'transparentModal' : 'fullScreenModal' }}
        />
        {/* 图片/视频预览下拉关闭时背景渐变透明，需露出下层页面；手势由页面自行处理，关闭系统返回手势避免冲突 */}
        <Stack.Screen
          name="media-preview"
          options={{ presentation: 'transparentModal', animation: 'fade', gestureEnabled: false, contentStyle: { backgroundColor: 'transparent' } }}
        />
      </Stack>
      <ToastHost />
      <MeetingOverlay />
    </KeyboardProvider>
  );
}
