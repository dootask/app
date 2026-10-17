// 只导入本地能力，避开包入口的 DevicePushTokenAutoRegistration.fx 副作用。
import { cancelAllScheduledNotificationsAsync } from 'expo-notifications/build/cancelAllScheduledNotificationsAsync';
import { dismissAllNotificationsAsync } from 'expo-notifications/build/dismissAllNotificationsAsync';
import { getPermissionsAsync, requestPermissionsAsync } from 'expo-notifications/build/NotificationPermissions';
import { IosAuthorizationStatus } from 'expo-notifications/build/NotificationPermissions.types';
import { setBadgeCountAsync } from 'expo-notifications/build/setBadgeCountAsync';
import { Platform } from 'react-native';

import { registerMessage, type MessageHandler } from '../../bridge/dispatcher';

registerMessage('getNotificationPermission', async (page) => {
  let enabled = false;
  try {
    const permissions = await getPermissionsAsync();
    // 旧壳回传 boolean；iOS 只把完整授权视为已允许，不把临时授权当作完整授权。
    enabled = Platform.OS === 'ios'
      ? permissions.ios?.status === IosAuthorizationStatus.AUTHORIZED
      : permissions.status === 'granted';
  } catch (error) {
    console.warn('[bridge/notifications] 查询通知权限失败', error);
  }
  page.invokeWindow('__onNotificationPermissionStatus', enabled);
});

const setBadge: MessageHandler = async (page, payload) => {
  // 沿用旧 parseInt(bdage) || 0，限制到原生 Android Int 可表示的非负范围。
  const badge = Math.min(0x7fffffff, Math.max(0, Number.parseInt(String(payload.bdage)) || 0));
  // 同一页面的角标请求按发送顺序执行，避免授权弹窗期间旧数字覆盖新数字。
  const previous = page.state.get('notifications.badgeTask') as Promise<void> | undefined;
  const task = (previous ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (Platform.OS === 'ios') {
      let permissions = await getPermissionsAsync();
      if (permissions.ios?.status === IosAuthorizationStatus.NOT_DETERMINED) {
        // 旧壳在友盟初始化时申请这三项；一期延迟到首次设置角标，不注册推送 token。
        permissions = await requestPermissionsAsync({
          ios: { allowBadge: true, allowAlert: true, allowSound: true },
        });
      }
      if (!permissions.ios?.allowsBadge) return;
    }
    const applied = await setBadgeCountAsync(badge);
    if (!applied && __DEV__) console.warn('[bridge/notifications] 当前系统或桌面不支持设置角标');
  });
  page.state.set('notifications.badgeTask', task);
  try {
    await task;
  } finally {
    if (page.state.get('notifications.badgeTask') === task) page.state.delete('notifications.badgeTask');
  }
};

registerMessage('setBdageNotify', setBadge);
registerMessage('setBadgeNum', setBadge);

registerMessage('clearAllNotify', async () => {
  // 保留旧 iOS 取消待发送通知的行为，并清理通知中心中的通知。
  await Promise.all([cancelAllScheduledNotificationsAsync(), dismissAllNotificationsAsync()]);
});
