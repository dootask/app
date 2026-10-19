const { AndroidConfig, withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

const SERVICE = 'expo.modules.dootaskmeeting.MeetingKeepAliveService';
const permissions = [
  'android.permission.CAMERA', 'android.permission.RECORD_AUDIO',
  'android.permission.MODIFY_AUDIO_SETTINGS', 'android.permission.ACCESS_WIFI_STATE',
  'android.permission.BLUETOOTH_CONNECT',
  'android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_CAMERA',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE', 'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
];

module.exports = function withMeeting(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.NSCameraUsageDescription ??= '$(PRODUCT_NAME) 需要使用相机进行视频会议。';
    mod.modResults.NSMicrophoneUsageDescription ??= '$(PRODUCT_NAME) 需要使用麦克风进行语音及视频会议。';
    // 会议后台保持通话只需 audio；未使用 PushKit/CallKit，不声明 voip（只声明不用会被审核拒绝）
    const modes = (mod.modResults.UIBackgroundModes ?? []).filter((mode) => mode !== 'voip');
    mod.modResults.UIBackgroundModes = [...new Set([...modes, 'audio'])];
    return mod;
  });
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const declared = manifest['uses-permission'] ??= [];
    for (const name of permissions) {
      if (!declared.some((item) => item.$['android:name'] === name)) declared.push({ $: { 'android:name': name } });
    }
    if (!declared.some((item) => item.$['android:name'] === 'android.permission.BLUETOOTH')) {
      declared.push({ $: { 'android:name': 'android.permission.BLUETOOTH', 'android:maxSdkVersion': '30' } });
    }
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    const services = application.service ??= [];
    const service = services.find((item) => item.$['android:name'] === SERVICE);
    const attributes = {
      'android:name': SERVICE, 'android:exported': 'false',
      // false 才会收到 onTaskRemoved，由服务先释放 Agora 再停止自身。
      'android:foregroundServiceType': 'camera|microphone|mediaPlayback', 'android:stopWithTask': 'false',
    };
    if (service) Object.assign(service.$, attributes);
    else services.push({ $: attributes });
    return mod;
  });
};
