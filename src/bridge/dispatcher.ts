import type { BridgeCall } from './protocol';
import type { PageHandle } from './pages';

/**
 * 模块方法分发
 *
 * 模块实现放在 src/bridge/modules/<module>/ 下，通过 registerModule 注册；
 * sendMessage 的各 action 放在 src/bridge/messages/ 下，通过 registerMessage 注册。
 */

// 桥接参数来自 Web 侧任意 JSON，处理函数自行校验
export type MethodHandler = (page: PageHandle, ...args: any[]) => unknown;
export type MessageHandler = (page: PageHandle, payload: Record<string, any>) => unknown;

const modules = new Map<string, Map<string, MethodHandler>>();
const messages = new Map<string, MessageHandler>();

/** 未实现的调用记录（开发期在桥接测试页展示） */
export const unimplemented = new Map<string, number>();

function markUnimplemented(key: string) {
  unimplemented.set(key, (unimplemented.get(key) ?? 0) + 1);
  if (__DEV__) console.warn(`[bridge] 未实现: ${key}`);
}

export function registerModule(name: string, handlers: Record<string, MethodHandler>) {
  let map = modules.get(name);
  if (!map) {
    map = new Map();
    modules.set(name, map);
  }
  for (const [method, handler] of Object.entries(handlers)) {
    map.set(method, handler);
  }
}

export function registerMessage(action: string, handler: MessageHandler) {
  messages.set(action, handler);
}

export function hasMethod(module: string, method: string) {
  return !!modules.get(module)?.has(method);
}

export function hasMessage(action: string) {
  return messages.has(action);
}

function reportError(key: string, e: unknown) {
  console.warn(`[bridge] ${key} 执行失败`, e);
}

export function dispatchCall(page: PageHandle, call: BridgeCall) {
  const key = `${call.module}.${call.method}`;
  const handler = modules.get(call.module)?.get(call.method);
  if (!handler) {
    markUnimplemented(key);
    return;
  }
  try {
    const ret = handler(page, ...call.args);
    if (ret instanceof Promise) ret.catch((e) => reportError(key, e));
  } catch (e) {
    reportError(key, e);
  }
}

export function dispatchMessage(page: PageHandle, payload: unknown) {
  if (typeof payload !== 'object' || payload === null) return;
  const action = String((payload as { action?: unknown }).action ?? '');
  const handler = messages.get(action);
  if (!handler) {
    markUnimplemented(`sendMessage:${action}`);
    return;
  }
  try {
    const ret = handler(page, payload as Record<string, unknown>);
    if (ret instanceof Promise) ret.catch((e) => reportError(`sendMessage:${action}`, e));
  } catch (e) {
    reportError(`sendMessage:${action}`, e);
  }
}
