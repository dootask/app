export function mediaStrings(language: string) {
  if (/^zh[-_]?(hant|cht|tw|hk)/i.test(language)) {
    return { image: '圖片', close: '關閉', failed: '圖片載入失敗', videoFailed: '影片載入失敗', expired: '預覽已失效' };
  }
  if (!language || /^zh/i.test(language)) {
    return { image: '图片', close: '关闭', failed: '图片加载失败', videoFailed: '视频加载失败', expired: '预览已失效' };
  }
  return { image: 'Image', close: 'Close', failed: 'Unable to load image', videoFailed: 'Unable to load video', expired: 'Preview expired' };
}
