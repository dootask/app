import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { getLocalServerUrl } from '../../services/localServer';

interface OpenPageParams {
  url?: string;
  pageType?: string;
  pageTitle?: string;
  params?: {
    url?: string;
    titleFixed?: boolean;
    hiddenDone?: boolean;
    allowAccess?: boolean;
    showProgress?: boolean;
  };
  softInputMode?: string;
}

export function handleOpenPage(
  args: unknown[],
  navigation: NativeStackNavigationProp<RootStackParamList>,
): { status: string; pageId: string } {
  const params = ((args[0] as OpenPageParams) ?? {}) as OpenPageParams;
  const serverUrl = getLocalServerUrl();
  let targetUrl = params.params?.url || params.url || '';

  if (targetUrl.startsWith('#')) {
    targetUrl = `${serverUrl ?? ''}/index.html${targetUrl}`;
  } else if (targetUrl.startsWith('/')) {
    targetUrl = `${serverUrl ?? ''}/index.html#${targetUrl}`;
  } else if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = `${serverUrl ?? ''}/${targetUrl}`;
  }

  const childPageId = `child_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  navigation.navigate('ChildWebView', {
    url: targetUrl,
    title: params.pageTitle || '',
    titleFixed: params.params?.titleFixed ?? false,
    pageId: childPageId,
  });

  return { status: 'success', pageId: childPageId };
}

const pageCallbacks = new Map<string, (status: { status: string }) => void>();

export function registerPageCallback(
  childPageId: string,
  callback: (status: { status: string }) => void,
): void {
  pageCallbacks.set(childPageId, callback);
}

export function onChildPageClosed(childPageId: string): void {
  const callback = pageCallbacks.get(childPageId);
  if (callback) {
    callback({ status: 'pause' });
    pageCallbacks.delete(childPageId);
  }
}
