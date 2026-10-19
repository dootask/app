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

const usage = (text: string) => `$(PRODUCT_NAME) ${text}`;

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
      CFBundleLocalizations: ['zh-Hans', 'zh-Hant', 'zh-HK', 'en', 'ja', 'ko', 'de', 'fr', 'id', 'ru'],
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: true,
        NSAllowsLocalNetworking: true,
      },
      UIBackgroundModes: ['audio'],
      NSCameraUsageDescription: usage('需要访问您的相机，以便您可以扫描二维码、拍摄照片或进行视频会议。'),
      NSMicrophoneUsageDescription: usage('需要访问您的麦克风，以便您可以录制语音交流。'),
      NSPhotoLibraryUsageDescription: usage('需要访问您的相册，以便您可以选择和发送图片。'),
      NSPhotoLibraryAddUsageDescription: usage('需要访问您的相册，以便您可以保存图片。'),
      NSLocationWhenInUseUsageDescription: usage('需要在使用期间访问您的位置，以便您可以进行定位签到。'),
      NSContactsUsageDescription: usage('需要您的同意，才能访问通讯录。'),
      NSCalendarsUsageDescription: usage('需要您的同意，才能访问日历。'),
    },
  },
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
    'expo-router',
    'expo-status-bar',
    'expo-localization',
    [
      'expo-location',
      {
        locationWhenInUsePermission: usage('需要在使用期间访问您的位置，以便您可以进行定位签到。'),
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
        cameraPermission: usage('需要访问您的相机，以便您可以扫描二维码、拍摄照片或进行视频会议。'),
        microphonePermission: usage('需要访问您的麦克风，以便您可以录制语音交流。'),
        barcodeScannerEnabled: true,
      },
    ],
    [
      'expo-media-library',
      {
        photosPermission: usage('需要访问您的相册，以便您可以查看最近照片、选择和发送图片。'),
        savePhotosPermission: usage('需要访问您的相册，以便您可以保存图片。'),
        granularPermissions: ['photo', 'video'],
      },
    ],
    'expo-video',
    [
      'expo-notifications',
      {
        // 一期只用本地权限/角标，不写 aps-environment；二期接 DooPush 时再开启
        enableRemoteNotifications: false,
        enableBackgroundRemoteNotifications: false,
      },
    ],
    './plugins/with-share',
    './plugins/with-meeting',
    'expo-screen-orientation',
    './plugins/with-device-orientation',
    './plugins/with-legacy-launcher',
    './plugins/with-legacy-splash',
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    versionCode: code,
  },
});
