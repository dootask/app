import type { RefObject } from 'react';
import type WebView from 'react-native-webview';

// Phase 3 will implement these handlers (expo-image-picker + expo-media-library + expo-file-system).
// For Phase 1 we stub them so the bridge router compiles and returns a safe "not implemented" error.

export async function getLatestPhoto(): Promise<unknown> {
  return {
    status: 'error',
    error: 'getLatestPhoto not implemented (Phase 3)',
  };
}

export async function uploadPhoto(
  _params: unknown,
  requestId: string,
  webViewRef: RefObject<WebView | null>,
): Promise<undefined> {
  webViewRef.current?.injectJavaScript(`
    var cb = window.__bridgeCallbacks__ && window.__bridgeCallbacks__[${JSON.stringify(requestId)}];
    if (cb) {
      cb({ status: 'error', error: 'uploadPhoto not implemented (Phase 3)' });
      delete window.__bridgeCallbacks__[${JSON.stringify(requestId)}];
    }
    true;
  `);
  return undefined;
}
