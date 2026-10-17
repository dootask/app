# 原生启动能力接入

本批次提供 `modules/web-server`、`modules/legacy-store`、`plugins/with-web-assets.js`、`src/native/` 和 `src/app/+native-intent.tsx`，未修改首页、二级页或桥核心。`app.config.ts` 仅追加资源插件；无需新增 npm 依赖。Expo autolinking 默认搜索 `./modules`，已验证双端都能发现两个本地模块。

## 接入顺序

1. 首页从 `../native` 导入函数；该入口同时注册 `eeui.goDesktop`。
2. 先 `await migrateLegacyCaches()`，再 `ensureAppUniqueId()`，保留升级前的设备标识和登录缓存。
3. `useLocalWebReady()` 与迁移可并行，二者就绪后才挂载 WebView。设置 `EXPO_PUBLIC_WEB_URL` 时直接返回开发地址，原生服务不会被加载或启动。
4. `useDeepLinkHandler(getPage)` 的 getter 在 WebView 成功加载前返回 null。Hook 等待页面出现及约两秒初始化窗口后投递，之后的链接即时投递。卸载会释放监听和计时器。

下面 diff 基于并行任务已加入 WebView overrides 的首页。就绪后再挂载 ReadyMainPage 内的页面生命周期，避免等待服务时提前消费首次 resume；深链监听覆盖整个启动等待过程。差分保留其 `onLoadEnd` 等 props；新增的加载事件也与其处理函数合并。启动错误由 Promise 返回或日志报告，集成方可接现有初始化错误界面。差分仅供集成方应用，本批次没有写入 `src/app/index.tsx`。

```diff
--- a/src/app/index.tsx
+++ b/src/app/index.tsx
@@ -1,24 +1,51 @@
-import { useCallback, useEffect, useMemo, useRef } from 'react';
-import { BackHandler, View } from 'react-native';
+import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
+import { ActivityIndicator, BackHandler, View } from 'react-native';
 
 import { BridgeWebView, type BridgeWebViewHandle } from '../bridge/BridgeWebView';
 import { usePageActive } from '../bridge/hooks';
 import { handleBackPress } from '../bridge/navigation';
 import { SnapshotOverlay, usePageWebViewOverrides } from '../bridge/modules/webview/overrides';
 import type { PageInfo } from '../bridge/protocol';
-import { FIRST_PAGE_NAME, MAIN_WEB_URL } from '../config';
+import { FIRST_PAGE_NAME } from '../config';
+import { ensureAppUniqueId, migrateLegacyCaches, useDeepLinkHandler, useLocalWebReady } from '../native';
 
 /**
  * 主页面（对应 eeui pages/index.vue）：全屏 WebView 承载 DooTask 前端
  */
 export default function MainPage() {
   const ref = useRef<BridgeWebViewHandle>(null);
+  const webLoadedRef = useRef(false);
+  const [nativeReady, setNativeReady] = useState(false);
+  const webUrl = useLocalWebReady();
+  useDeepLinkHandler(useCallback(() => webLoadedRef.current ? ref.current?.page ?? null : null, []));
+
+  useEffect(() => {
+    let disposed = false;
+    void migrateLegacyCaches().then(() => {
+      ensureAppUniqueId();
+      if (!disposed) setNativeReady(true);
+    }).catch((error) => console.warn('[native] 初始化失败', error));
+    return () => { disposed = true; };
+  }, []);
+
+  if (!nativeReady || !webUrl) {
+    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
+  }
+  return <ReadyMainPage bridgeRef={ref} webLoadedRef={webLoadedRef} webUrl={webUrl} />;
+}
+
+// 就绪后再挂载页面生命周期，避免等待服务时提前消费首次 resume。
+function ReadyMainPage({ bridgeRef: ref, webLoadedRef, webUrl }: {
+  bridgeRef: RefObject<BridgeWebViewHandle | null>;
+  webLoadedRef: RefObject<boolean>;
+  webUrl: string;
+}) {
   const { props: webViewProps, onPage, captureRef, values: webViewValues, url: overrideUrl } = usePageWebViewOverrides(FIRST_PAGE_NAME, ref);
   const resumeNum = useRef(0);
 
   const info = useMemo<PageInfo>(
-    () => ({ pageName: FIRST_PAGE_NAME, pageType: 'app', url: MAIN_WEB_URL, params: {} }),
-    [],
+    () => ({ pageName: FIRST_PAGE_NAME, pageType: 'app', url: webUrl, params: {} }),
+    [webUrl],
   );
 
   usePageActive(
@@ -32,11 +59,11 @@
   useEffect(() => {
     const sub = BackHandler.addEventListener('hardwareBackPress', () => handleBackPress(ref.current?.page));
     return () => sub.remove();
-  }, []);
+  }, [ref]);
 
   const onCreateTarget = useCallback((url: string) => {
     ref.current?.page?.invokeWindow('__onCreateTarget', url);
-  }, []);
+  }, [ref]);
 
   return (
     <View style={{ flex: 1 }}>
@@ -45,11 +72,19 @@
           {...webViewProps}
           ref={ref}
           info={info}
-          url={overrideUrl ?? MAIN_WEB_URL}
+          url={overrideUrl ?? webUrl}
           onPage={onPage}
           contentInsetAdjustmentBehavior="never"
           automaticallyAdjustContentInsets={false}
           onCreateTarget={onCreateTarget}
+          onLoadStart={(event) => {
+            webLoadedRef.current = false;
+            webViewProps.onLoadStart?.(event);
+          }}
+          onLoad={(event) => {
+            webViewProps.onLoad?.(event);
+            webLoadedRef.current = true;
+          }}
         />
       </View>
       <SnapshotOverlay values={webViewValues} />
```

