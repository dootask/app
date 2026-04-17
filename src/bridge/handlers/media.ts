import type { RefObject } from 'react';
import type WebView from 'react-native-webview';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

interface UploadParams {
  url: string;
  path: string;
  fieldName?: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
}

const activeUploads = new Map<string, FileSystem.UploadTask>();

// ----- getLatestPhoto ----------------------------------------------------------

export async function getLatestPhoto(): Promise<unknown> {
  const permission = await MediaLibrary.requestPermissionsAsync();
  if (!permission.granted) {
    return { status: 'error', error: 'no permission' };
  }

  const { assets } = await MediaLibrary.getAssetsAsync({
    first: 1,
    sortBy: [MediaLibrary.SortBy.creationTime],
    mediaType: MediaLibrary.MediaType.photo,
  });
  if (!assets.length) return { status: 'error', error: 'no photo' };

  const asset = assets[0];
  // iOS asset.uri is `ph://...` — ask for the file-system URI so Vue can load it.
  const info = await MediaLibrary.getAssetInfoAsync(asset);
  const localUri = info.localUri ?? asset.uri;

  let thumbnailBase64 = '';
  let thumbnailWidth = asset.width;
  try {
    const thumb = await manipulateAsync(
      localUri,
      [{ resize: { width: 240 } }],
      { compress: 0.7, format: SaveFormat.JPEG, base64: true },
    );
    thumbnailWidth = thumb.width;
    if (thumb.base64) thumbnailBase64 = `data:image/jpeg;base64,${thumb.base64}`;
  } catch (e) {
    // Thumbnail is best-effort; fall back to empty string.
    console.warn('[getLatestPhoto] thumbnail failed:', e);
  }

  return {
    status: 'success',
    error: '',
    created: Math.floor((asset.creationTime ?? Date.now()) / 1000),
    thumbnail: {
      base64: thumbnailBase64,
      width: thumbnailWidth,
    },
    original: {
      path: localUri,
      width: asset.width,
    },
  };
}

// ----- uploadPhoto / cancelUploadPhoto -----------------------------------------

export async function uploadPhoto(
  raw: unknown,
  requestId: string,
  webViewRef: RefObject<WebView | null>,
): Promise<undefined> {
  const params = (raw ?? {}) as UploadParams;
  if (!params.url || !params.path) {
    fireCallback(webViewRef, requestId, {
      status: 'error',
      error: 'uploadPhoto requires {url, path}',
    });
    deleteCallback(webViewRef, requestId);
    return undefined;
  }

  const uploadId = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  fireCallback(webViewRef, requestId, { status: 'ready', id: uploadId });

  try {
    const task = FileSystem.createUploadTask(
      params.url,
      params.path,
      {
        fieldName: params.fieldName ?? 'file',
        httpMethod: 'POST',
        headers: params.headers,
        parameters: params.params,
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      },
      (progress) => {
        fireCallback(webViewRef, requestId, {
          status: 'progress',
          id: uploadId,
          bytesWritten: progress.totalBytesSent,
          totalBytes: progress.totalBytesExpectedToSend,
        });
      },
    );
    activeUploads.set(uploadId, task);

    const result = await task.uploadAsync();
    activeUploads.delete(uploadId);

    if (!result) {
      fireCallback(webViewRef, requestId, {
        status: 'error',
        id: uploadId,
        error: 'upload cancelled',
      });
      deleteCallback(webViewRef, requestId);
      return undefined;
    }

    let data: unknown = result.body;
    try {
      data = JSON.parse(result.body);
    } catch {
      // keep raw body when server returns non-JSON
    }

    fireCallback(webViewRef, requestId, {
      status: 'success',
      error: '',
      id: uploadId,
      data,
      statusCode: result.status,
    });
    deleteCallback(webViewRef, requestId);
  } catch (e) {
    activeUploads.delete(uploadId);
    const message = e instanceof Error ? e.message : String(e);
    fireCallback(webViewRef, requestId, { status: 'error', id: uploadId, error: message });
    deleteCallback(webViewRef, requestId);
  }

  return undefined;
}

export function cancelUploadPhoto(raw: unknown): boolean {
  const id = typeof raw === 'string' ? raw : (raw as { id?: string } | null)?.id;
  if (!id) return false;
  const task = activeUploads.get(id);
  if (!task) return false;
  // `cancelAsync` returns a Promise; we don't need to await it here.
  void task.cancelAsync();
  activeUploads.delete(id);
  return true;
}

// ----- helpers ---------------------------------------------------------------

function fireCallback(
  ref: RefObject<WebView | null>,
  callbackId: string,
  payload: unknown,
): void {
  const idJson = JSON.stringify(callbackId);
  const payloadJson = JSON.stringify(payload);
  ref.current?.injectJavaScript(`
    (function() {
      var cb = window.__bridgeCallbacks__ && window.__bridgeCallbacks__[${idJson}];
      if (typeof cb === 'function') { try { cb(${payloadJson}); } catch (e) {} }
    })();
    true;
  `);
}

function deleteCallback(ref: RefObject<WebView | null>, callbackId: string): void {
  const idJson = JSON.stringify(callbackId);
  ref.current?.injectJavaScript(`
    if (window.__bridgeCallbacks__) delete window.__bridgeCallbacks__[${idJson}];
    true;
  `);
}
