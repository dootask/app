import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, scanFromURLAsync, type BarcodeScanningResult } from 'expo-camera';
import { File, Paths } from 'expo-file-system';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createScanner, scannerLight, scannerResult } from './requests';
import { closeMediaRoute, useMediaActive, useMediaRoute } from './useMediaRoute';

export default function ScannerScreen() {
  const handle = useMediaRoute();
  const active = useMediaActive();
  const [torch, setTorch] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [picking, setPicking] = useState(false);
  const pickingRef = useRef(false);
  const request = handle?.request.kind === 'scanner' ? handle.request : null;

  useEffect(() => {
    if (handle && request) createScanner(handle.page, request);
  }, [handle, request]);

  function scanned(result: BarcodeScanningResult, source: 'camera' | 'photo') {
    if (!handle || !request || (pickingRef.current && source === 'camera')) return;
    if (scannerResult(handle.page, request, Platform.OS, result.data, result.type, source)) closeMediaRoute();
  }

  async function pickPicture() {
    if (!request || pickingRef.current) return;
    pickingRef.current = true;
    setPicking(true);
    let temporary: File | undefined;
    try {
      const chosen = await File.pickFileAsync({ mimeTypes: 'image/*' });
      if (chosen.canceled || request.finished) return;
      temporary = new File(Paths.cache, `eeui-scan-${Date.now()}-${Math.random().toString(36).slice(2)}${chosen.result.extension}`);
      await chosen.result.copy(temporary);
      const results = await scanFromURLAsync(temporary.uri);
      if (request.finished) return;
      if (results[0]) scanned(results[0], 'photo');
      else Alert.alert('未识别到二维码或条码', '请尝试选择更清晰的图片。', [{ text: '确定' }]);
    } catch (error) {
      if (!request.finished) Alert.alert('无法识别图片', error instanceof Error ? error.message : '请稍后重试。', [{ text: '确定' }]);
    } finally {
      try { if (temporary?.exists) temporary.delete(); } catch { /* 临时文件交给系统缓存清理。 */ }
      pickingRef.current = false;
      setPicking(false);
    }
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: true }} />
      <StatusBar style="light" />
      {request && active && !picking && !cameraError && (
        <CameraView
          style={StyleSheet.absoluteFill} facing="back" enableTorch={torch}
          onBarcodeScanned={(result) => scanned(result, 'camera')}
          onMountError={() => setCameraError(true)}
        />
      )}
      <SafeAreaView style={styles.overlay}>
        <View style={styles.toolbar}>
          <Pressable accessibilityRole="button" accessibilityLabel="返回" style={styles.topButton} hitSlop={12} onPress={closeMediaRoute}>
            <View style={styles.backIcon} />
            <Text style={styles.button}>返回</Text>
          </Pressable>
          {request && <Pressable accessibilityRole="button" style={styles.topButton} onPress={() => { void pickPicture(); }} disabled={picking}>
            <Text style={styles.button}>相册</Text>
          </Pressable>}
        </View>
        <View pointerEvents="none" style={styles.center}>
          {request && !cameraError ? (
            <>
              <View style={styles.frame} />
              <Text style={styles.description}>{request.options.desc || '将二维码或条码放入框内'}</Text>
              {picking && <ActivityIndicator color="#fff" />}
            </>
          ) : <Text style={styles.description}>{cameraError ? '无法启动相机，请关闭后重试' : '扫码页面已失效，请重新打开'}</Text>}
        </View>
        {request && <View style={styles.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel={torch ? '关闭手电筒' : '打开手电筒'}
            accessibilityState={{ selected: torch, disabled: picking || cameraError }} style={styles.torchButton} onPress={() => {
            const enabled = !torch;
            setTorch(enabled);
            if (handle) scannerLight(handle.page, request, enabled);
          }} disabled={picking || cameraError}>
            <Image source={torch ? require('../../../assets/scanner/torch-on.png') : require('../../../assets/scanner/torch-off.png')}
              style={styles.torchIcon} resizeMode="contain" />
          </Pressable>
        </View>}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, justifyContent: 'space-between' },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 },
  topButton: { minWidth: 44, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  // 细尖角返回图标（iOS 导航栏风格），用边框画出避免位图缩放发虚
  backIcon: { width: 11, height: 11, marginLeft: 4, borderLeftWidth: 2, borderBottomWidth: 2, borderColor: '#fff', transform: [{ rotate: '45deg' }] },
  button: { color: '#fff', fontSize: 16, textShadowColor: '#0009', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  frame: { width: '80%', maxWidth: 320, aspectRatio: 1, borderWidth: 2, borderColor: '#fff9', borderRadius: 16 },
  description: { color: '#fff', textAlign: 'center', fontSize: 16, marginVertical: 24 },
  actions: { alignItems: 'center', padding: 20 },
  torchButton: { width: 64, height: 64, borderRadius: 32, overflow: 'hidden' },
  torchIcon: { width: 64, height: 64 },
});
