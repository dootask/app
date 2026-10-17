import { useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { getPage } from '../bridge/pages';
import { FIRST_PAGE_NAME } from '../config';

/**
 * 开发工具：dootask://dev-eval?js=...&page=firstPage
 * 向指定页面注入 JS 后立即返回，用于在模拟器上自动化验证（无需点击工具）。
 * 仅开发构建可用，release 中直接返回。
 */
export default function DevEval() {
  const { js, page } = useLocalSearchParams<{ js?: string; page?: string }>();

  useEffect(() => {
    if (__DEV__ && js) {
      const target = getPage(page || FIRST_PAGE_NAME);
      console.log('[dev-eval]', { page: page || FIRST_PAGE_NAME, found: !!target, canGoBack: router.canGoBack() });
      target?.inject(`try{${js}}catch(e){console.error('[dev-eval]',e)};true;`);
    }
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [js, page]);

  return null;
}
