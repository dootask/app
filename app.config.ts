/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * 版本号来源（优先级从高到低）：
 * 1. 本仓库的 version.json（主仓库 ./cmd appexpo build 与包内前端同时写入，保证与打包的前端一致；
 *    构建机上的主仓库可能是旧版本，不能优先读它）
 * 2. 缺失时回退主仓库 ../../package.json 的 version / codeVerson
 */
function readVersion(): { version: string; code: number } {
  const candidates = [
    path.resolve(__dirname, 'version.json'),
    path.resolve(__dirname, '../../package.json'),
  ];
  for (const file of candidates) {
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      const version = json.version;
      const code = Number(json.codeVerson ?? json.code);
      if (typeof version === 'string' && Number.isFinite(code) && code > 0) {
        return { version, code };
      }
    } catch {
      // 尝试下一个
    }
  }
  throw new Error('无法读取 App 版本号：缺少 version.json 或 ../../package.json');
}

const { version, code } = readVersion();

/**
 * Android 厂商通道（小米/OPPO/vivo 等）客户端参数：不进仓库，由构建机环境变量 DOOPUSH_VENDORS_FILE
 * 指定 JSON 文件（绝对路径），结构同 doopush-react-native-sdk 插件的 android.vendors，
 * 如 { "oppo": { "appKey": "...", "appSecret": "..." } }；未指定则不启用
 */
