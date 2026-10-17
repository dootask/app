// 对已 prebuild 的工程单独运行 Expo config mod，只配置两个产品 target 的 Release 签名。
// 不修改 app.config.ts，不重跑应用的其他插件，不影响 Pods 或资源 bundle 的签名设置。
const fs = require('node:fs');
const path = require('node:path');
const { compileModsAsync, withXcodeProject } = require('expo/config-plugins');

async function configure() {
  const signing = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const projectRoot = path.resolve(__dirname, '..');
  const config = withXcodeProject({ name: 'DooTask', slug: 'dootask' }, (mod) => {
    const project = mod.modResults;
    const found = new Set();
    const configurations = project.pbxXCBuildConfigurationSection();
    for (const target of Object.values(project.pbxNativeTargetSection())) {
      if (!target || typeof target !== 'object') continue;
      const list = project.pbxXCConfigurationList()[target.buildConfigurationList];
      for (const reference of list.buildConfigurations) {
        const configuration = configurations[reference.value];
        if (configuration.name !== 'Release') continue;
        const settings = configuration.buildSettings;
        const bundleId = String(settings.PRODUCT_BUNDLE_IDENTIFIER).replace(/^"|"$/g, '');
        if (!Object.hasOwn(signing.profiles, bundleId)) continue;
        Object.assign(settings, {
          CODE_SIGN_STYLE: 'Manual',
          DEVELOPMENT_TEAM: signing.team,
          CODE_SIGN_IDENTITY: signing.identity,
          '"CODE_SIGN_IDENTITY[sdk=iphoneos*]"': signing.identity,
          PROVISIONING_PROFILE_SPECIFIER: signing.profiles[bundleId].uuid,
        });
        delete settings.PROVISIONING_PROFILE;
        found.add(bundleId);
      }
    }
    for (const bundleId of Object.keys(signing.profiles)) {
      if (!found.has(bundleId)) throw new Error(`缺少 Release target：${bundleId}`);
    }
    return mod;
  });
  await compileModsAsync(config, { projectRoot, platforms: ['ios'] });
  console.log('已通过 Expo config mod 配置主 App / 分享扩展手动签名');
}

configure().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
