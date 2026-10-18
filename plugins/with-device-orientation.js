const { withInfoPlist } = require('expo/config-plugins');

module.exports = function withDeviceOrientation(config) {
  return withInfoPlist(config, (mod) => {
    // Expo 的 portrait 默认还含倒置竖屏；旧 iPhone 只允许正向竖屏。
    mod.modResults.UISupportedInterfaceOrientations = ['UIInterfaceOrientationPortrait'];
    mod.modResults['UISupportedInterfaceOrientations~ipad'] = [
      'UIInterfaceOrientationPortrait',
      'UIInterfaceOrientationPortraitUpsideDown',
      'UIInterfaceOrientationLandscapeLeft',
      'UIInterfaceOrientationLandscapeRight',
    ];
    // 与旧 Info.plist 一致，保留 iPad 多任务分屏能力。
    mod.modResults.UIRequiresFullScreen = false;
    return mod;
  });
};
