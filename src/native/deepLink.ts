import { useEffect, useRef } from 'react';
import * as Linking from 'expo-linking';

import type { PageHandle } from '../bridge/pages';
import { bridgeStore } from '../bridge/store';
import { isFrontendDeepLink } from './linkRouting';

const READY_AT = 'native:deepLinkReadyAt';
const INITIAL_HANDLED = '__nativeInitialLinkHandled';

/** getPage 应在 WebView 成功加载前返回 null；首次就绪再留两秒给 Vue 注册全局函数。 */
export function useDeepLinkHandler(getPage: () => PageHandle | null): void {
  const getPageRef = useRef(getPage);
  useEffect(() => { getPageRef.current = getPage; }, [getPage]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending: { url: string; initial: boolean }[] = [];
    const eventsBeforeInitial = new Set<string>();
    let initialResolved = false;

    const pump = () => {
      if (disposed) return;
      if (timer) clearTimeout(timer);
      const page = getPageRef.current();
      if (page) {
        let readyAt = page.state.get(READY_AT) as number | undefined;
        if (readyAt === undefined) {
          readyAt = Date.now() + 2000;
          page.state.set(READY_AT, readyAt);
        }
        if (Date.now() >= readyAt) {
          while (pending.length) {
            const link = pending.shift()!;
            // 旧 iOS share 入口和 Android WelcomeActivity 都会先移除 scheme。
            const path = link.url.replace(/^dootask:\/\//i, '');
            page.invokeWindow('__handleLink', path);
            if (link.initial) bridgeStore.setVariate(INITIAL_HANDLED, true);
          }
          return;
        }
      }
      timer = setTimeout(pump, 250);
    };
    const receive = (url: string, initial = false) => {
      if (disposed || !isFrontendDeepLink(url)) return;
      // 初始 URL 先返回、随后又收到系统 url 事件时，也只保留一次待投递。
      if (pending.some((link) => link.initial && link.url === url)) return;
      pending.push({ url, initial });
      pump();
    };
    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (!initialResolved) eventsBeforeInitial.add(url);
      receive(url);
    });
    void Linking.getInitialURL().then((url) => {
      initialResolved = true;
      if (disposed || !url || !isFrontendDeepLink(url) || bridgeStore.getVariate(INITIAL_HANDLED, false)) return;
      if (!eventsBeforeInitial.has(url)) receive(url, true);
      else {
        const queued = pending.find((link) => link.url === url);
        if (queued) queued.initial = true;
        else bridgeStore.setVariate(INITIAL_HANDLED, true);
      }
      eventsBeforeInitial.clear();
    }).catch((error) => {
      initialResolved = true;
      eventsBeforeInitial.clear();
      if (!disposed) console.warn('[native/deepLink] 读取初始链接失败', error);
    });
    pump();
    return () => {
      disposed = true;
      subscription.remove();
      if (timer) clearTimeout(timer);
    };
  }, []);
}
