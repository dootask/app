import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RefObject } from 'react';
import type WebView from 'react-native-webview';
import type { RootStackParamList } from '../../navigation/types';
import { getLocalServerUrl } from '../../services/localServer';

interface OpenPageParams {
  url?: string;
  pageType?: string;
  pageTitle?: string;
  params?: {
    url?: string;
    titleFixed?: boolean;
    hiddenDone?: boolean;
    allowAccess?: boolean;
    showProgress?: boolean;
  };
  softInputMode?: string;
}

interface HandleOpenPageOptions {
  args: unknown[];
  navigation: NativeStackNavigationProp<RootStackParamList>;
  parentWebViewRef: RefObject<WebView | null>;
  // `requestId` is the multi-callback id the Proxy registered in
  // `window.__bridgeCallbacks__[id]`; set when the Vue page passed a callback.
  requestId: string;
}

export function handleOpenPage({
  args,
  navigation,
  parentWebViewRef,
  requestId,
}: HandleOpenPageOptions): { status: string; childPageId: string } {
  const params = ((args[0] as OpenPageParams) ?? {}) as OpenPageParams;
  const serverUrl = getLocalServerUrl();
  let targetUrl = params.params?.url || params.url || '';

  if (targetUrl.startsWith('#')) {
    targetUrl = `${serverUrl ?? ''}/index.html${targetUrl}`;
  } else if (targetUrl.startsWith('/')) {
    targetUrl = `${serverUrl ?? ''}/index.html#${targetUrl}`;
  } else if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = `${serverUrl ?? ''}/${targetUrl}`;
  }

  const childPageId = `child_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Always register — if the Vue caller did not pass a callback, the injected-JS side's
  // `__bridgeCallbacks__[requestId]` will simply be undefined and `onChildPageClosed` is a no-op.
  registerPageCallback(childPageId, { parentWebViewRef, callbackId: requestId });

  navigation.navigate('ChildWebView', {
    url: targetUrl,
    title: params.pageTitle || '',
    titleFixed: params.params?.titleFixed ?? false,
    pageId: childPageId,
  });

  // Returned payload only surfaces on the regular (no-callback) Proxy path; the multi-callback
  // path discards the bridge_response, so it's safe to always return a value.
  return { status: 'success', childPageId };
}

interface OpenPageCallback {
  parentWebViewRef: RefObject<WebView | null>;
  callbackId: string;
}

const pageCallbacks = new Map<string, OpenPageCallback>();

function registerPageCallback(childPageId: string, callback: OpenPageCallback): void {
  pageCallbacks.set(childPageId, callback);
}

export function onChildPageClosed(childPageId: string): void {
  const entry = pageCallbacks.get(childPageId);
  if (!entry) return;
  pageCallbacks.delete(childPageId);
  const { parentWebViewRef, callbackId } = entry;
  if (!callbackId) return;
  const idJson = JSON.stringify(callbackId);
  parentWebViewRef.current?.injectJavaScript(`
    (function() {
      var cb = window.__bridgeCallbacks__ && window.__bridgeCallbacks__[${idJson}];
      if (typeof cb === 'function') {
        try { cb({ status: 'pause' }); } catch (e) {}
        delete window.__bridgeCallbacks__[${idJson}];
      }
    })();
    true;
  `);
}
