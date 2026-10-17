const fs = require('node:fs');
const path = require('node:path');
const { createRunOncePlugin, IOSConfig, withDangerousMod, withXcodeProject } = require('expo/config-plugins');

function copyAssets(config, destination) {
  const source = path.join(config.modRequest.projectRoot, 'assets', 'web');
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    console.warn('[with-web-assets] assets/web/ 不存在，跳过内置前端资源复制');
    return false;
  }
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, dereference: true });
  return true;
}

function withWebAssets(config) {
  config = withDangerousMod(config, ['android', async (mod) => {
    copyAssets(mod, path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'assets', 'web'));
    return mod;
  }]);

  return withXcodeProject(config, (mod) => {
    const { platformProjectRoot, projectName } = mod.modRequest;
    if (!copyAssets(mod, path.join(platformProjectRoot, projectName, 'web'))) return mod;
    const project = mod.modResults;
    IOSConfig.XcodeUtils.addResourceFileToGroup({
      filepath: `${projectName}/web`,
      groupName: projectName,
      isBuildFile: true,
      project,
    });
    // 蓝色 folder reference 保留目录结构，Bundle 中的根目录固定为 web/。
    for (const reference of Object.values(project.pbxFileReferenceSection())) {
      if (typeof reference !== 'object' || !reference) continue;
      const resourcePath = String(reference.path).replace(/^"|"$/g, '');
      if (resourcePath === 'web' || resourcePath === `${projectName}/web`) {
        reference.lastKnownFileType = 'folder';
        delete reference.explicitFileType;
        delete reference.fileEncoding;
      }
    }
    return mod;
  });
}

module.exports = createRunOncePlugin(withWebAssets, 'with-web-assets', '1.0.0');
