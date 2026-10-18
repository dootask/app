import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { registerModule } from '../../bridge/dispatcher';
import type { PageHandle } from '../../bridge/pages';
import { isCallbackRef } from '../../bridge/protocol';

const REQUESTS_KEY = 'location.requests';
const TIMEOUT_MS = 20_000;
const MAX_ACCURACY_METERS = 50;

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

function removeSubscription(subscription?: Location.LocationSubscription) {
  try {
    subscription?.remove();
  } catch (error) {
    // 清理失败也必须完成 Web 回调。
    console.warn('[bridge/location] 停止定位监听失败', error);
  }
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
    page.callback(callbackRef, result, false);
  };
  const fail = (error: string) => finish({ status: 'error', error });

  // 覆盖权限弹窗、系统查询和定位本身；任何异步步骤挂起也会结束回调。
  request.timer = setTimeout(() => fail('TIMEOUT'), TIMEOUT_MS);
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
    request.subscription = await Location.watchPositionAsync(
      {
        // Balanced 约 100 米；High 请求更高精度，再按旧 Android 的 50 米门槛筛选。
        accuracy: Location.Accuracy.High,
        timeInterval: 1000,
        distanceInterval: 0,
        mayShowUserSettingsDialog: false,
      },
      ({ coords }) => {
        if (request.finished) return;
        const { latitude, longitude, accuracy } = coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
          || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
          fail(legacyError('UNEXPECTED_ERROR', 'UNAVAILABLE'));
          return;
        }
        // 低精度或未知精度继续等待，20 秒内未改善则回 TIMEOUT。
        if (accuracy === null || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_ACCURACY_METERS) return;
        // 原生坐标为 WGS84；地图页自行转换到 BD09 / GCJ02，壳侧不能重复转换。
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
