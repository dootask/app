import { File, UploadTask, UploadType, type UploadResult } from 'expo-file-system';
import { Platform } from 'react-native';

import { getAllPages, type PageHandle } from '../../bridge/pages';
import { parseUploadParams } from './params';

interface UploadEntry {
  task: UploadTask;
  callbackRef: unknown;
  cancelled: boolean;
  ended: boolean;
  sequence: number;
}

function uploads(page: PageHandle): Map<string, UploadEntry> {
  let map = page.state.get('media.uploads') as Map<string, UploadEntry> | undefined;
  if (!map) {
    map = new Map();
    page.state.set('media.uploads', map);
  }
  return map;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function uploadResponse(result: UploadResult, platform: string) {
  if (platform === 'ios' && (result.status < 200 || result.status >= 300)) {
    return { status: 'error', error: `服务器返回错误状态码: ${result.status}` };
  }
  let data: unknown = result.body;
  if (platform === 'ios') {
    try { data = JSON.parse(result.body); } catch { /* 旧 iOS 非 JSON 响应保留字符串。 */ }
  }
  return { status: 'success', statusCode: result.status, data };
}

function finish(page: PageHandle, entry: UploadEntry, data?: unknown) {
  if (entry.ended) return;
  entry.ended = true;
  if (data !== undefined) page.callback(entry.callbackRef, data, true);
  page.release(entry.callbackRef);
}

export async function uploadPhoto(page: PageHandle, params: unknown, callbackRef: unknown) {
  let parsed: ReturnType<typeof parseUploadParams>;
  let task: UploadTask;
  try {
    parsed = parseUploadParams(params);
    const file = new File(parsed.uri);
    if (!file.exists) throw new Error('文件不存在');
    task = new UploadTask(file, parsed.url, {
      httpMethod: 'POST', uploadType: UploadType.MULTIPART,
      fieldName: parsed.fieldName, parameters: parsed.parameters, headers: parsed.headers,
      mimeType: 'application/octet-stream', sessionType: 'foreground',
    });
  } catch (error) {
    page.callback(callbackRef, { status: 'error', error: errorMessage(error) });
    return;
  }

  const map = uploads(page);
  const sequence = Math.max(0, ...[page, ...getAllPages()].map((owner) => Number(owner.state.get('media.uploadSequence') ?? 0))) + 1;
  page.state.set('media.uploadSequence', sequence);
  const entry: UploadEntry = { task, callbackRef, cancelled: false, ended: false, sequence };
  map.set(parsed.url, entry);
  try {
    // 先登记任务再发送 ready，onReady 立即取消也有效。旧壳 ID 就是原始 URL。
    page.callback(callbackRef, { status: 'ready', id: parsed.url }, true);
    if (entry.cancelled) return;
    const result = await task.uploadAsync();
    if (!entry.cancelled) finish(page, entry, uploadResponse(result, Platform.OS));
  } catch (error) {
    if (!entry.cancelled) finish(page, entry, { status: 'error', error: errorMessage(error) });
  } finally {
    // 同 URL 后发任务不能被先发任务的完成事件移除。
    if (map.get(parsed.url) === entry) map.delete(parsed.url);
    task.release();
  }
}

export function cancelUploadPhoto(page: PageHandle, id: unknown, callbackRef: unknown) {
  if (typeof id !== 'string' || !id) {
    page.callback(callbackRef, { status: 'error', error: '上传ID不能为空' });
    return;
  }
  // 旧任务表跨页面共享；只遍历页面状态，不另建模块级页面状态表。
  const candidates = Array.from(new Set([page, ...getAllPages()]))
    .flatMap((owner) => {
      const entry = uploads(owner).get(id);
      return entry && !entry.cancelled && !entry.ended ? [{ owner, entry }] : [];
    }).sort((a, b) => b.entry.sequence - a.entry.sequence);
  const active = candidates[0];
  if (!active) {
    page.callback(callbackRef, { status: 'error', error: '未找到上传任务或已取消' });
    return;
  }
  const { owner, entry } = active;
  // 原生已完成但 JS 仍在等待微任务时，保留即将到达的真实完成结果。
  if (!['idle', 'active'].includes(entry.task.state)) {
    page.callback(callbackRef, { status: 'error', error: '未找到上传任务或已取消' });
    return;
  }
  try {
    entry.task.cancel();
  } catch (error) {
    page.callback(callbackRef, { status: 'error', error: errorMessage(error) });
    return;
  }
  entry.cancelled = true;
  if (uploads(owner).get(id) === entry) uploads(owner).delete(id);
  page.callback(callbackRef, { status: 'success', id });
  // Android 的 OkHttp 会向原上传回调报 Canceled；iOS 只通知取消回调。
  finish(owner, entry, Platform.OS === 'ios' ? undefined : { status: 'error', error: 'Canceled' });
}
