import { Platform, ToastAndroid } from 'react-native';

export type ToastGravity = 'top' | 'center' | 'bottom';

export interface ToastRequest {
  message: string;
  gravity?: ToastGravity;
  duration?: number;
}

type Listener = (req: ToastRequest) => void;
const listeners = new Set<Listener>();

export function subscribeToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function showToast(req: ToastRequest): void {
  if (!req.message) return;
  if (Platform.OS === 'android') {
    ToastAndroid.show(req.message, ToastAndroid.SHORT);
    return;
  }
  listeners.forEach((l) => l(req));
}
