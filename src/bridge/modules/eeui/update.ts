import { Platform } from 'react-native';
import * as Application from 'expo-application';
import { getLocales } from 'expo-localization';

import { APP_VERSION_NAME } from '../../../config';

/** 安卓安装包与桌面端同源发布，index.json 由 electron/build.js 发版时生成 */
const ANDROID_RELEASE_BASE = 'https://download.dootask.com/release/';
const REQUEST_TIMEOUT = 10000;

export type UpdateResult =
  | { status: 'update'; version: string; url: string }
  | { status: 'latest'; version: string }
  | { status: 'error' };

type LatestRelease = { version: string; url: string };

/** 按数字段比较版本号，a > b 返回正数 */
export function compareVersion(a: string, b: string) {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** App Store 按地区上架，先查设备所在地区，查不到再用默认地区 */
async function latestIos(): Promise<LatestRelease | null> {
  const bundleId = Application.applicationId ?? 'com.dootask.task';
  const region = getLocales()[0]?.regionCode?.toLowerCase();
  const base = `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}`;
  for (const url of region ? [`${base}&country=${region}`, base] : [base]) {
    const app = (await fetchJson(url))?.results?.[0];
    if (app?.version && app?.trackId) {
      return { version: String(app.version), url: `itms-apps://apps.apple.com/app/id${app.trackId}` };
    }
  }
  return null;
}

async function latestAndroid(): Promise<LatestRelease | null> {
  const data = await fetchJson(`${ANDROID_RELEASE_BASE}index.json`);
  const file = data?.files?.android?.default;
  if (!data?.version || !file) return null;
  return { version: String(data.version), url: ANDROID_RELEASE_BASE + encodeURIComponent(file) };
}

/** 查询商店/官网最新版本；只有高于本机版本才算有更新（TestFlight、自出包不会被误提示） */
export async function checkAppUpdate(): Promise<UpdateResult> {
  try {
    const latest = Platform.OS === 'ios' ? await latestIos() : await latestAndroid();
    if (!latest) return { status: 'error' };
    if (compareVersion(latest.version, APP_VERSION_NAME) > 0) {
      return { status: 'update', version: latest.version, url: latest.url };
    }
    return { status: 'latest', version: APP_VERSION_NAME };
  } catch {
    return { status: 'error' };
  }
}
