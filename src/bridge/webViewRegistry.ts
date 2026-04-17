import type { RefObject } from 'react';
import type WebView from 'react-native-webview';
import { syncCacheToWebView, syncVariateToWebView } from './handlers/storage';

const activeWebViews = new Map<string, RefObject<WebView | null>>();

export function registerWebView(pageId: string, ref: RefObject<WebView | null>): void {
  activeWebViews.set(pageId, ref);
}

export function unregisterWebView(pageId: string): void {
  activeWebViews.delete(pageId);
}

export function broadcastVariate(key: string, value: string): void {
  activeWebViews.forEach((ref) => {
    syncVariateToWebView(ref, key, value);
  });
}

export function broadcastCache(key: string, value: string): void {
  activeWebViews.forEach((ref) => {
    syncCacheToWebView(ref, key, value);
  });
}

export function broadcastScript(script: string): void {
  activeWebViews.forEach((ref) => {
    ref.current?.injectJavaScript(script);
  });
}
