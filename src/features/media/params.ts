export function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function fileUri(path: string): string {
  return path.startsWith('/')
    ? `file://${encodeURI(path).replace(/[?#]/g, encodeURIComponent)}` : path;
}

/** eeui 的 path 是文件系统路径，供后续 uploadPhoto 原样传回。 */
export function filePath(uri: string): string {
  return uri.startsWith('file://') ? decodeURIComponent(new URL(uri).pathname) : uri;
}

function stringFields(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
}

export function parseUploadParams(value: unknown) {
  const data = asObject(value);
  if (!data) throw new Error('参数格式错误');
  if (typeof data.url !== 'string' || !data.url || typeof data.path !== 'string' || !data.path) {
    throw new Error('必须包含url和path参数');
  }
  const url = new URL(data.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('上传地址无效');
  const uri = fileUri(data.path);
  if (!/^(file|content):\/\//i.test(uri)) throw new Error('文件路径无效');
  return {
    url: data.url,
    uri,
    fieldName: typeof data.fieldName === 'string' && data.fieldName ? data.fieldName : 'file',
    parameters: stringFields(data.data),
    headers: stringFields(data.headers),
  };
}

export function parseScannerOptions(value: unknown) {
  const options = asObject(value);
  const continuous = options?.continuous;
  return {
    title: String(options?.title ?? ''),
    desc: String(options?.desc ?? (typeof value === 'string' && !options ? value : '')),
    continuous: continuous === true || continuous === 1 || continuous === 'true' || continuous === '1',
  };
}

export type ScannerOptions = ReturnType<typeof parseScannerOptions>;

/** SDK 58 类型注释写秒，当前双端原生实现实际返回毫秒；同时兼容后续修正。 */
export function photoCreated(value: number | null, platform: string): number {
  if (value === null || !Number.isFinite(value) || value <= 0) return 0;
  const seconds = value >= 100_000_000_000 ? value / 1000 : value;
  return platform === 'android' ? Math.floor(seconds) : seconds;
}

export function parsePictures(payload: Record<string, unknown>, platform: string) {
  let paths = payload.paths;
  if (typeof paths === 'string') {
    try { paths = JSON.parse(paths); } catch { paths = [paths]; }
  }
  if (!Array.isArray(paths)) return { paths: [], position: 0, language: String(payload.language ?? '') };
  const uris = paths.flatMap((item: unknown) => {
    const path = typeof item === 'string' ? item : asObject(item)?.path;
    if (typeof path !== 'string' || !path) return [];
    // 旧 iOS 图片浏览器会把微博缩略图切换为大图。
    return [fileUri(platform === 'ios' ? path.replace(/bmiddle/g, 'large') : path)];
  });
  const position = Number(payload.position);
  return {
    paths: uris,
    position: Math.max(0, Math.min(uris.length - 1, Number.isFinite(position) ? Math.trunc(position) : 0)),
    language: String(payload.language ?? ''),
  };
}

/** 与旧壳一致：最短边 300，极端长图居中裁成至多 5:1。 */
export function thumbnailPlan(width: number, height: number) {
  if (!(width > 0 && height > 0)) throw new Error('图片尺寸无效');
  const cropWidth = Math.min(width, height * 5);
  const cropHeight = Math.min(height, width * 5);
  const ratio = cropWidth / cropHeight;
  return {
    crop: { originX: (width - cropWidth) / 2, originY: (height - cropHeight) / 2, width: cropWidth, height: cropHeight },
    size: { width: ratio >= 1 ? Math.floor(300 * ratio) : 300, height: ratio >= 1 ? 300 : Math.floor(300 / ratio) },
  };
}
