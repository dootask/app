/* global __dirname: readonly */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const plist = require('@expo/plist').default;
const { AndroidConfig } = require('expo/config-plugins');

async function main() {
  const project = process.argv[2];
  assert.ok(project, '用法：node modules/meeting/tests/check-prebuild.cjs /tmp/隔离工程');
  const manifestPath = path.join(project, 'android/app/src/main/AndroidManifest.xml');
  const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(manifestPath);
  const info = plist.parse(fs.readFileSync(path.join(project, 'ios/DooTask/Info.plist'), 'utf8'));
  assert.ok(info.NSCameraUsageDescription);
  assert.ok(info.NSMicrophoneUsageDescription);
  assert.ok(info.UIBackgroundModes.includes('audio'));
  assert.ok(info.UIBackgroundModes.includes('voip'));
  assert.ok(!info.UIBackgroundModes.includes('remote-notification'));
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const services = application.service.filter((item) => item.$['android:name'] === 'expo.modules.dootaskmeeting.MeetingKeepAliveService');
  assert.equal(services.length, 1);
  assert.equal(services[0].$['android:exported'], 'false');
  assert.equal(services[0].$['android:stopWithTask'], 'false');
  assert.deepEqual(services[0].$['android:foregroundServiceType'].split('|').sort(), ['camera', 'mediaPlayback', 'microphone']);
  const permissions = manifest.manifest['uses-permission'].map((item) => item.$['android:name']);
  for (const permission of ['CAMERA', 'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS', 'BLUETOOTH_CONNECT', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_CAMERA', 'FOREGROUND_SERVICE_MICROPHONE', 'FOREGROUND_SERVICE_MEDIA_PLAYBACK']) {
    assert.ok(permissions.includes(`android.permission.${permission}`), permission);
  }
  assert.equal(new Set(permissions).size, permissions.length);
  const gradle = fs.readFileSync(path.join(project, 'android/app/build.gradle'), 'utf8');
  assert.match(gradle, /applicationId ['"]com\.dootask\.task['"]/);
  const xcode = fs.readFileSync(path.join(project, 'ios/DooTask.xcodeproj/project.pbxproj'), 'utf8');
  assert.ok(/PRODUCT_BUNDLE_IDENTIFIER = "?com\.dootask\.task"?;/.test(xcode), '主 App Bundle ID');
  const entitlements = plist.parse(fs.readFileSync(path.join(project, 'ios/DooTask/DooTask.entitlements'), 'utf8'));
  assert.ok(!('aps-environment' in entitlements));

  // 对真实插件再应用两遍，确认现有生成物与其它插件配置不会被重复或覆盖。
  const transforms = {};
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../../plugins/with-meeting.js'), 'utf8'), {
    module, require(name) {
      assert.equal(name, 'expo/config-plugins');
      return {
        AndroidConfig,
        withAndroidManifest(config, callback) { transforms.android = callback; return config; },
        withInfoPlist(config, callback) { transforms.ios = callback; return config; },
      };
    },
  });
  module.exports({});
  const beforeManifest = JSON.stringify(manifest);
  const beforeInfo = JSON.stringify(info);
  for (let i = 0; i < 2; i++) {
    transforms.android({ modResults: manifest });
    transforms.ios({ modResults: info });
  }
  assert.equal(JSON.stringify(manifest), beforeManifest);
  assert.equal(JSON.stringify(info), beforeInfo);
  console.log('会议权限、后台模式、服务声明、包名、无推送 entitlement、插件幂等检查通过。');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
