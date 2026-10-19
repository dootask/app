import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import { DooPush, type DooPushMessage } from 'doopush-react-native-sdk';
// 只导入事件模块，避开包入口的 DevicePushTokenAutoRegistration.fx 副作用。
import {
  addNotificationResponseReceivedListener,
  clearLastNotificationResponse,
  getLastNotificationResponse,
} from 'expo-notifications/build/NotificationsEmitter';
import type { NotificationResponse } from 'expo-notifications/build/Notifications.types';

import { registerMessage } from '../../bridge/dispatcher';
import type { PageHandle } from '../../bridge/pages';
import { bridgeStore } from '../../bridge/store';
import { APP_VERSION_CODE, APP_VERSION_NAME, DOOPUSH_APP_ID, DOOPUSH_APP_KEY } from '../../config';
import { isPageReady } from '../../native/deepLink';

/**
 * 推送（二期 DooPush，替换旧壳友盟）
 *
 * 前端仍发 setUmengAlias / delUmengAlias：登录后注册 DooPush 设备并上报到 DooTask 服务器（api/push/device），
 * 退出登录时删除；服务器按设备 ID 通过 DooPush 推送。点击通知回调网页 __onNotificationClick 打开会话。
 */

interface AppMessage {
  apiUrl?: string;
  userid?: number | string;
  token?: string;
  language?: string;
  userAgent?: string;
}

let configured = false;
function ensureConfigured() {
  if (configured) return;
  DooPush.configure({ appId: DOOPUSH_APP_ID, appKey: DOOPUSH_APP_KEY });
  configured = true;
}

function appMessage(): AppMessage {
  const value = bridgeStore.getVariate<AppMessage>('appMessage');
  return value && typeof value === 'object' ? value : {};
}

async function report(message: AppMessage, data: Record<string, string>) {
  if (!message.apiUrl || !message.token) return;
  const url = `${message.apiUrl.replace(/\/?$/, '/')}push/device`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      token: message.token,
      language: message.language ?? '',
      platform: Platform.OS,
    },
    body: new URLSearchParams(data).toString(),
  });
  const json = await res.json().catch(() => null);
  if (json?.ret !== 1) console.warn('[push] 上报设备失败', data.action, json?.msg ?? res.status);
}

async function updateDevice() {
  const message = appMessage();
  if (!message.apiUrl || !message.token || !(Number(message.userid) > 0)) return;
  ensureConfigured();
  const { deviceId, vendor } = await DooPush.register();
  if (!deviceId) return;
  const permission = await DooPush.checkPermissionStatus().catch(() => 'unknown');
  await report(message, {
    action: 'update',
    device_id: String(deviceId),
    vendor: String(vendor ?? ''),
    unique_id: bridgeStore.getCachesString('appUniqueId'),
    // 对齐旧壳 WXEnvironment.deviceModel：iOS 为机型标识（如 iPhone14,2），Android 为 Build.MODEL
    device_model: (Platform.OS === 'ios' ? Device.modelId : Device.modelName) ?? '',
    app_version: String(APP_VERSION_CODE),
    app_version_name: APP_VERSION_NAME,
    user_agent: message.userAgent ?? '',
    is_notified: permission === 'authorized' || permission === 'provisional' ? '1' : '0',
  });
}

async function removeDevice() {
  const message = appMessage();
  ensureConfigured();
  const deviceId = await DooPush.getDeviceId().catch(() => null);
  if (!deviceId) return;
  await report(message, { action: 'remove', device_id: String(deviceId) });
}

// 登录/退出可能连续触发，按顺序执行
let queue: Promise<void> = Promise.resolve();
function enqueue(task: () => Promise<void>, label: string) {
  queue = queue.then(task).catch((error) => console.warn(`[push] ${label}失败`, error));
}

registerMessage('setUmengAlias', () => enqueue(updateDevice, '注册推送'));
registerMessage('delUmengAlias', () => enqueue(removeDevice, '删除推送'));

// ── 点击通知 ────────────────────────────────────────────────────────────

interface ClickData {
  dialog_id: string;
  msg_id: string;
}

function pickClickData(data: unknown): ClickData | null {
  if (!data || typeof data !== 'object') return null;
  let record = data as Record<string, unknown>;
  // DooPush 只透传 data 字段：业务字段以 JSON 字符串放在 data 中
  if (record.dialog_id === undefined && typeof record.data === 'string') {
    try {
      const parsed: unknown = JSON.parse(record.data);
      if (parsed && typeof parsed === 'object') record = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  const dialogId = String(record.dialog_id ?? '');
  if (!/^\d+$/.test(dialogId) || dialogId === '0') return null;
  return { dialog_id: dialogId, msg_id: String(record.msg_id ?? '') };
}

/**
 * 主页面挂载：iOS 通过 expo-notifications 的通知响应拿到点击（含冷启动），
 * 其他通道走 DooPush 的点击事件；页面就绪后回调网页。
 */
export function usePushClickHandler(getPage: () => PageHandle | null): void {
  const getPageRef = useRef(getPage);
  useEffect(() => { getPageRef.current = getPage; }, [getPage]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: ClickData | null = null;
    const handled = new Set<string>();

    const pump = () => {
      if (disposed || !pending) return;
      if (timer) clearTimeout(timer);
      const page = getPageRef.current();
      if (page && isPageReady(page)) {
        page.invokeWindow('__onNotificationClick', pending);
        pending = null;
        return;
      }
      timer = setTimeout(pump, 250);
    };
    const receive = (data: unknown) => {
      const click = pickClickData(data);
      if (!click) return;
      // 同一条通知可能同时从 expo-notifications 和 DooPush 两路到达
      const key = `${click.dialog_id}:${click.msg_id}`;
      if (handled.has(key)) return;
      handled.add(key);
      pending = click;
      pump();
    };
    const fromResponse = (response: NotificationResponse | null) => {
      if (!response) return;
      // iOS 远程推送的 content.data 只取 Expo 格式的 body，DooPush 载荷在 trigger.payload（完整 userInfo）
      const trigger = response.notification.request.trigger as { payload?: unknown } | null;
      receive(trigger?.payload ?? response.notification.request.content.data);
      clearLastNotificationResponse();
    };
    const fromDooPush = (message: DooPushMessage) => receive(message.data);

    ensureConfigured();
    const subscriptions = [
      addNotificationResponseReceivedListener(fromResponse),
      DooPush.addNotificationClickListener(fromDooPush),
      DooPush.addNotificationOpenListener(fromDooPush),
    ];
    fromResponse(getLastNotificationResponse());
    return () => {
      disposed = true;
      subscriptions.forEach((sub) => sub.remove());
      if (timer) clearTimeout(timer);
    };
  }, []);
}
