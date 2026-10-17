import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useBridgeRuntime } from '../bridge/hooks';
import { useAppTheme } from '../bridge/messages/theme';
import { ToastHost } from '../bridge/modules/eeui/ToastHost';

export default function RootLayout() {
  useBridgeRuntime();
  const { themeName, backgroundColor } = useAppTheme();

  return (
    <>
      <StatusBar style={themeName === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor },
        }}
      />
      <ToastHost />
    </>
  );
}
