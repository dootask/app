import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { subscribeToast, type ToastRequest } from '../services/toastBus';

interface ActiveToast extends Required<ToastRequest> {
  id: number;
}

const DEFAULT_DURATION = 2000;

export function ToastHost() {
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (Platform.OS === 'android') return;
    let nextId = 1;
    const unsub = subscribeToast((req) => {
      const active: ActiveToast = {
        id: nextId++,
        message: req.message,
        gravity: req.gravity ?? 'bottom',
        duration: req.duration ?? DEFAULT_DURATION,
      };
      setToast(active);
    });
    return () => {
      unsub();
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);

    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      hideTimerRef.current = setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }).start(() => setToast(null));
      }, toast.duration);
    });
  }, [toast, opacity]);

  if (Platform.OS === 'android' || !toast) return null;

  return (
    <View pointerEvents="none" style={[styles.root, positionStyle(toast.gravity)]}>
      <Animated.View style={[styles.bubble, { opacity }]}>
        <Text style={styles.text}>{toast.message}</Text>
      </Animated.View>
    </View>
  );
}

function positionStyle(gravity: 'top' | 'center' | 'bottom') {
  if (gravity === 'top') return styles.top;
  if (gravity === 'center') return styles.center;
  return styles.bottom;
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'flex-end',
    zIndex: 9999,
  },
  top: { justifyContent: 'flex-start', paddingTop: 80 },
  center: { justifyContent: 'center' },
  bottom: { justifyContent: 'flex-end', paddingBottom: 80 },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
  },
  text: { color: '#fff', fontSize: 14, textAlign: 'center' },
});
