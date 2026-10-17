import { requireNativeModule } from 'expo-modules-core';

interface WebServerModule {
  start(port: number): Promise<{ port: number }>;
  stop(): Promise<void>;
  isRunning(): Promise<boolean>;
}

// 延迟加载，开发地址模式无需安装或启动此原生模块。
export function getWebServerModule(): WebServerModule {
  return requireNativeModule<WebServerModule>('DooTaskWebServer');
}
