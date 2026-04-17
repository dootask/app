import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { MainScreen } from './screens/MainScreen';
import { ChildWebViewScreen } from './screens/ChildWebViewScreen';
import { ScannerScreen } from './screens/ScannerScreen';
import { ToastHost } from './components/ToastHost';
import { installNotificationTapListener } from './services/notificationTap';
import type { RootStackParamList } from './navigation/types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  useEffect(() => {
    const dispose = installNotificationTapListener();
    return () => dispose();
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Main" component={MainScreen} />
          <Stack.Screen
            name="ChildWebView"
            component={ChildWebViewScreen}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="Scanner"
            component={ScannerScreen}
            options={{ presentation: 'fullScreenModal', animation: 'fade_from_bottom' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
      <ToastHost />
    </SafeAreaProvider>
  );
}
