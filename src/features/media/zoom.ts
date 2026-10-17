export interface Size { width: number; height: number }
export interface Point { x: number; y: number }
export interface Zoom { scale: number; x: number; y: number }

export function containSize(image: Size, viewport: Size): Size {
  if (!(image.width > 0 && image.height > 0)) return viewport;
  const scale = Math.min(viewport.width / image.width, viewport.height / image.height);
  return { width: image.width * scale, height: image.height * scale };
}

export function constrainZoom(zoom: Zoom, image: Size, viewport: Size): Zoom {
  const scale = Math.max(1, Math.min(6, zoom.scale));
  const maxX = Math.max(0, (image.width * scale - viewport.width) / 2);
  const maxY = Math.max(0, (image.height * scale - viewport.height) / 2);
  return { scale, x: Math.max(-maxX, Math.min(maxX, zoom.x)), y: Math.max(-maxY, Math.min(maxY, zoom.y)) };
}

/** 缩放围绕双指中点进行，手指数量变化时由调用方重新记录起点。 */
export function pinchZoom(start: Zoom, from: Point, to: Point, ratio: number): Zoom {
  const scale = Math.max(1, Math.min(6, start.scale * ratio));
  return {
    scale,
    x: to.x - (from.x - start.x) * scale / start.scale,
    y: to.y - (from.y - start.y) * scale / start.scale,
  };
}
