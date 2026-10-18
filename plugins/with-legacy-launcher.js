const { withAndroidManifest } = require('expo/config-plugins');

// 旧 eeui 的启动入口是 .WelcomeActivity；入口组件名变化会让桌面启动器把用户固定的快捷方式当作失效删除。
// 保留同名 activity-alias 作为唯一 LAUNCHER 入口，指向 MainActivity。
const ALIAS = '.WelcomeActivity';
const LAUNCHER = 'android.intent.category.LAUNCHER';

module.exports = function withLegacyLauncher(config) {
  return withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application[0];
    const main = app.activity.find((a) => a.$['android:name'] === '.MainActivity');
    if (!main) throw new Error('with-legacy-launcher: 未找到 .MainActivity');
    for (const filter of main['intent-filter'] ?? []) {
      if (filter.category) filter.category = filter.category.filter((c) => c.$['android:name'] !== LAUNCHER);
    }
    main['intent-filter'] = (main['intent-filter'] ?? []).filter((f) => f.action?.length || f.category?.length || f.data?.length);
    app['activity-alias'] = (app['activity-alias'] ?? []).filter((a) => a.$['android:name'] !== ALIAS);
    app['activity-alias'].push({
      $: { 'android:name': ALIAS, 'android:targetActivity': '.MainActivity', 'android:exported': 'true' },
      'intent-filter': [{
        action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
        category: [{ $: { 'android:name': LAUNCHER } }],
      }],
    });
    return mod;
  });
};
