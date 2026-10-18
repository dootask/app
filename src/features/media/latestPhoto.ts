import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import { AssetField, MediaType, Query, getPermissionsAsync, requestPermissionsAsync } from 'expo-media-library';
import { Platform } from 'react-native';

import { getLegacyStoreModule } from '../../../modules/legacy-store';
import type { PageHandle } from '../../bridge/pages';
import { filePath, photoCreated, thumbnailPlan } from './params';

async function latestAsset() {
  if (Platform.OS === 'android') {
    // 旧 Android 按加入相册时间选择照片，created 已是 DATE_ADDED 秒值。
    const asset = await getLegacyStoreModule().getLatestPhoto();
    if (!asset) throw new Error('未找到照片');
    return asset;
  }
  const [asset] = await new Query().eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
    .orderBy({ key: AssetField.CREATION_TIME, ascending: false }).limit(1).exe();
  if (!asset) throw new Error('相册中没有照片');
  const [uri, name, created, shape] = await Promise.all([
    asset.getUri(), asset.getFilename(), asset.getCreationTime(), asset.getShape(),
  ]);
  return { uri, name, created: photoCreated(created, Platform.OS), width: shape?.width ?? 0, height: shape?.height ?? 0 };
}

async function jpegOriginal(uri: string) {
  const context = ImageManipulator.manipulate(uri);
  let image: ImageRef | undefined;
  try {
    image = await context.renderAsync();
    return await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.95 });
  } finally {
    image?.release();
    context.release();
  }
}

async function makeThumbnail(uri: string) {
  // 缩略图解码时先限尺寸，避免为长图及高像素照片在内存中保留完整位图。
  const source = ImageManipulator.manipulate(uri, { maxWidth: 1500, maxHeight: 1500 });
  let image: ImageRef | undefined;
  let context: ReturnType<typeof ImageManipulator.manipulate> | undefined;
  let thumbnail: ImageRef | undefined;
  try {
    image = await source.renderAsync();
    const { crop, size } = thumbnailPlan(image.width, image.height);
    context = ImageManipulator.manipulate(image);
    if (crop.width < image.width || crop.height < image.height) context.crop(crop);
    context.resize(size);
    thumbnail = await context.renderAsync();
    return await thumbnail.saveAsync({ format: SaveFormat.JPEG, compress: Platform.OS === 'ios' ? 0.7 : 0.9, base64: true });
  } finally {
    thumbnail?.release();
    context?.release();
    image?.release();
    source.release();
  }
}

export async function getLatestPhoto(page: PageHandle, callbackRef: unknown) {
  const temporary: File[] = [];
  const permissionError = Platform.OS === 'ios' ? '没有相册访问权限' : '没有存储访问权限';
  try {
    let permission = await getPermissionsAsync(false, ['photo']);
    if (!permission.granted && permission.canAskAgain) permission = await requestPermissionsAsync(false, ['photo']);
    if (!permission.granted) throw new Error(permissionError);

    const { uri, name, created, width, height } = await latestAsset();
    let original: { uri: string; width: number; height: number };
    if (Platform.OS === 'ios') {
      // 旧 iOS 先按显示方向导出质量 0.95 的 JPEG，而非返回 ph:// 或 HEIC。
      original = await jpegOriginal(uri);
      temporary.push(new File(original.uri));
    } else {
      // 复制 content:// 到沙盒，确保 scoped storage 下返回的裸路径可再次上传。
      const destination = new File(Paths.cache, `eeui-original-${Date.now()}-${Math.random().toString(36).slice(2)}-${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
      temporary.push(destination);
      await new File(uri).copy(destination);
      original = { uri: destination.uri, width, height };
    }
    const thumbnail = await makeThumbnail(original.uri);
    temporary.push(new File(thumbnail.uri));
    if (!thumbnail.base64) throw new Error('生成缩略图失败');
    if (!(original.width > 0 && original.height > 0)) {
      // 某些 Android 媒体库未记录尺寸，按实际解码结果补齐。
      const context = ImageManipulator.manipulate(original.uri);
      let decoded: ImageRef | undefined;
      try {
        decoded = await context.renderAsync();
        original.width = decoded.width;
        original.height = decoded.height;
      } finally {
        decoded?.release();
        context.release();
      }
    }
    page.callback(callbackRef, {
      status: 'success', created,
      thumbnail: {
        path: filePath(thumbnail.uri), base64: `data:image/jpeg;base64,${thumbnail.base64}`,
        width: thumbnail.width, height: thumbnail.height, size: new File(thumbnail.uri).size, name,
      },
      original: {
        path: filePath(original.uri), width: original.width, height: original.height,
        size: new File(original.uri).size, name,
      },
    });
  } catch (error) {
    for (const file of temporary) {
      try { if (file.exists) file.delete(); } catch { /* 清理失败不影响错误回调。 */ }
    }
    page.callback(callbackRef, { status: 'error', error: error instanceof Error ? error.message : String(error) });
  }
}
