const { withXcodeProject } = require('expo/config-plugins');

const PHASE_NAME = '[Expo Dev Launcher] Strip Local Network Keys for Release';

module.exports = function withReleaseStripOrder(config) {
  return withXcodeProject(config, (mod) => {
    // expo-dev-launcher 的清理脚本未声明输入，Xcode 会在 Info.plist 生成前执行它，
    // 导致 Release 包残留 _expo._tcp。把生成后的 Info.plist 声明为输入，保证执行顺序；
    // 依赖 Info.plist 的脚本须排在最后一个阶段，否则与 Copy Files / Embed 阶段形成依赖环。
    const project = mod.modResults;
    const phases = project.hash.project.objects.PBXShellScriptBuildPhase ?? {};
    const phase = Object.values(phases).find((item) => item?.name === `"${PHASE_NAME}"`);
    const target = project.pbxNativeTargetSection()[project.findTargetKey(mod.modRequest.projectName ?? '')];
    const index = target?.buildPhases?.findIndex((item) => item.comment === PHASE_NAME) ?? -1;
    if (!phase || index < 0) {
      console.warn(`[with-release-strip-order] 未找到构建阶段：${PHASE_NAME}`);
      return mod;
    }
    phase.inputPaths = ['"$(TARGET_BUILD_DIR)/$(INFOPLIST_PATH)"'];
    target.buildPhases.push(...target.buildPhases.splice(index, 1));
    return mod;
  });
};
