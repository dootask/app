const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const ANCHOR = '// Extension point for config plugins.';
const MARK = 'preferredWindowingControlStyleForScene';

// iPadOS 26 窗口化时左上角的红黄绿窗口控件使用紧凑样式（minimal：尽量少占场景空间），
// 不额外占一条顶栏，减少网页顶部留白。
const METHOD = `
  @available(iOS 26.0, *)
  @objc(preferredWindowingControlStyleForScene:)
  func preferredWindowingControlStyle(for windowScene: UIWindowScene) -> UIWindowScene.WindowingControlStyle {
    return .minimal
  }`;

module.exports = function withWindowControls(config) {
  return withDangerousMod(config, [
    'ios',
    (mod) => {
      const file = path.join(mod.modRequest.platformProjectRoot, mod.modRequest.projectName, 'SceneDelegate.swift');
      let src = fs.readFileSync(file, 'utf8');
      if (src.includes(MARK)) return mod;
      if (!src.includes(ANCHOR)) throw new Error(`with-window-controls: ${file} 中找不到插入点`);
      src = src.replace(ANCHOR, ANCHOR + '\n' + METHOD);
      if (!/^import UIKit$/m.test(src)) src = 'import UIKit\n' + src;
      fs.writeFileSync(file, src);
      return mod;
    },
  ]);
};
