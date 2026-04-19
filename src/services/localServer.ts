import Server, { ERROR_LOG_FILE } from '@dr.pogodin/react-native-static-server';
import * as RNFS from '@dr.pogodin/react-native-fs';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const PORT = 22224;
const WEB_DIR_NAME = 'web';

let server: Server | null = null;
let serverUrl: string | null = null;

export function getLocalServerUrl(): string | null {
  return serverUrl;
}

export async function startLocalServer(): Promise<string> {
  if (serverUrl) return serverUrl;

  let fileDir: string;
  if (Platform.OS === 'android') {
    // Android packages `android/app/src/main/assets/web/` into the APK; we first copy it
    // out to the document directory (APK assets aren't directly file-system readable) and
    // point the static server there.
    fileDir = `${RNFS.DocumentDirectoryPath}/${WEB_DIR_NAME}`;
    await ensureAndroidWebAssets(fileDir);
  } else {
    // iOS: withWebAssets.js registers `<AppName>/web` as a Xcode *folder reference* (blue
    // folder). Folder references land in the bundle root keeping only the last component,
    // so the runtime path is `<Bundle>/web/`, NOT `<Bundle>/assets/web/`.
    fileDir = `${RNFS.MainBundlePath}/${WEB_DIR_NAME}`;
  }

  server = new Server({
    fileDir,
    port: PORT,
    // Force the returned origin to `http://localhost:<port>`. Default is 127.0.0.1 which
    // makes Vue's isLocalHost(url) → false (it only recognises "localhost"), and that
    // cascades into history-mode routing + 404 on first load.
    hostname: 'localhost',
    stopInBackground: false,
    // Detailed 404/request logs → ERROR_LOG_FILE (in TemporaryDirectoryPath). When
    // lighttpd 404s everything, tailing this log tells us whether it's a
    // document-root-not-found, permission, or path-normalization issue.
    errorLog: {
      fileNotFound: true,
      requestHandling: true,
    },
  });

  try {
    serverUrl = await server.start();
    console.log(`[localServer] serving ${fileDir} at ${serverUrl}`);
    console.log(`[localServer] error log at ${ERROR_LOG_FILE}`);
    // Also report fileDir existence + contents from lighttpd's perspective (this process).
    try {
      const exists = await RNFS.exists(fileDir);
      if (exists) {
        const entries = await RNFS.readDir(fileDir);
        console.log(
          `[localServer] fileDir exists, ${entries.length} entries:`,
          entries.map((e) => e.name).slice(0, 10).join(', '),
        );
      } else {
        console.warn(`[localServer] fileDir does NOT exist from RN perspective: ${fileDir}`);
      }
    } catch (e) {
      console.warn('[localServer] RNFS.readDir failed:', e);
    }
  } catch (e) {
    console.warn('[localServer] start failed:', e, 'fileDir=', fileDir);
    throw e;
  }
  return serverUrl;
}

export async function stopLocalServer(): Promise<void> {
  if (server) {
    await server.stop();
    server = null;
    serverUrl = null;
  }
}

async function ensureAndroidWebAssets(destDir: string): Promise<void> {
  const versionFile = `${destDir}/.version`;
  const currentVersion = Constants.expoConfig?.version ?? '0.0.0';

  try {
    const saved = await RNFS.readFile(versionFile, 'utf8');
    if (saved === currentVersion) return;
  } catch {
    // missing or unreadable — fall through to re-copy
  }

  if (await RNFS.exists(destDir)) {
    await RNFS.unlink(destDir);
  }
  await RNFS.mkdir(destDir);
  await copyAssetDir(WEB_DIR_NAME, destDir);
  await RNFS.writeFile(versionFile, currentVersion, 'utf8');
}

async function copyAssetDir(assetPath: string, destPath: string): Promise<void> {
  const items = await RNFS.readDirAssets(assetPath);
  for (const item of items) {
    const srcPath = `${assetPath}/${item.name}`;
    const dstPath = `${destPath}/${item.name}`;
    if (item.isDirectory()) {
      await RNFS.mkdir(dstPath);
      await copyAssetDir(srcPath, dstPath);
    } else {
      await RNFS.copyFileAssets(srcPath, dstPath);
    }
  }
}
