const fs = require('node:fs');
const path = require('node:path');
const { withAndroidStyles, withDangerousMod } = require('expo/config-plugins');

// 旧 eeui WelcomeActivity 的启动图：浅色/深色铺底 + 底部咖啡杯（资源原样取自旧工程，加 legacy_ 前缀避免重名）。
// 模板默认的 splashscreen_logo 是 Expo 示例网格图，这里改用旧启动图。drawable-port-* 之外补 xhdpi 兜底，防平板横屏找不到资源。
const SOURCE = path.join(__dirname, '../assets/splash/android');

function copyDir(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      copyDir(src, dst);
    } else {
      fs.copyFileSync(src, dst);
    }
  }
}

module.exports = function withLegacySplash(config) {
  config = withDangerousMod(config, ['android', (mod) => {
    copyDir(SOURCE, path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res'));
    return mod;
  }]);
  return withAndroidStyles(config, (mod) => {
    const style = mod.modResults.resources.style?.find((item) => item.$.name === 'Theme.App.SplashScreen');
    if (!style) throw new Error('with-legacy-splash: 未找到 Theme.App.SplashScreen');
    const item = style.item?.find((entry) => entry.$.name === 'android:windowBackground');
    if (item) item._ = '@drawable/legacy_splash_bitmap';
    else (style.item ??= []).push({ $: { name: 'android:windowBackground' }, _: '@drawable/legacy_splash_bitmap' });
    return mod;
  });
};
