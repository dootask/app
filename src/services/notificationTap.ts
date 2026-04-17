import * as Notifications from 'expo-notifications';
import { broadcastScript } from '../bridge/webViewRegistry';

export type NotificationPath = string;

function extractPath(data: unknown): NotificationPath | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const candidates = [
    record.path,
    record.url,
    record.link,
    record.route,
    (record.extras as Record<string, unknown> | undefined)?.path,
    (record.extras as Record<string, unknown> | undefined)?.url,
  ];
  for (const v of candidates) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/** Mounts an expo-notifications response listener that forwards the notification's path
 * into every active WebView via `window.__handleLink(path)`. Vue's App.vue already listens
 * for this callback (see docs/migration section 17.8). */
export function installNotificationTapListener(): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;
    const path = extractPath(data);
    if (!path) return;
    const pathJson = JSON.stringify(path);
    broadcastScript(`
      typeof window.__handleLink === 'function' && window.__handleLink(${pathJson});
      true;
    `);
  });

  // If the app was launched from a notification tap, replay it after mount.
  Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      const data = response?.notification?.request?.content?.data;
      const path = data ? extractPath(data) : null;
      if (!path) return;
      const pathJson = JSON.stringify(path);
      // Give the main WebView a moment to boot before firing; Vue registers __handleLink
      // during app initialisation.
      setTimeout(() => {
        broadcastScript(`
          typeof window.__handleLink === 'function' && window.__handleLink(${pathJson});
          true;
        `);
      }, 1500);
    })
    .catch(() => {});

  return () => sub.remove();
}
