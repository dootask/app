import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { useBridgeRuntime } from '../bridge/hooks';
import { useAppTheme } from '../bridge/messages/theme';
import { ToastHost } from '../bridge/modules/eeui/ToastHost';
import MeetingOverlay from '../features/meeting/MeetingOverlay';
import { useDeviceOrientation } from '../native';

export default function RootLayout() {
  useBridgeRuntime();
  useDeviceOrientation();
  const { themeName, backgroundColor } = useAppTheme();

  return (
    <KeyboardProvider>
      <StatusBar style={themeName === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor },
        }}
      />
      <ToastHost />
      <MeetingOverlay />
    </KeyboardProvider>
  );
}
