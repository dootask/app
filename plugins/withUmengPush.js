/**
 * UMeng Push Config Plugin
 *
 * Wires up the scaffolding for UMeng push notifications:
 *   - Android: drops `com.dootask.umeng.{UmengPushModule, UmengPushPackage}` into
 *     android/app/src/main/java/com/dootask/umeng/, patches MainApplication to register the
 *     ReactPackage, and writes `UMENG_APPKEY` / `UMENG_MESSAGE_SECRET` meta-data into the
 *     AndroidManifest (only when appKey is provided).
 *   - iOS: drops the Swift+ObjC stubs into ios/<AppName>/UmengPush/ and registers them with
 *     the app target's Compile Sources build phase.
 *
 * The stubs do not call into the UMeng SDK — they just log and resolve null so the project
 * compiles without the proprietary dependency. To go live, add the SDK coords (UMeng Maven
 * repo + pods) and replace the stub bodies in plugins/umeng/.
 *
 * Plugin options:
 *   appKey         (string, optional) — UMeng App Key; injected as UMENG_APPKEY meta-data
 *   messageSecret  (string, optional) — UMeng Message Secret; injected as UMENG_MESSAGE_SECRET
 */
const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
  withXcodeProject,
} = require('@expo/config-plugins');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const PbxFile = require('xcode/lib/pbxFile');

const ANDROID_PACKAGE = 'com.dootask.umeng';
const IOS_GROUP = 'UmengPush';

function stableUuid(seed) {
  return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 24).toUpperCase();
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// ---- Android ---------------------------------------------------------------

const withUmengAndroidSources = (config) =>
  withDangerousMod(config, [
    'android',
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const kotlinSrc = path.join(projectRoot, 'plugins', 'umeng', 'kotlin');
      const javaDest = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        ...ANDROID_PACKAGE.split('.'),
      );
      fs.mkdirSync(javaDest, { recursive: true });
      for (const name of fs.readdirSync(kotlinSrc)) {
        copyFile(path.join(kotlinSrc, name), path.join(javaDest, name));
      }
      return cfg;
    },
  ]);

const withUmengManifest = (config, props) =>
  withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (!application) return cfg;
    application['meta-data'] = application['meta-data'] || [];

    const upsert = (name, value) => {
      if (!value) return;
      const existing = application['meta-data'].find(
        (m) => m.$?.['android:name'] === name,
      );
      if (existing) {
        existing.$['android:value'] = String(value);
      } else {
        application['meta-data'].push({
          $: { 'android:name': name, 'android:value': String(value) },
        });
      }
    };

    upsert('UMENG_APPKEY', props.appKey);
    upsert('UMENG_MESSAGE_SECRET', props.messageSecret);
    upsert('UMENG_CHANNEL', props.channel ?? 'expo');
    return cfg;
  });

const withUmengMainApplication = (config) =>
  withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    const importStmt = `import ${ANDROID_PACKAGE}.UmengPushPackage`;
    if (!src.includes(importStmt)) {
      src = src.replace(
        /(package [^\n]+\n+)/,
        `$1${importStmt}\n`,
      );
    }
    if (!src.includes('UmengPushPackage()')) {
      // Match the apply block, preserve its body, and append our `add(...)` on a fresh line
      // before the closing brace.
      src = src.replace(
        /(PackageList\(this\)\.packages\.apply\s*\{)([\s\S]*?)(\n[ \t]*\})/m,
        (match, open, body, close) => {
          if (body.includes('UmengPushPackage()')) return match;
          const trimmed = body.replace(/\s+$/, '');
          return `${open}${trimmed}\n              add(UmengPushPackage())${close}`;
        },
      );
    }
    cfg.modResults.contents = src;
    return cfg;
  });

// ---- iOS -------------------------------------------------------------------

const withUmengIosSources = (config) => {
  // Step 1: copy Swift + ObjC bridge into ios/<AppName>/UmengPush/
  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const appName = cfg.modRequest.projectName;
      const srcDir = path.join(projectRoot, 'plugins', 'umeng', 'ios');
      const destDir = path.join(
        cfg.modRequest.platformProjectRoot,
        appName,
        IOS_GROUP,
      );
      fs.mkdirSync(destDir, { recursive: true });
      for (const name of fs.readdirSync(srcDir)) {
        copyFile(path.join(srcDir, name), path.join(destDir, name));
      }
      return cfg;
    },
  ]);

  // Step 2: register each file as a source file in the app target so Xcode compiles them.
  config = withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const appName = cfg.modRequest.projectName;
    const mainGroupKey = project.getFirstProject().firstProject.mainGroup;
    const targetUuid = project.getFirstTarget().uuid;

    const addSource = (relPath, fileType) => {
      // Idempotency check.
      const fileRefs = project.pbxFileReferenceSection();
      for (const key of Object.keys(fileRefs)) {
        const ref = fileRefs[key];
        if (
          ref &&
          typeof ref === 'object' &&
          (ref.path === `"${relPath}"` || ref.path === relPath)
        ) {
          return;
        }
      }
      const file = new PbxFile(relPath, { lastKnownFileType: fileType });
      file.uuid = stableUuid(`withUmengPush:build:${relPath}`);
      file.fileRef = stableUuid(`withUmengPush:ref:${relPath}`);
      file.target = targetUuid;
      project.addToPbxFileReferenceSection(file);
      project.addToPbxBuildFileSection(file);
      project.addToPbxSourcesBuildPhase(file);
      project.addToPbxGroup(file, mainGroupKey);
    };

    addSource(`${appName}/${IOS_GROUP}/UmengPushModule.swift`, 'sourcecode.swift');
    addSource(`${appName}/${IOS_GROUP}/UmengPushModule.m`, 'sourcecode.c.objc');
    return cfg;
  });

  return config;
};

// ---- Plugin entry ----------------------------------------------------------

const withUmengPush = (config, rawProps = {}) => {
  const props = {
    appKey: rawProps.appKey ?? '',
    messageSecret: rawProps.messageSecret ?? '',
    channel: rawProps.channel ?? 'expo',
  };

  config = withUmengAndroidSources(config);
  config = withUmengManifest(config, props);
  config = withUmengMainApplication(config);

  config = withUmengIosSources(config);
  return config;
};

module.exports = withUmengPush;
