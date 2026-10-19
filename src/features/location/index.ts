import * as Location from 'expo-location';
import { AppState, Platform } from 'react-native';

import { getLegacyLocationModule } from '../../../modules/legacy-location';
import { registerModule } from '../../bridge/dispatcher';
import type { PageHandle } from '../../bridge/pages';
import { isCallbackRef } from '../../bridge/protocol';

const REQUESTS_KEY = 'location.requests';
const TIMEOUT_MS = 20_000;
// 系统权限框等待用户选择的上限；不计入定位的 20 秒
const PERMISSION_TIMEOUT_MS = 60_000;
const PERMISSION_POLL_MS = 500;
// 以下两项对齐旧 Android LocationHelper：精度门槛与可复用的最近一次定位时长
const MAX_ACCURACY_METERS = 50;
const MAX_LOCATION_AGE_MS = 30_000;
const LEGACY_ERRORS = new Set(['PERMISSION_DENIED', 'LOCATION_DISABLED', 'TIMEOUT', 'SECURITY_EXCEPTION', 'UNEXPECTED_ERROR']);

type GeolocationResult =
  | { status: 'success'; latitude: number; longitude: number }
  | { status: 'error'; error: string };

interface LocationRequest {
  finished: boolean;
  timer?: ReturnType<typeof setTimeout>;
  subscription?: Location.LocationSubscription;
}

function legacyError(android: string, ios = android) {
  return Platform.OS === 'ios' ? ios : android;
}

function nativeError(error: unknown): string {
  const details = error as { code?: unknown; message?: unknown } | null | undefined;
  const code = typeof details?.code === 'string' ? details.code : '';
  // Android 原生定位模块直接返回旧错误码
  if (Platform.OS === 'android' && LEGACY_ERRORS.has(code)) return code;
  const message = typeof details?.message === 'string' ? details.message : typeof error === 'string' ? error : '';
  if (code === 'ERR_LOCATION_UNAUTHORIZED' || code === 'ERR_DENIED_FOREGROUND_LOCATION_PERMISSION'
    || message === 'Not authorized to use location services' || message === 'Location permission is required to do this operation') {
    return legacyError('PERMISSION_DENIED', 'PERMISSION DENIED');
  }
  if (code === 'ERR_LOCATION_SERVICES_DISABLED' || code === 'ERR_LOCATION_SETTINGS_UNSATISFIED'
    || message === 'Location services are disabled') {
    return legacyError('LOCATION_DISABLED', 'UNAVAILABLE');
  }
  // 旧 Android 返回错误码，旧 iOS 返回 NSError.localizedDescription 字符串。
  return legacyError(/security/i.test(`${code} ${message}`) ? 'SECURITY_EXCEPTION' : 'UNEXPECTED_ERROR', message || 'UNAVAILABLE');
}

function validCoords(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

function removeSubscription(subscription?: Location.LocationSubscription) {
  try {
    subscription?.remove();
  } catch (error) {
    // 清理失败也必须完成 Web 回调。
    console.warn('[bridge/location] 停止定位监听失败', error);
  }
}

/**
 * 地图页收到失败会调 alert()；iOS 系统权限框尚未完全关闭（App 非 active）时 WKWebView 的提示框弹不出来，
 * 网页 JS 会一直卡在 alert 上（表现为一直 loading）。因此 iOS 回到前台后再回传结果。
 */
function deliverWhenActive(deliver: () => void) {
  if (Platform.OS !== 'ios' || AppState.currentState === 'active') {
    deliver();
    return;
  }
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    subscription.remove();
    clearTimeout(fallback);
    deliver();
  };
  const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') run(); });
  // 极端情况下收不到 active 也要回传，避免网页永远等待
  const fallback = setTimeout(run, PERMISSION_TIMEOUT_MS);
}

