import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { WebViewHost } from './WebViewHost';
import type { RootStackParamList } from '../navigation/types';
import { useLocalServerUrl } from '../hooks/useLocalServerUrl';

export function MainScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { url, error } = useLocalServerUrl();

  if (!url) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="small" />
      </View>
    );
  }

  return (
    <WebViewHost
      // 用根路径（/）而不是 /index.html，让 Vue SPA 自己判断重定向逻辑
      url={`${url}/`}
      isFirstPage
      pageId="firstPage"
      navigation={navigation}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
});
