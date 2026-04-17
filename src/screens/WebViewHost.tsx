import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  type AppStateStatus,
  BackHandler,
  Image,
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
import { captureRef, releaseCapture } from 'react-native-view-shot';

import { buildInjectedJS } from '../bridge/injectedJS';
import { createBridgeHandler, disposeBridgeContext } from '../bridge';
import { defaultAppState, type BridgeRequest, type BridgeResponse } from '../bridge/types';
import { buildUserAgent } from '../utils/userAgent';
import { registerScanCallback } from '../services/scannerBus';
import { getAllCaches, getAllVariates } from '../bridge/handlers/storage';
import { getCurrentTheme, subscribeTheme } from '../services/themeBus';
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
  const captureContainerRef = useRef<View>(null);
  const insets = useSafeAreaInsets();
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [currentUrl, setCurrentUrl] = useState(url);
  useEffect(() => setCurrentUrl(url), [url]);

  // Snapshot: capture the WebView contents, then (optionally) overlay the image while the
  // WebView is paused (e.g. on AppState background, to avoid task-switcher leaks).
  const [snapshotUri, setSnapshotUri] = useState<string | null>(null);
  const [snapshotVisible, setSnapshotVisible] = useState(false);
  const lastSnapshotRef = useRef<string | null>(null);

  // Tracks the id of the `__bridgeCallbacks__` entry the Vue page registered via
  // `setPageBackPressed(true, cb)`; null when native should use default behaviour.
  const backInterceptIdRef = useRef<string | null>(null);

  const initData = useMemo(
    () => ({
      version: Constants.expoConfig?.version ?? '0.0.0',
      themeName: getCurrentTheme(),
      pageInfo: { pageName: isFirstPage ? 'firstPage' : pageId },
      isFirstPage,
      keyboardVisible: false,
      variates: getAllVariates(),
      caches: getAllCaches(),
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
      onSetUrl: (next) => setCurrentUrl(next),
      onSetBackIntercept: (callbackId) => {
        backInterceptIdRef.current = callbackId;
      },
      onCreateSnapshot: async () => {
        if (!captureContainerRef.current) return null;
        try {
          if (lastSnapshotRef.current) releaseCapture(lastSnapshotRef.current);
          const uri = await captureRef(captureContainerRef, {
            format: 'jpg',
            quality: 0.8,
            result: 'tmpfile',
          });
          lastSnapshotRef.current = uri;
          setSnapshotUri(uri);
          return uri;
        } catch (e) {
          console.warn('[createSnapshot] failed:', e);
          return null;
        }
      },
      onShowSnapshot: () => setSnapshotVisible(true),
      onHideSnapshot: () => setSnapshotVisible(false),
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
      const cbId = backInterceptIdRef.current;
      if (cbId) {
        const idJson = JSON.stringify(cbId);
        webViewRef.current?.injectJavaScript(`
          (function() {
            var cb = window.__bridgeCallbacks__ && window.__bridgeCallbacks__[${idJson}];
            if (typeof cb === 'function') { try { cb(); } catch (e) {} }
          })();
          true;
        `);
        return true;
      }
      if (!isFirstPage) {
        navigation.goBack();
        return true;
      }
      return false;
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
        window.__EXPO_INIT_DATA__ = window.__EXPO_INIT_DATA__ || {};
        window.__EXPO_INIT_DATA__.keyboardVisible = true;
        typeof window.__onKeyboardStatus === 'function'
          && window.__onKeyboardStatus({ keyboardType: 'show', keyboardHeight: ${height} });
        true;
      `);
    });
    const kbHide = Keyboard.addListener('keyboardDidHide', () => {
      webViewRef.current?.injectJavaScript(`
        window.__EXPO_INIT_DATA__ = window.__EXPO_INIT_DATA__ || {};
        window.__EXPO_INIT_DATA__.keyboardVisible = false;
        typeof window.__onKeyboardStatus === 'function'
          && window.__onKeyboardStatus({ keyboardType: 'hide', keyboardHeight: 0 });
        true;
      `);
    });

    const themeUnsub = subscribeTheme((mode) => {
      webViewRef.current?.injectJavaScript(`
        window.__EXPO_INIT_DATA__ = window.__EXPO_INIT_DATA__ || {};
        window.__EXPO_INIT_DATA__.themeName = ${JSON.stringify(mode)};
        window.dispatchEvent(new CustomEvent('bridge_event', {
          detail: { type: 'bridge_event', event: 'themeChanged', data: { theme: ${JSON.stringify(mode)} } }
        }));
        typeof window.__onThemeChanged === 'function' && window.__onThemeChanged(${JSON.stringify(mode)});
        true;
      `);
    });

    return () => {
      appSub.remove();
      kbShow.remove();
      kbHide.remove();
      themeUnsub();
      if (lastSnapshotRef.current) {
        releaseCapture(lastSnapshotRef.current);
        lastSnapshotRef.current = null;
      }
    };
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={showHeader ? ['top'] : []}>
      <StatusBar style="auto" />
      {showHeader ? (
        <HeaderBar title={headerTitle} onBack={onBack ?? (() => navigation.goBack())} />
      ) : null}
      <View ref={captureContainerRef} collapsable={false} style={styles.webview}>
        <WebView
          ref={webViewRef}
          source={{ uri: currentUrl }}
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
        {snapshotVisible && snapshotUri ? (
          <Image
            source={{ uri: snapshotUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : null}
      </View>
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
