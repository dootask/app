import { getPage, type PageHandle } from '../../bridge/pages';
import type { ScannerOptions } from './params';

interface RequestLifetime { users: number }

export interface ScannerRequest extends RequestLifetime {
  kind: 'scanner';
  options: ScannerOptions;
  callbackRef: unknown;
  created: boolean;
  finished: boolean;
  scanned: boolean;
  lastResultAt: number;
}

export interface PictureRequest extends RequestLifetime {
  kind: 'pictures';
  paths: string[];
  position: number;
  language: string;
}

export interface VideoRequest extends RequestLifetime {
  kind: 'video';
  path: string;
  language: string;
}

export type MediaRequest = ScannerRequest | PictureRequest | VideoRequest;

function requests(page: PageHandle): Map<string, MediaRequest> {
  let map = page.state.get('media.requests') as Map<string, MediaRequest> | undefined;
  if (!map) {
    map = new Map();
    page.state.set('media.requests', map);
  }
  return map;
}

export function addRequest(page: PageHandle, request: MediaRequest): string {
  const id = Number(page.state.get('media.nextRequest') ?? 0) + 1;
  page.state.set('media.nextRequest', id);
  requests(page).set(String(id), request);
  return String(id);
}

export function findRequest(pageName: unknown, id: unknown) {
  const page = typeof pageName === 'string' ? getPage(pageName) : undefined;
  if (!page || typeof id !== 'string') return null;
  const request = requests(page).get(id);
  return request ? { page, request, id } : null;
}

export type MediaHandle = NonNullable<ReturnType<typeof findRequest>>;

export function createScanner(page: PageHandle, request: ScannerRequest) {
  if (request.created || request.finished) return;
  request.created = true;
  page.callback(request.callbackRef, { pageName: 'scanPage', status: 'create' }, true);
}

const formats: Record<string, [string, string]> = {
  qr: ['QR_CODE', 'QRCode'], aztec: ['AZTEC', 'Aztec'], pdf417: ['PDF_417', 'PDF417'],
  ean13: ['EAN_13', 'EAN-13'], ean8: ['EAN_8', 'EAN-8'], upc_e: ['UPC_E', 'UPCE'],
  upc_a: ['UPC_A', 'EAN-13'], datamatrix: ['DATA_MATRIX', 'DataMatrix'],
  code39: ['CODE_39', 'Code39'], code93: ['CODE_93', 'Code93'], code128: ['CODE_128', 'Code128'],
  itf14: ['ITF', 'ITF14'], codabar: ['CODABAR', 'Codabar'],
};

export function scannerResult(
  page: PageHandle, request: ScannerRequest, platform: string, text: string, type: string,
  source: 'camera' | 'photo' = 'camera', now = Date.now(),
): boolean {
  if (request.finished || !request.created || request.scanned || !text || now - request.lastResultAt < 300) return false;
  request.lastResultAt = now;
  request.scanned = !request.options.continuous;
  const format = formats[type]?.[platform === 'ios' ? 1 : 0] ?? type;
  page.callback(request.callbackRef, {
    ...(platform === 'ios' ? { pageName: 'scanPage' } : {}),
    status: 'success', text, format, source,
    result: platform === 'ios' ? { text, format } : { text, barcodeFormat: format, numBits: 0, timestamp: now },
  }, true);
  return !request.options.continuous;
}

export function scannerLight(page: PageHandle, request: ScannerRequest, enabled: boolean) {
  if (!request.created || request.finished) return;
  page.callback(request.callbackRef, { pageName: 'scanPage', status: enabled ? 'openLight' : 'offLight' }, true);
}

export function removeRequest({ page, request, id }: MediaHandle) {
  if (request.kind === 'scanner' && !request.finished) {
    request.finished = true;
    if (request.created) page.callback(request.callbackRef, { pageName: 'scanPage', status: 'destroy' }, true);
    page.release(request.callbackRef);
  }
  requests(page).delete(id);
}

/** 延后一轮清理，以兼容开发模式重复执行 effect，避免提前释放调用方回调。 */
export function retainRequest(handle: MediaHandle) {
  handle.request.users++;
  return () => {
    handle.request.users--;
    queueMicrotask(() => { if (handle.request.users === 0) removeRequest(handle); });
  };
}
