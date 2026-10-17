import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { findRequest, retainRequest } from './requests';

export function useMediaRoute() {
  const { mediaPage, mediaRequest } = useLocalSearchParams();
  const [handle] = useState(() => findRequest(mediaPage, mediaRequest));
  useEffect(() => handle ? retainRequest(handle) : undefined, [handle]);
  return handle;
}

/** 页面失焦和应用退到后台时卸载相机、暂停视频。 */
export function useMediaActive() {
  const [focused, setFocused] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useFocusEffect(useCallback(() => {
    setFocused(true);
    setForeground(AppState.currentState === 'active');
    return () => setFocused(false);
  }, []));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);
  return focused && foreground;
}

export function closeMediaRoute() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
