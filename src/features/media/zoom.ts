export interface Size { width: number; height: number }
export interface Point { x: number; y: number }
export interface Zoom { scale: number; x: number; y: number }

export const MAX_SCALE = 5;
export const DOUBLE_TAP_SCALE = 2.5;
/** 下拉超过该距离松手即关闭。 */
export const DISMISS_DISTANCE = 120;
/** 下拉到该距离时背景完全透明、图片缩到最小。 */
const DISMISS_FADE_DISTANCE = 240;
const DISMISS_VELOCITY = 800;
const DISMISS_MIN_SCALE = 0.6;

// 以下函数会在手势 worklet（UI 线程）中调用，需带 'worklet' 标记。

export function containSize(image: Size, viewport: Size): Size {
  'worklet';
  if (!(image.width > 0 && image.height > 0)) return viewport;
  const scale = Math.min(viewport.width / image.width, viewport.height / image.height);
  return { width: image.width * scale, height: image.height * scale };
}

export function constrainZoom(zoom: Zoom, image: Size, viewport: Size): Zoom {
  'worklet';
  const scale = Math.max(1, Math.min(MAX_SCALE, zoom.scale));
  const maxX = Math.max(0, (image.width * scale - viewport.width) / 2);
  const maxY = Math.max(0, (image.height * scale - viewport.height) / 2);
  return { scale, x: Math.max(-maxX, Math.min(maxX, zoom.x)), y: Math.max(-maxY, Math.min(maxY, zoom.y)) };
}

/** 缩放围绕双指中点进行，坐标相对视口中心；手指数量变化时由调用方重新记录起点。 */
export function pinchZoom(start: Zoom, from: Point, to: Point, ratio: number): Zoom {
  'worklet';
  const scale = Math.max(1, Math.min(MAX_SCALE, start.scale * ratio));
  return {
    scale,
    x: to.x - (from.x - start.x) * scale / start.scale,
    y: to.y - (from.y - start.y) * scale / start.scale,
  };
}

/** 双击：已放大则还原，否则以点击位置（相对视口中心）为中心放大。 */
export function doubleTapZoom(current: Zoom, point: Point, image: Size, viewport: Size): Zoom {
  'worklet';
  if (current.scale > 1.01) return { scale: 1, x: 0, y: 0 };
  const start = { scale: 1, x: 0, y: 0 };
  return constrainZoom(pinchZoom(start, point, point, DOUBLE_TAP_SCALE), image, viewport);
}

/** 下拉进度 0–1：驱动背景透明度与图片缩小，只有向下拖动才计入。 */
export function dismissProgress(translationY: number): number {
  'worklet';
  return Math.max(0, Math.min(1, translationY / DISMISS_FADE_DISTANCE));
}

export function dismissScale(progress: number): number {
  'worklet';
  return 1 - (1 - DISMISS_MIN_SCALE) * progress;
}

/** 松手判定：向下超过阈值，或明显向下快速轻甩。 */
export function shouldDismiss(translationY: number, velocityY: number): boolean {
  'worklet';
  if (velocityY < 0) return false;
  return translationY >= DISMISS_DISTANCE || (translationY >= 24 && velocityY >= DISMISS_VELOCITY);
}
