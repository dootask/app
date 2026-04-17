import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Appearance,
  AppState,
  type AppStateStatus,
  BackHandler,
  Keyboard,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { buildInjectedJS } from '../bridge/injectedJS';
import { createBridgeHandler, disposeBridgeContext } from '../bridge';
import { defaultAppState, type BridgeRequest, type BridgeResponse } from '../bridge/types';
import { buildUserAgent } from '../utils/userAgent';
import { registerScanCallback } from '../services/scannerBus';
import type { RootStackParamList } from '../navigation/types';

interface Props {
  url: string;
  isFirstPage: boolean;
  pageId: string;
  navigation: NativeStackNavigationProp<RootStackParamList>;
  showHeader?: boolean;
  headerTitle?: string;
  onBack?: () => void;
}

export function WebViewHost({
  url,
  isFirstPage,
  pageId,
  navigation,
  showHeader = false,
  headerTitle,
  onBack,
}: Props) {
  const webViewRef = useRef<WebView>(null);
  const insets = useSafeAreaInsets();
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const initData = useMemo(
    () => ({
      version: Constants.expoConfig?.version ?? '0.0.0',
      themeName: Appearance.getColorScheme() ?? 'light',
      pageInfo: { pageName: isFirstPage ? 'firstPage' : pageId },
      isFirstPage,
      keyboardVisible: false,
    }),
    [isFirstPage, pageId],
  );

  const injectedJS = useMemo(() => buildInjectedJS(initData), [initData]);

  const bridgeHandlerRef = useRef<((msg: BridgeRequest) => Promise<BridgeResponse>) | null>(
    null,
  );

  useEffect(() => {
    const handler = createBridgeHandler({
      webViewRef,
      navigation,
      insets,
      isFirstPage,
      pageId,
      appState: defaultAppState(),
      onRequestScan: (callback) => {
        const scanId = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        registerScanCallback(scanId, (result) => {
          if (result) callback(result);
        });
        navigation.navigate('Scanner', { scanId });
      },
      onSetScrollEnabled: (enabled) => setScrollEnabled(enabled),
    });
    bridgeHandlerRef.current = handler;
    return () => {
      bridgeHandlerRef.current = null;
      disposeBridgeContext(pageId);
    };
  }, [insets, isFirstPage, navigation, pageId]);

  const onMessage = useCallback(async (event: WebViewMessageEvent) => {
    let msg: BridgeRequest;
    try {
      msg = JSON.parse(event.nativeEvent.data) as BridgeRequest;
    } catch {
      return;
    }
    if (msg?.type !== 'bridge_request') return;
    const handler = bridgeHandlerRef.current;
    if (!handler) return;
    const response = await handler(msg);
    webViewRef.current?.postMessage(JSON.stringify(response));
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isFirstPage) {
        webViewRef.current?.injectJavaScript(`
          window.dispatchEvent(new CustomEvent('bridge_event', {
            detail: { type: 'bridge_event', event: 'backPressed' }
          }));
          true;
        `);
        return true;
      }
      navigation.goBack();
      return true;
    });
    return () => sub.remove();
  }, [isFirstPage, navigation]);

  useEffect(() => {
    let lastState: AppStateStatus = AppState.currentState;
    const appSub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && lastState !== 'active') {
        webViewRef.current?.injectJavaScript(`
          typeof window.__onAppActive === 'function' && window.__onAppActive();
          typeof window.__onPageResume === 'function' && window.__onPageResume(1);
          true;
        `);
      } else if ((next === 'inactive' || next === 'background') && lastState === 'active') {
        webViewRef.current?.injectJavaScript(`
          typeof window.__onAppDeactive === 'function' && window.__onAppDeactive();
          typeof window.__onPagePause === 'function' && window.__onPagePause();
          true;
        `);
      }
      lastState = next;
    });

    const kbShow = Keyboard.addListener('keyboardDidShow', (e) => {
      const height = e.endCoordinates?.height ?? 0;
      webViewRef.current?.injectJavaScript(`
        typeof window.__onKeyboardStatus === 'function'
          && window.__onKeyboardStatus({ keyboardType: 'show', keyboardHeight: ${height} });
        true;
      `);
    });
    const kbHide = Keyboard.addListener('keyboardDidHide', () => {
      webViewRef.current?.injectJavaScript(`
        typeof window.__onKeyboardStatus === 'function'
          && window.__onKeyboardStatus({ keyboardType: 'hide', keyboardHeight: 0 });
        true;
      `);
    });

    return () => {
      appSub.remove();
      kbShow.remove();
      kbHide.remove();
    };
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={showHeader ? ['top'] : []}>
      <StatusBar style="auto" />
      {showHeader ? (
        <HeaderBar title={headerTitle} onBack={onBack ?? (() => navigation.goBack())} />
      ) : null}
      <WebView
        ref={webViewRef}
        source={{ uri: url }}
        userAgent={buildUserAgent()}
        injectedJavaScriptBeforeContentLoaded={injectedJS}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        mixedContentMode="always"
        originWhitelist={['*']}
        scrollEnabled={scrollEnabled}
        allowsBackForwardNavigationGestures={false}
        keyboardDisplayRequiresUserAction={false}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        style={styles.webview}
      />
    </SafeAreaView>
  );
}

function HeaderBar({ title, onBack }: { title?: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.headerBtn}>
        <Text style={styles.headerBack}>← 返回</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title ?? ''}
      </Text>
      <View style={styles.headerBtn} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  webview: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  headerBtn: { width: 72 },
  headerBack: { fontSize: 15, color: '#1677ff' },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '500',
  },
});
