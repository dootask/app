export interface MeetingAlert {
  title: string;
  message: string;
  cancel: string;
  confirm: string;
}

export interface MeetingParams {
  name: string;
  token: string;
  channel: string;
  uuid: number;
  appid: string;
  avatar: string;
  username: string;
  video: boolean;
  audio: boolean;
  meetingid: string;
  sharelink: string;
  alert: Partial<MeetingAlert>;
}

export function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

/** Agora 的 uid 是 uint32；0 表示让 SDK 分配，不能按有符号 int 截断。 */
export function parseUid(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
  const uid = Number(value);
  return Number.isInteger(uid) && uid >= 0 && uid <= 0xffffffff ? uid : null;
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function parseMeetingParams(value: unknown): MeetingParams {
  const data = objectValue(value);
  const uuid = parseUid(data.uuid);
  const appid = stringValue(data.appid);
  const channel = stringValue(data.channel);
  if (uuid === null || !appid.trim() || !channel.trim()) throw new Error('会议参数缺少有效的 appid、channel 或 uuid');
  const alert: Partial<MeetingAlert> = {};
  const source = objectValue(data.alert);
  for (const key of ['title', 'message', 'cancel', 'confirm'] as const) {
    if (typeof source[key] === 'string' && source[key]) alert[key] = source[key];
  }
  return {
    name: stringValue(data.name), token: stringValue(data.token), channel, uuid, appid,
    avatar: stringValue(data.avatar), username: stringValue(data.username),
    video: flag(data.video), audio: flag(data.audio),
    meetingid: stringValue(data.meetingid), sharelink: stringValue(data.sharelink), alert,
  };
}

export function sameMeeting(a: MeetingParams, b: MeetingParams): boolean {
  return a.appid === b.appid && a.channel === b.channel && a.uuid === b.uuid && a.meetingid === b.meetingid;
}

export function meetingLanguage(appMessage: unknown, cached: string, fallback: string): string {
  const current = objectValue(appMessage).language;
  if (typeof current === 'string' && current) return current;
  let language: unknown = cached;
  // 分享模块沿用 eeui 缓存的 JSON 字符串包装，也兼容早期直接保存的语言代码。
  try { language = JSON.parse(cached); } catch { /* 裸语言代码。 */ }
  return typeof language === 'string' && language ? language : fallback;
}