## 兼容细节

- `start(port)` 在原生监听就绪后 resolve `{port}`；`stop()`、`isRunning()` 均为 Promise。JS 首次失败后再重试三次，间隔一秒；成功后永久写入 `appWebServerPort=22223`。AppState active 时检查服务并按需重启。
- 旧插件为 iOS GCDWebServer、Android NanoHTTPD。本实现用系统 Network.framework / ServerSocket，避免额外原生依赖。仅监听 127.0.0.1，JS origin 始终为 `http://localhost:22223`。业务路由回退 index.html，缺失的带扩展名静态资源返回 404；支持 GET/HEAD、常见 MIME、64 KiB 流式读取和并发。iOS 支持单段 Range；Android 未压缩 asset 支持 Range，压缩 asset 用 HTTP/1.1 chunked 传输并忽略 Range（返回完整 200）。
- iOS 资源是 Bundle 中的 `web/` folder reference；Android 是 `app/src/main/assets/web/`。`assets/web/` 缺失时插件只警告并跳过，运行时 start 会拒绝缺少 index.html 的资源目录。
- Android 旧缓存是 SharedPreferences `eeuiCaches` 文件的 `eeuiCaches` JSON 字符串；iOS 是标准 UserDefaults `storage_caches` 字典，v2 条目解开 JSON `{"value": ...}`，兼容 v1 原值。旧过期字段都是绝对 Unix 秒，导入 `CacheEntry.expiredAt` 时乘 1000；0 表示永久，过期条目丢弃。`setCachesString` 的过期参数则是剩余秒数，不能直接传旧绝对时间。
- 迁移不覆盖新缓存、不修改旧存储。数据全部导入成功后，用 `importCaches` 同步落盘 `__legacyCachesMigrated=1`；读取失败不标记。`appUniqueId` 使用旧壳/前端完全相同的字符表及长度规则。
- 旧 iOS share 入口和 Android WelcomeActivity 先移除 `dootask://` 再传递 `__handleLink`。新 Hook 同样只移除 scheme，保留路径、query、hash 和原编码，例如 `dootask:///manage/project?code=x#join` → `/manage/project?code=x#join`。
- Expo Router 默认给未匹配路径生成 `+not-found` 路由。新增 `+native-intent.tsx` 将业务 dootask 链接重写到首页，Hook 仍通过 expo-linking 取得原始 URL 并交给前端。`dootask://bridge-test`（也含三斜杠写法、query）保留为测试路由；开发客户端 exp+dootask 地址也不改写。该文件独立于 `src/native/index.ts`，避免导航初始化时加载 RN 模块或注册桥方法。

