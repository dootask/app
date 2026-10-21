import * as Application from 'expo-application';
import Constants from 'expo-constants';

/** 本地 Web 服务端口（必须保持 localhost:22223，否则 WebView 的 localStorage/IndexedDB 会丢失） */
export const LOCAL_WEB_PORT = 22223;
export const LOCAL_WEB_ORIGIN = `http://localhost:${LOCAL_WEB_PORT}`;

/**
 * 开发模式下直接加载的前端地址（如开发机前端 dev server 的对外地址）。
 * 由 ./cmd expo dev 自动推导或命令行传入 EXPO_PUBLIC_WEB_URL，Metro 内联，无需重新构建原生包。
 */
export const DEV_WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? '').trim();

/** 主页面入口地址：开发地址优先，否则走本地 Web 服务 */
export const MAIN_WEB_URL = DEV_WEB_URL || `${LOCAL_WEB_ORIGIN}/`;

/** 壳版本号（对应 eeui.getVersion，旧 eeui 框架版本号语义，前端未使用其数值） */
export const SHELL_VERSION = 100;
export const SHELL_VERSION_NAME = '1.0.0';

/** App 版本（对应 eeui.getLocalVersion / getLocalVersionName） */
export const APP_VERSION_NAME =
  Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.0.0';
export const APP_VERSION_CODE =
  Number(Application.nativeBuildVersion) ||
  Number(Constants.expoConfig?.extra?.versionCode) ||
  0;

/** 主页面名称（前端 $A.eeuiAppGetPageInfo().pageName === 'firstPage' 判断首页） */
export const FIRST_PAGE_NAME = 'firstPage';

/**
 * DooPush 客户端凭证（只能注册设备，随安装包分发，等同旧版 eeui.config.js 中的友盟 appkey）。
 * 服务端发送用的 App Secret 由各服务器在「系统设置 → App 推送」填写，不放在 App 里。
 */
export const DOOPUSH_APP_ID = '10';
export const DOOPUSH_APP_KEY = 'dp_ak_eSqQPRXcjSR1xXtOrXGcHvjKGVEKarBA';