export async function getGeolocation(page: PageHandle, callbackRef: unknown) {
  if (!isCallbackRef(callbackRef)) return;
  let requests = page.state.get(REQUESTS_KEY) as Set<LocationRequest> | undefined;
  if (!requests) {
    requests = new Set();
    page.state.set(REQUESTS_KEY, requests);
  }
  const pending = requests;
  const request: LocationRequest = { finished: false };
  pending.add(request);

  const finish = (result: GeolocationResult) => {
    if (request.finished) return;
    request.finished = true;
    clearTimeout(request.timer);
    removeSubscription(request.subscription);
    request.subscription = undefined;
    pending.delete(request);
    if (!pending.size && page.state.get(REQUESTS_KEY) === pending) page.state.delete(REQUESTS_KEY);
    deliverWhenActive(() => page.callback(callbackRef, result, false));
  };
  const fail = (error: string) => finish({ status: 'error', error });
  const arm = (ms: number) => {
    clearTimeout(request.timer);
    request.timer = setTimeout(() => fail('TIMEOUT'), ms);
  };

  // 先覆盖权限弹窗与系统查询（给用户留足选择时间），授权后再按 20 秒计定位；任何异步步骤挂起也会结束回调。
  arm(PERMISSION_TIMEOUT_MS);
  try {
    const enabled = await Location.hasServicesEnabledAsync();
    if (request.finished) return;
    if (!enabled) {
      fail(legacyError('LOCATION_DISABLED', 'UNAVAILABLE'));
      return;
    }
    let permission = await Location.getForegroundPermissionsAsync();
    if (request.finished) return;
    if (!permission.granted && permission.canAskAgain) {
      permission = await Location.requestForegroundPermissionsAsync();
      // iOS 首次弹框时请求可能在用户作出选择前就以"未决定"返回，此时继续等用户选择，不能当作拒绝
      while (!request.finished && !permission.granted && permission.status === Location.PermissionStatus.UNDETERMINED) {
        await new Promise((resolve) => setTimeout(resolve, PERMISSION_POLL_MS));
        if (request.finished) return;
        permission = await Location.getForegroundPermissionsAsync();
      }
    }
    if (request.finished) return;
    if (!permission.granted) {
      fail(legacyError('PERMISSION_DENIED', 'PERMISSION DENIED'));
      return;
    }
    // 用户可能在权限弹窗期间关闭系统定位。
    const stillEnabled = await Location.hasServicesEnabledAsync();
    if (request.finished) return;
    if (!stillEnabled) {
      fail(legacyError('LOCATION_DISABLED', 'UNAVAILABLE'));
      return;
    }
    arm(TIMEOUT_MS);
    // 坐标均为 WGS84；地图页自行转换到 BD09 / GCJ02，壳侧不能重复转换。
    if (Platform.OS === 'android') {
      // expo-location 走 Google Play 服务的 Fused 定位，国内机型没有 GMS 时永远等不到结果；
      // 改用原生模块直接调系统 GPS + 网络定位（同旧 LocationHelper，含 50 米门槛与 30 秒内缓存）。
      const { latitude, longitude } = await getLegacyLocationModule().getPosition(TIMEOUT_MS, MAX_ACCURACY_METERS, MAX_LOCATION_AGE_MS);
      if (request.finished) return;
      if (!validCoords(latitude, longitude)) fail('UNEXPECTED_ERROR');
      else finish({ status: 'success', latitude, longitude });
      return;
    }
    request.subscription = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 0 },
      ({ coords }) => {
        if (request.finished) return;
        const { latitude, longitude } = coords;
        if (!validCoords(latitude, longitude)) {
          fail('UNAVAILABLE');
          return;
        }
        // 对齐旧 iOS：取第一次回调的位置，不设精度门槛（设门槛时首次定位常等不到 50 米内而超时）
        finish({ status: 'success', latitude, longitude });
      },
      (error) => fail(nativeError(error)),
    );
    // 订阅建立前可能已收到坐标、错误或超时；迟到的句柄也必须移除。
    if (request.finished) {
      removeSubscription(request.subscription);
      request.subscription = undefined;
    }
  } catch (error) {
    fail(nativeError(error));
  }
}

registerModule('eeui', { getGeolocation });
