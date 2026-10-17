const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const xcode = require('xcode');
const plist = require('@expo/plist').default;

const root = path.resolve(__dirname, '../../..');
const iosRoot = path.join(root, 'ios');
const project = xcode.project(path.join(iosRoot, 'DooTask.xcodeproj/project.pbxproj'));
project.parseSync();
const unquote = (value) => String(value).replaceAll('"', '');
const targets = Object.entries(project.pbxNativeTargetSection()).filter(([, value]) => typeof value === 'object');
const extensions = targets.filter(([, value]) => unquote(value.name) === 'shareExtension');
assert.equal(extensions.length, 1);
const [extensionId, extension] = extensions[0];
assert.equal(unquote(extension.productType), 'com.apple.product-type.app-extension');
const host = targets.find(([, value]) => unquote(value.name) === 'DooTask')[1];
assert.ok(host.dependencies.some((ref) => project.hash.project.objects.PBXTargetDependency[ref.value].target === extensionId));
const phases = extension.buildPhases.map((ref) => project.hash.project.objects.PBXSourcesBuildPhase?.[ref.value]).filter(Boolean);
assert.equal(phases.length, 1);
const files = project.pbxFileReferenceSection();
const builds = project.pbxBuildFileSection();
const sourceNames = phases[0].files.map((ref) => unquote(files[builds[ref.value].fileRef].path)).sort();
assert.deepEqual(sourceNames, ['ShareAttachmentLoader.swift', 'ShareStorage.swift', 'ShareTransport.swift', 'ShareViewController.swift']);
for (const name of sourceNames) {
  const source = path.join(root, 'modules/share', name === 'ShareStorage.swift' ? 'ios' : 'extension', name);
  assert.equal(fs.readFileSync(path.join(iosRoot, 'shareExtension', name), 'utf8'), fs.readFileSync(source, 'utf8'));
}
const resources = extension.buildPhases.map((ref) => project.hash.project.objects.PBXResourcesBuildPhase?.[ref.value]).filter(Boolean);
assert.equal(resources.length, 1);
assert.equal(resources[0].files.length, 2);
const variant = Object.values(project.hash.project.objects.PBXVariantGroup).filter((group) => typeof group === 'object' && unquote(group.name) === 'Localizable.strings');
assert.equal(variant.length, 1);
assert.equal(variant[0].children.length, 11);
const configurations = project.pbxXCBuildConfigurationSection();
const list = project.pbxXCConfigurationList()[extension.buildConfigurationList];
for (const ref of list.buildConfigurations) {
  const settings = configurations[ref.value].buildSettings;
  assert.equal(unquote(settings.PRODUCT_BUNDLE_IDENTIFIER), 'com.dootask.task.shareExtension');
  assert.equal(settings.APPLICATION_EXTENSION_API_ONLY, 'YES');
  assert.equal(settings.CODE_SIGN_ENTITLEMENTS, 'shareExtension/shareExtension.entitlements');
}
const embedded = Object.values(project.hash.project.objects.PBXCopyFilesBuildPhase).filter((phase) => typeof phase === 'object' && Number(phase.dstSubfolderSpec) === 13);
assert.equal(embedded.length, 1);
assert.equal(embedded[0].files.length, 1);
assert.equal(builds[embedded[0].files[0].value].fileRef, extension.productReference);
assert.ok(builds[embedded[0].files[0].value].settings.ATTRIBUTES.includes('CodeSignOnCopy'));
for (const file of ['DooTask/DooTask.entitlements', 'shareExtension/shareExtension.entitlements']) {
  assert.deepEqual(plist.parse(fs.readFileSync(path.join(iosRoot, file), 'utf8'))['com.apple.security.application-groups'], ['group.im.dootask']);
}
const info = plist.parse(fs.readFileSync(path.join(iosRoot, 'shareExtension/Info.plist'), 'utf8'));
assert.equal(info.NSExtension.NSExtensionPrincipalClass, '$(PRODUCT_MODULE_NAME).ShareViewController');
const manifest = fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
const shareActivity = manifest.match(/<activity[^>]*android:name="expo\.modules\.dootaskshare\.ShareActivity"[\s\S]*?<\/activity>/g);
assert.equal(shareActivity.length, 1);
assert.match(shareActivity[0], /android:exported="true"/);
for (const action of ['SEND', 'SEND_MULTIPLE']) assert.ok(shareActivity[0].includes(`android.intent.action.${action}"`));
for (const mime of ['application/*', 'image/*', 'video/*', 'audio/*', 'text/*']) assert.ok(shareActivity[0].includes(`android:mimeType="${mime}"`));
assert.ok(!manifest.match(/<activity[^>]*android:name="\.MainActivity"[\s\S]*?<\/activity>/)[0].includes('android.intent.action.SEND'));
async function verifyRepeatedMods() {
  const os = require('node:os');
  const { AndroidConfig } = require('expo/config-plugins');
  const plugin = require('../../../plugins/with-share');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dootask-share-plugin-'));
  try {
    const config = plugin({ name: 'DooTask', slug: 'dootask', version: '1.0.0', ios: { buildNumber: '1', appleTeamId: 'BUILDTEAM1' } });
    const request = { projectRoot: root, platformProjectRoot: temporary, projectName: 'DooTask', platform: 'ios' };
    for (let count = 0; count < 2; count += 1) {
      await config.mods.ios.xcodeproj({ ...config, modRequest: request, modResults: project });
    }
    assert.equal(Object.values(project.pbxNativeTargetSection()).filter((item) => typeof item === 'object').length, targets.length);
    assert.equal(host.dependencies.length, 1);
    assert.equal(resources[0].files.length, 2);
    for (const ref of list.buildConfigurations) assert.equal(configurations[ref.value].buildSettings.DEVELOPMENT_TEAM, 'BUILDTEAM1');
    let entitlements = { 'other.capability': ['preserved'] };
    for (let count = 0; count < 2; count += 1) {
      entitlements = (await config.mods.ios.entitlements({ ...config, modRequest: request, modResults: entitlements })).modResults;
    }
    assert.deepEqual(entitlements, { 'other.capability': ['preserved'], 'com.apple.security.application-groups': ['group.im.dootask'] });
    let android = await AndroidConfig.Manifest.readAndroidManifestAsync(path.join(root, 'android/app/src/main/AndroidManifest.xml'));
    for (let count = 0; count < 2; count += 1) {
      android = (await config.mods.android.manifest({ ...config, modRequest: { ...request, platform: 'android' }, modResults: android })).modResults;
    }
    assert.equal(android.manifest.application[0].activity.filter((activity) => activity.$['android:name'] === 'expo.modules.dootaskshare.ShareActivity').length, 1);
    assert.equal(config.extra.eas.build.experimental.ios.appExtensions[0].bundleIdentifier, 'com.dootask.task.shareExtension');
    assert.equal(fs.readFileSync(path.join(temporary, 'shareExtension/ShareStorage.swift'), 'utf8'), fs.readFileSync(path.join(root, 'modules/share/ios/ShareStorage.swift'), 'utf8'));
    console.log('扩展 target、依赖/嵌入/源文件/本地化/App Group、Android intent-filter、重复执行与构建 team 传递均通过');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
verifyRepeatedMods().catch((error) => { console.error(error); process.exitCode = 1; });
