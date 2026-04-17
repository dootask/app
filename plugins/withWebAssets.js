const {
  withDangerousMod,
  withXcodeProject,
} = require('@expo/config-plugins');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const PbxFile = require('xcode/lib/pbxFile');

// Deterministic 24-char uppercase hex, so prebuild regenerations don't churn the pbxproj.
function stableUuid(seed) {
  return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 24).toUpperCase();
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

const withAndroidWebAssets = (config) =>
  withDangerousMod(config, [
    'android',
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const src = path.join(projectRoot, 'assets', 'web');
      const dest = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'assets',
        'web',
      );
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
      copyDir(src, dest);
      return cfg;
    },
  ]);

const withIosWebAssets = (config) => {
  // Step 1: copy assets/web → ios/<ProjectName>/web (inside target source folder so that a
  // folder reference path like "DooTask/web" resolves correctly).
  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const projectName = cfg.modRequest.projectName;
      const src = path.join(projectRoot, 'assets', 'web');
      const dest = path.join(
        cfg.modRequest.platformProjectRoot,
        projectName,
        'web',
      );
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
      copyDir(src, dest);
      return cfg;
    },
  ]);

  // Step 2: register "<ProjectName>/web" as a blue folder reference in the Xcode project and
  // add it to Copy Bundle Resources, so react-native-static-server can serve it from the bundle.
  config = withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const projectName = cfg.modRequest.projectName;
    const relPath = `${projectName}/web`;

    // Avoid duplicate registration on repeated prebuilds.
    const fileRefs = project.pbxFileReferenceSection();
    for (const key of Object.keys(fileRefs)) {
      const ref = fileRefs[key];
      if (
        ref &&
        typeof ref === 'object' &&
        (ref.path === `"${relPath}"` || ref.path === relPath) &&
        ref.lastKnownFileType === 'folder'
      ) {
        return cfg;
      }
    }

    // `addResourceFile` calls correctForResourcesPath which requires a "Resources" group —
    // Expo's template doesn't create one, so we wire the folder reference ourselves.
    const file = new PbxFile(relPath, { lastKnownFileType: 'folder' });
    file.uuid = stableUuid(`withWebAssets:buildFile:${relPath}`);
    file.fileRef = stableUuid(`withWebAssets:fileRef:${relPath}`);
    file.target = project.getFirstTarget().uuid;

    project.addToPbxFileReferenceSection(file);
    project.addToPbxBuildFileSection(file);
    project.addToPbxResourcesBuildPhase(file);
    project.addToPbxGroup(file, project.getFirstProject().firstProject.mainGroup);

    return cfg;
  });

  return config;
};

const withWebAssets = (config) => {
  config = withAndroidWebAssets(config);
  config = withIosWebAssets(config);
  return config;
};

module.exports = withWebAssets;