function readPushVendors(): Record<string, unknown> {
  const file = process.env.DOOPUSH_VENDORS_FILE;
  if (!file) {
    return {};
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * iOS 权限说明：每种语言一个 locales/<lang>.json（生成 <lang>.lproj/InfoPlist.strings），
 * Info.plist 默认值取简体中文。.strings 不展开 $(PRODUCT_NAME)，文案里直接写 DooTask。
 * 语言与 CFBundleLocalizations 保持一致。
 */
const LOCALES = ['zh-Hans', 'zh-Hant', 'zh-HK', 'en', 'ja', 'ko', 'de', 'fr', 'id', 'ru'] as const;
const usage: Record<string, string> = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'locales/zh-Hans.json'), 'utf8'),
).ios;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'DooTask',
  slug: 'dootask',
  scheme: 'dootask',
  version,
  // Android 先以竖屏启动，再由运行时策略为平板解锁，避免手机横屏启动后闪转。
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  backgroundColor: '#ffffff',
  ios: {
    bundleIdentifier: 'com.dootask.task',
    buildNumber: String(code),
    // Guangxi Hitosea（与旧 eeui 上架团队一致），真机自动签名用
    appleTeamId: 'G365J5PZA2',
    supportsTablet: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      // 声明支持的语言，系统菜单（复制/翻译等）才会跟随手机语言；缺省时只按英文显示
      CFBundleLocalizations: [...LOCALES],
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: true,
        NSAllowsLocalNetworking: true,
      },
      UIBackgroundModes: ['audio'],
      // 相机、麦克风、相册、定位、本地网络（自部署服务器在局域网时，WebView 访问会触发授权）。
      // 本地网络说明须为自定义文案：expo-dev-launcher 只在 Release 构建中删除它自己的默认文案。
      ...usage,
    },
    // App 级隐私清单。依赖库各自的清单随包合并；DooPushSDK（源码 Pod）未自带清单，
    // 其 UserDefaults 用途由此处 CA92.1 覆盖；1C8F.1 为分享扩展共享的 App Group。
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1', '1C8F.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
      ],
    },
  },
  locales: Object.fromEntries(LOCALES.map((lang) => [lang, `./locales/${lang}.json`])),
  android: {
    package: 'com.dootask.task',
    versionCode: code,
    adaptiveIcon: {
      backgroundColor: '#8BCF70',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // 与旧 eeui 一致；DooPush SDK 清单声明 false，默认 true 会导致 Release 清单合并失败
    allowBackup: false,
    permissions: [
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.MODIFY_AUDIO_SETTINGS',
      'android.permission.VIBRATE',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
    ],
  },
  plugins: [
    // 同类 mod 后注册先执行：放在最前，才能在 with-share 加完 Copy Files 阶段后再调整顺序
    './plugins/with-release-strip-order',
    'expo-router',
    'expo-status-bar',
    'expo-localization',
    [
      'expo-location',
      {
        locationWhenInUsePermission: usage.NSLocationWhenInUseUsageDescription,
        locationAlwaysPermission: false,
        locationAlwaysAndWhenInUsePermission: false,
        locationFullAccuracyPermission: false,
        motionUsagePermission: false,
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
        isAndroidForegroundServiceEnabled: false,
        isAndroidMotionActivityEnabled: false,
      },
    ],
    'expo-sqlite',
    'expo-web-browser',
    [
      'expo-build-properties',
      {
        android: {
          // 本地 Web 服务 http://localhost:22223 需要明文流量
          usesCleartextTraffic: true,
          // 原生库压缩打包（与旧 eeui 一致）；不压缩时 APK 约 424MB，压缩后接近旧版体积
          useLegacyPackaging: true,
          // DooPush SDK 的 vivo 接收器继承 vivo 推送 SDK，未配置 vivo 通道时该 SDK 不引入，Release 混淆需忽略；
          // HMS 按华为混淆说明保留（DooPush 反射调用），EMUI 系统类与华为分析 SDK 仅在真机/按需存在；
          // DooPush SDK 用 Gson 反射序列化请求/响应（Gson 2.10 不带混淆规则），不保留则注册请求字段被剔除（HTTP 400）；
          // OPPO/vivo/小米推送 SDK 同样被 DooPush 反射调用且 aar 不带混淆规则，不保留时类名被混淆、注册失败（3305）
          extraProguardRules: [
            '-keep class com.heytap.msp.** { *; }',
            '-dontwarn com.heytap.**',
            '-keep class com.vivo.push.** { *; }',
            '-keep class com.xiaomi.mipush.sdk.** { *; }',
            '-dontwarn com.xiaomi.**',
            '-dontwarn com.vivo.push.**',
            '-keep class com.doopush.sdk.** { *; }',
            '-keepattributes Signature,*Annotation*,InnerClasses,EnclosingMethod',
            '-keep class * extends com.google.gson.reflect.TypeToken',
            '-keep,allowobfuscation,allowshrinking class com.google.gson.reflect.TypeToken',
            '-keep class com.huawei.hms.** { *; }',
            '-keep class com.huawei.hianalytics.** { *; }',
            '-dontwarn com.huawei.**',
            '-dontwarn android.telephony.HwTelephonyManager',
          ].join('\n'),
          // Agora full-sdk 自带的可选扩展（会议未使用：美颜/虚拟背景/空间音频/屏幕共享等），剔除以减小体积；
          // 保留 AI 降噪与回声消除、视频编码扩展
          packagingOptions: {
            exclude: [
              'audio_beauty', 'clear_vision', 'content_inspect', 'face_capture', 'face_detection', 'lip_sync',
              'screen_capture', 'segmentation', 'spatial_audio', 'video_av1_encoder', 'video_quality_analyzer',
            ].map((name) => `**/libagora_${name}_extension.so`),
          },
        },
      },
    ],
    './plugins/with-web-assets',
    [
      'expo-camera',
      {
        cameraPermission: usage.NSCameraUsageDescription,
        microphonePermission: usage.NSMicrophoneUsageDescription,
        barcodeScannerEnabled: true,
      },
    ],
    [
      'expo-media-library',
      {
        photosPermission: usage.NSPhotoLibraryUsageDescription,
        savePhotosPermission: usage.NSPhotoLibraryAddUsageDescription,
        granularPermissions: ['photo', 'video'],
      },
    ],
    'expo-video',
    [
      'expo-notifications',
      {
        // 远程推送由 DooPush 插件负责（aps-environment、remote-notification），这里只用本地权限/角标/点击响应
        enableRemoteNotifications: false,
        enableBackgroundRemoteNotifications: false,
      },
    ],
    [
      'doopush-react-native-sdk',
      {
        // App ID / App Key 在 src/config.ts 中由 JS 调用 DooPush.configure 传入
        ios: { mode: 'production' },
        // Android 厂商通道：凭证文件不进仓库，由构建机环境变量指定（绝对路径），未指定则不启用
        android: {
          vendors: {
            ...readPushVendors(),
            ...(process.env.DOOPUSH_HMS_SERVICES_FILE && { hms: { agconnectServicesFile: process.env.DOOPUSH_HMS_SERVICES_FILE } }),
          },
        },
      },
    ],
    './plugins/with-share',
    './plugins/with-meeting',
    'expo-screen-orientation',
    './plugins/with-device-orientation',
    './plugins/with-legacy-launcher',
    './plugins/with-legacy-splash',
    './plugins/with-window-controls',
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    versionCode: code,
  },
});
