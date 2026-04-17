import React, { useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
  type Code,
} from 'react-native-vision-camera';

import { emitScanResult } from '../services/scannerBus';
import type { RootStackParamList } from '../navigation/types';

type ScannerRoute = RouteProp<RootStackParamList, 'Scanner'>;

export function ScannerScreen() {
  const route = useRoute<ScannerRoute>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { scanId } = route.params;
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const scannedRef = useRef(false);
  const resolvedRef = useRef(false);

  useEffect(() => {
    if (!hasPermission) void requestPermission();
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    return () => {
      if (!resolvedRef.current) {
        emitScanResult(scanId, null);
        resolvedRef.current = true;
      }
    };
  }, [scanId]);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr', 'ean-13', 'code-128'],
    onCodeScanned: (codes: Code[]) => {
      const value = codes[0]?.value;
      if (!value || scannedRef.current) return;
      scannedRef.current = true;
      resolvedRef.current = true;
      emitScanResult(scanId, value);
      navigation.goBack();
    },
  });

  if (!hasPermission) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>需要相机权限才能扫码</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>授权</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>未检测到摄像头</Text>
      </View>
    );
  }

  return (
    <View style={styles.cameraContainer}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        codeScanner={codeScanner}
      />
      <TouchableOpacity style={styles.close} onPress={() => navigation.goBack()}>
        <Text style={styles.closeText}>✕</Text>
      </TouchableOpacity>
      <View style={styles.overlay}>
        <View style={styles.frame} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  message: { color: '#fff', fontSize: 16, marginBottom: 16 },
  button: {
    backgroundColor: '#1677ff',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 6,
  },
  buttonText: { color: '#fff', fontSize: 16 },
  close: {
    position: 'absolute',
    top: 48,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: '#fff', fontSize: 22 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    width: 240,
    height: 240,
    borderColor: '#ffffff',
    borderWidth: 2,
    borderRadius: 8,
  },
});
