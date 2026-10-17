import { Platform } from 'react-native';

import { registerModule } from '../../dispatcher';
import { createSnapshot, getPageWebViewState, hideSnapshot, patchWebView, setPageUrl } from './state';

registerModule('webview', {
  setUrl(page, url: unknown) {
    return setPageUrl(page, url);
  },

  createSnapshot,

  showSnapshot(page) {
    if (getPageWebViewState(page).values.snapshotUri) patchWebView(page, { snapshotVisible: true });
  },

  hideSnapshot,

  setHapticBackEnabled(page, enabled: unknown) {
    if (Platform.OS !== 'android') return;
    patchWebView(page, { hapticBackEnabled: !!enabled });
  },

  setDisabledUserLongClickSelect(page, disabled: unknown) {
    if (Platform.OS === 'android') patchWebView(page, { disabledUserLongClickSelect: !!disabled });
  },

  setScrollEnabled(page, enabled: unknown) {
    patchWebView(page, { scrollEnabled: !!enabled });
  },
});
