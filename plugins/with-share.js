const fs = require('node:fs');
const path = require('node:path');
const plist = require('@expo/plist').default;
const { createRunOncePlugin, withAndroidManifest, withEntitlementsPlist, withXcodeProject } = require('expo/config-plugins');

const TARGET = 'shareExtension';
const ACTIVITY = 'expo.modules.dootaskshare.ShareActivity';

function writePlist(file, value) {
  fs.writeFileSync(file, plist.build(value));
}

/**
 * 分享扩展：标识为主 App 包名 + .shareExtension；App Group 由 app.config.ts 传入（区分正式版与 dev 变体），
 * 同时写入主 App 与扩展的 Info.plist（DooTaskAppGroup），ShareStorage.swift 运行时读取
 */
function withShare(config, { appGroup: APP_GROUP = 'group.im.dootask' } = {}) {
  const BUNDLE_ID = `${config.ios?.bundleIdentifier ?? 'com.dootask.task'}.${TARGET}`;
  config.ios ??= {};
  config.ios.infoPlist = { ...config.ios.infoPlist, DooTaskAppGroup: APP_GROUP };
  // EAS 需要在生成工程之前知道扩展的标识与签名能力。
  config.extra ??= {};
  config.extra.eas ??= {};
  config.extra.eas.build ??= {};
  config.extra.eas.build.experimental ??= {};
  config.extra.eas.build.experimental.ios ??= {};
  const iosBuild = config.extra.eas.build.experimental.ios;
  iosBuild.appExtensions = [
    ...(iosBuild.appExtensions ?? []).filter((extension) => extension.targetName !== TARGET),
    { targetName: TARGET, bundleIdentifier: BUNDLE_ID, entitlements: { 'com.apple.security.application-groups': [APP_GROUP] } },
  ];

  config = withEntitlementsPlist(config, (mod) => {
    mod.modResults['com.apple.security.application-groups'] = [...new Set([
      ...(mod.modResults['com.apple.security.application-groups'] ?? []), APP_GROUP,
    ])];
    return mod;
  });

  config = withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application[0];
    application.activity ??= [];
    application.activity = application.activity.filter((activity) => activity.$['android:name'] !== ACTIVITY);
    application.activity.push({
      $: {
        'android:name': ACTIVITY,
        'android:exported': 'true',
        'android:label': config.name,
        'android:theme': '@style/DooTaskShareTheme',
        'android:windowSoftInputMode': 'adjustResize',
        'android:configChanges': 'orientation|screenSize|screenLayout|keyboardHidden',
        // 独立实例消费当前 intent；不把 SEND 交给 MainActivity / Expo Router。
        'android:launchMode': 'standard',
      },
      'intent-filter': ['android.intent.action.SEND', 'android.intent.action.SEND_MULTIPLE'].map((action) => ({
        action: [{ $: { 'android:name': action } }],
        category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
        data: ['application/*', 'image/*', 'video/*', 'audio/*', 'text/*'].map((mime) => ({ $: { 'android:mimeType': mime } })),
      })),
    });
    return mod;
  });

  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const source = path.join(mod.modRequest.projectRoot, 'modules/share');
    const destination = path.join(mod.modRequest.platformProjectRoot, TARGET);
    // 所有生成文件均由插件写入，clean prebuild 不依赖旧壳目录。
    fs.rmSync(destination, { recursive: true, force: true });
    fs.cpSync(path.join(source, 'extension'), destination, { recursive: true });
    for (const file of ['ShareStorage.swift', 'PrivacyInfo.xcprivacy']) {
      fs.copyFileSync(path.join(source, 'ios', file), path.join(destination, file));
    }
    writePlist(path.join(destination, `${TARGET}.entitlements`), { 'com.apple.security.application-groups': [APP_GROUP] });
    writePlist(path.join(destination, 'Info.plist'), {
      CFBundleDisplayName: config.name,
      CFBundleName: '$(PRODUCT_NAME)',
      CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
      CFBundleExecutable: '$(EXECUTABLE_NAME)',
      CFBundlePackageType: 'XPC!',
      CFBundleInfoDictionaryVersion: '6.0',
      CFBundleShortVersionString: '$(MARKETING_VERSION)',
      CFBundleVersion: '$(CURRENT_PROJECT_VERSION)',
      CFBundleDevelopmentRegion: 'en',
      DooTaskAppGroup: APP_GROUP,
      NSAppTransportSecurity: config.ios?.infoPlist?.NSAppTransportSecurity ?? { NSAllowsArbitraryLoads: true },
      NSExtension: {
        NSExtensionPointIdentifier: 'com.apple.share-services',
        NSExtensionPrincipalClass: '$(PRODUCT_MODULE_NAME).ShareViewController',
        NSExtensionAttributes: {
          NSExtensionActivationRule: {
            NSExtensionActivationDictionaryVersion: 2,
            NSExtensionActivationSupportsFileWithMaxCount: 5,
            NSExtensionActivationSupportsImageWithMaxCount: 5,
            NSExtensionActivationSupportsMovieWithMaxCount: 1,
            NSExtensionActivationSupportsWebURLWithMaxCount: 1,
            NSExtensionActivationSupportsText: true,
          },
        },
      },
    });

    // Expo 单 target 模板没有这两节，node-xcode 不会自动创建，须先准备再加 target 依赖。
    project.hash.project.objects.PBXTargetDependency ??= {};
    project.hash.project.objects.PBXContainerItemProxy ??= {};
    let target = Object.entries(project.pbxNativeTargetSection()).find(([, value]) =>
      typeof value === 'object' && value.name?.replaceAll('"', '') === TARGET);
    if (!target) {
      const created = project.addTarget(TARGET, 'app_extension', TARGET, BUNDLE_ID);
      target = [created.uuid, created.pbxNativeTarget];
      const group = project.addPbxGroup([], TARGET, TARGET);
      project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
      project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', created.uuid);
      project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', created.uuid);
      project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', created.uuid);
      for (const file of fs.readdirSync(destination).filter((file) => file.endsWith('.swift'))) {
        project.addSourceFile(file, { target: created.uuid }, group.uuid);
      }
      const privacy = project.addFile('PrivacyInfo.xcprivacy', group.uuid);
      project.pbxFileReferenceSection()[privacy.fileRef].lastKnownFileType = 'text.xml';
      privacy.uuid = project.generateUuid();
      privacy.target = created.uuid;
      project.addToPbxBuildFileSection(privacy);
      project.addToPbxResourcesBuildPhase(privacy);
      // 一个 variant group 只加入一次 Resources，避免多个语言产生重复输出文件。
      const variant = project.pbxCreateVariantGroup('Localizable.strings');
      project.addToPbxGroup(variant, group.uuid);
      const buildFile = { uuid: project.generateUuid(), fileRef: variant, basename: 'Localizable.strings', group: 'Resources', target: created.uuid };
      project.addToPbxBuildFileSection(buildFile);
      project.addToPbxResourcesBuildPhase(buildFile);
      for (const directory of fs.readdirSync(destination).filter((file) => file.endsWith('.lproj'))) {
        const language = directory.slice(0, -6);
        const file = project.addFile(`${directory}/Localizable.strings`, variant);
        project.pbxFileReferenceSection()[file.fileRef].name = language;
        project.addKnownRegion(language);
      }
    }

    const [targetId, nativeTarget] = target;
    // 资产目录在新建和已有 target 上都登记，不依赖主工程存在 Resources 分组。
    const extensionGroup = project.findPBXGroupKey({ name: TARGET, path: TARGET });
    const resources = project.pbxResourcesBuildPhaseObj(targetId);
    for (const directory of fs.readdirSync(destination).filter((file) => file.endsWith('.xcassets'))) {
      const added = project.addFile(directory, extensionGroup);
      const fileRef = added?.fileRef ?? project.getPBXGroupByKey(extensionGroup).children.find(({ value }) =>
        project.pbxFileReferenceSection()[value]?.path?.replaceAll('"', '') === directory)?.value;
      if (!fileRef) throw new Error(`无法登记分享扩展资源：${directory}`);
      // 用文件引用检查构建阶段，重复同步和重新读取工程后也不重复添加。
      if (resources.files.some(({ value }) => project.pbxBuildFileSection()[value]?.fileRef === fileRef)) continue;
      const buildFile = { uuid: project.generateUuid(), fileRef, basename: directory, group: 'Resources', target: targetId };
      project.addToPbxBuildFileSection(buildFile);
      project.addToPbxResourcesBuildPhase(buildFile);
    }
    const configurationList = project.pbxXCConfigurationList()[nativeTarget.buildConfigurationList];
    const configurations = project.pbxXCBuildConfigurationSection();
    const mainTarget = project.getFirstTarget();
    if (!mainTarget.firstTarget.dependencies.some((reference) =>
      project.hash.project.objects.PBXTargetDependency[reference.value]?.target === targetId)) {
      project.addTargetDependency(mainTarget.uuid, [targetId]);
    }
    const mainList = project.pbxXCConfigurationList()[mainTarget.firstTarget.buildConfigurationList];
    for (const reference of configurationList.buildConfigurations) {
      const configuration = configurations[reference.value];
      const mainReference = mainList.buildConfigurations.find((item) => configurations[item.value].name === configuration.name);
      const mainSettings = configurations[mainReference?.value ?? mainList.buildConfigurations[0].value].buildSettings;
      Object.assign(configuration.buildSettings, {
        PRODUCT_BUNDLE_IDENTIFIER: BUNDLE_ID,
        PRODUCT_NAME: '"$(TARGET_NAME)"',
        PRODUCT_MODULE_NAME: TARGET,
        INFOPLIST_FILE: `${TARGET}/Info.plist`,
        CODE_SIGN_ENTITLEMENTS: `${TARGET}/${TARGET}.entitlements`,
        CODE_SIGN_STYLE: 'Automatic',
        CURRENT_PROJECT_VERSION: config.ios?.buildNumber ?? '1',
        MARKETING_VERSION: config.version ?? '1.0.0',
        IPHONEOS_DEPLOYMENT_TARGET: mainSettings.IPHONEOS_DEPLOYMENT_TARGET ?? '16.4',
        TARGETED_DEVICE_FAMILY: '"1,2"',
        SWIFT_VERSION: '5.0',
        CLANG_ENABLE_MODULES: 'YES',
        APPLICATION_EXTENSION_API_ONLY: 'YES',
        SKIP_INSTALL: 'YES',
        GENERATE_INFOPLIST_FILE: 'NO',
        SWIFT_EMIT_LOC_STRINGS: 'NO',
      });
      const team = config.ios?.appleTeamId ?? mainSettings.DEVELOPMENT_TEAM;
      if (team) configuration.buildSettings.DEVELOPMENT_TEAM = team;
    }
    const attributes = project.getFirstProject().firstProject.attributes;
    for (const uuid of [targetId, mainTarget.uuid]) {
      const existing = attributes.TargetAttributes?.[uuid]?.SystemCapabilities ?? {};
      project.addTargetAttribute('SystemCapabilities', { ...existing, 'com.apple.ApplicationGroups.iOS': { enabled: 1 } }, { uuid });
    }
    for (const buildFile of Object.values(project.pbxBuildFileSection())) {
      if (buildFile && typeof buildFile === 'object' && buildFile.fileRef === nativeTarget.productReference) {
        buildFile.settings = { ATTRIBUTES: ['CodeSignOnCopy', 'RemoveHeadersOnCopy'] };
      }
    }
    // node-xcode 的新增文件对象包含 undefined 字段，写入前清除，保持合法的 Xcode 属性类型。
    for (const reference of Object.values(project.pbxFileReferenceSection())) {
      if (reference && typeof reference === 'object') {
        for (const key of Object.keys(reference)) if (reference[key] === undefined) delete reference[key];
      }
    }
    return mod;
  });
}

module.exports = createRunOncePlugin(withShare, 'with-share', '1.0.0');
