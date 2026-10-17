import { isFrontendDeepLink } from '../native/linkRouting';

/** 业务链接由首页 WebView 消费，保留 bridge-test、dev-eval 与开发客户端自己的路由。 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return isFrontendDeepLink(path) ? '/' : path;
}
