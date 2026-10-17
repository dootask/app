/**
 * 模块注册入口（副作用导入）
 * - core：Claude 维护的核心方法（变量/缓存写入、openPage、sendMessage 路由）
 * - eeui / webview：其余 eeui、webview 模块方法
 * - messages：webview.sendMessage 的各 action
 */
import './core';
import './eeui';
import './webview';
import '../messages';
