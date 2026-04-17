import type { RefObject } from 'react';
import type WebView from 'react-native-webview';
import type { EdgeInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';

export interface BridgeRequest {
  type: 'bridge_request';
  id: string;
  module: string;
  method: string;
  args: unknown[];
}

export interface BridgeResponse {
  type: 'bridge_response';
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface AppState {
  apiUrl: string;
  userId: string;
  userToken: string;
  language: string;
}

export const defaultAppState = (): AppState => ({
  apiUrl: '',
  userId: '',
  userToken: '',
  language: '',
});

export interface BridgeContext {
  webViewRef: RefObject<WebView | null>;
  navigation: NativeStackNavigationProp<RootStackParamList>;
  insets: EdgeInsets;
  isFirstPage: boolean;
  pageId: string;
  appState: AppState;
  onRequestScan?: (callback: (result: string) => void) => void;
  onSetScrollEnabled?: (enabled: boolean) => void;
}
