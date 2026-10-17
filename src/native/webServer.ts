import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { getWebServerModule } from '../../modules/web-server';
import { bridgeStore } from '../bridge/store';
import { DEV_WEB_URL, LOCAL_WEB_ORIGIN, LOCAL_WEB_PORT, MAIN_WEB_URL } from '../config';

let startup: Promise<string> | null = null;

/** 首次尝试失败后再重试三次；并发调用共享一次启动过程。 */
export function ensureWebServer(): Promise<string> {
  if (startup) return startup;
  startup = (async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        const module = getWebServerModule();
        // start 自身也是幂等的，并检查已运行实例的端口。
        const result = await module.start(LOCAL_WEB_PORT);
        if (result.port !== LOCAL_WEB_PORT || !(await module.isRunning())) {
          throw new Error(`本地 Web 服务尚未在 ${LOCAL_WEB_PORT} 就绪`);
        }
        bridgeStore.setCachesString('appWebServerPort', String(LOCAL_WEB_PORT), 0);
        return LOCAL_WEB_ORIGIN;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw lastError;
  })().finally(() => { startup = null; });
  return startup;
}

/** 仅在服务就绪后给出主页面地址；开发地址模式完全跳过原生服务。 */
export function useLocalWebReady(): string | null {
  const [url, setUrl] = useState<string | null>(DEV_WEB_URL || null);
  useEffect(() => {
    if (DEV_WEB_URL) return;
    let disposed = false;
    const start = async () => {
      try {
        await ensureWebServer();
        if (!disposed) setUrl(MAIN_WEB_URL);
      } catch (error) {
        if (!disposed) {
          setUrl(null);
          console.warn('[native/webServer] 本地 Web 服务启动失败', error);
        }
      }
    };
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void (async () => {
        try {
          if (await getWebServerModule().isRunning()) {
            if (!disposed) setUrl(MAIN_WEB_URL);
            return;
          }
        } catch {
          // 状态查询失败时也走有重试的启动流程。
        }
        if (!disposed) await start();
      })();
    });
    void start();
    return () => {
      disposed = true;
      subscription.remove();
    };
  }, []);
  return url;
}
