/** 此文件不加载 RN 或原生模块，可由 Router 在初始化导航前调用。 */
export function isFrontendDeepLink(link: string): boolean {
  if (!/^dootask:\/\//i.test(link)) return false;
  try {
    const url = new URL(link);
    const route = `${url.hostname}${url.pathname}`.replace(/^\/+|\/+$/g, '');
    return route !== 'bridge-test' && route !== 'dev-eval';
  } catch {
    // 旧版链接可能不是标准 URL，交给前端解析并避免进入未匹配路由。
    return true;
  }
}
