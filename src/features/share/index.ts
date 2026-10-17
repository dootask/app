import { Platform } from 'react-native';

import { getShareModule, type ShareKey } from '../../../modules/share';
import { registerMessage } from '../../bridge/dispatcher';
import { bridgeStore } from '../../bridge/store';

function persist(settings: Partial<Record<ShareKey, string>>): void {
  // bridgeStore 仍是 JS 缓存的唯一数据源；原生存储只是供独立分享进程读取的镜像。
  for (const [key, value] of Object.entries(settings)) {
    bridgeStore.setCachesString(key, JSON.stringify(value), 0);
  }
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    getShareModule().writeSettings(settings);
  }
}

registerMessage('userChatList', (_page, payload) => {
  const settings: Partial<Record<ShareKey, string>> = { chatList: String(payload.url ?? '') };
  // 旧壳空语言不覆盖当前设置；空 URL 必须覆盖，避免退出登录后继续使用旧 token。
  if (typeof payload.language === 'string' && payload.language) settings.language = payload.language;
  persist(settings);
});

registerMessage('userUploadUrl', (_page, payload) => {
  persist({
    upLoadUrl: String(payload.chatUrl ?? ''),
    fileUpLoadUrl: String(payload.dirUrl ?? ''),
  });
});