## 验证与待验收

已通过：

- `npx tsc --noEmit`、`npx expo lint`（全仓 0 error）。
- `node --test src/native/__tests__/native.test.cjs`：8 项，覆盖格式/过期换算、迁移并发与失败重试、设备标识、服务重试与端口缓存、开发地址旁路、前台重启、深链队列及路由保留。
- `CI=1 npx expo prebuild --clean --no-install`；确认 iOS 的 folder reference 及 Resources 构建项、双端资源内容；未安装依赖，package.json 未被 prebuild 改动。
- `npx expo-modules-autolinking resolve --platform android --json` 与 `--platform apple --json` 均发现两个本地模块及其类/pod。
- 资源插件额外验证：缺目录警告与跳过、嵌套复制、清理过时资源、重复执行无重复 Xcode 引用。
- Kotlin HTTP 宿主测试：入口回退、MIME、非法路径、HEAD、单段/后缀 Range、416、空文件、4 MiB 分块传输、32 个并发请求、停止与同端口重启。使用现有缓存中的 Kotlin 2.2.20 编译器和 `/tmp` 中临时 JRE 17 运行，无项目依赖改动。有 kotlinc/JRE 的环境可运行：

```bash
kotlinc modules/web-server/android/src/main/java/expo/modules/webserver/LocalHttpServer.kt \
  modules/web-server/tests/LocalHttpServerTest.kt \
  -jvm-target 17 -include-runtime -d /tmp/dootask-http-tests.jar
java -jar /tmp/dootask-http-tests.jar
```

未验证：本机环境变量所指 Android SDK/JDK 目录均不存在，无法运行 `./gradlew :app:assembleDebug`；Kotlin 宿主测试不覆盖 Expo 模块与 Android API 编译/运行。Linux 无 Xcode/iOS SDK，Swift 只做源码/API 自查，尚未编译。需要构建机双端编译及真机/模拟器验证静态服务、后台恢复、升级缓存迁移、goDesktop、深链冷/热启动。内置资源仍为占位页，打包前需把真实前端产物同步到 `assets/web/`。本次生成的 `ios/`、`android/` 已在验证结束后删除。最终接入 diff 的建议源码通过虚拟全仓 TypeScript 检查和 ESLint（未写入首页）。

## 本批文件清单

```text
.gitignore
app.config.ts
assets/web/index.html
docs/bridge-inventory.md
docs/native-integration.md
docs/progress.md
modules/legacy-store/android/build.gradle
modules/legacy-store/android/src/main/AndroidManifest.xml
modules/legacy-store/android/src/main/java/expo/modules/legacystore/DooTaskLegacyStoreModule.kt
modules/legacy-store/expo-module.config.json
modules/legacy-store/index.ts
modules/legacy-store/ios/DooTaskLegacyStore.podspec
modules/legacy-store/ios/DooTaskLegacyStoreModule.swift
modules/legacy-store/ios/PrivacyInfo.xcprivacy
modules/legacy-store/package.json
modules/web-server/android/build.gradle
modules/web-server/android/src/main/AndroidManifest.xml
modules/web-server/android/src/main/java/expo/modules/webserver/DooTaskWebServerModule.kt
modules/web-server/android/src/main/java/expo/modules/webserver/LocalHttpServer.kt
modules/web-server/expo-module.config.json
modules/web-server/index.ts
modules/web-server/ios/DooTaskWebServer.podspec
modules/web-server/ios/DooTaskWebServerModule.swift
modules/web-server/package.json
modules/web-server/tests/LocalHttpServerTest.kt
plugins/with-web-assets.js
src/app/+native-intent.tsx
src/native/__tests__/native.test.cjs
src/native/appUniqueId.ts
src/native/deepLink.ts
src/native/index.ts
src/native/legacyCacheFormat.ts
src/native/legacyCaches.ts
src/native/linkRouting.ts
src/native/register.ts
src/native/webServer.ts
```
