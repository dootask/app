import { useMemo } from 'react';

import { BridgeWebView } from '../bridge/BridgeWebView';
import type { PageInfo } from '../bridge/protocol';
import { BRIDGE_TEST_HTML } from '../devtools/bridgeTestHtml';

/**
 * 桥接自测页（开发用）：xcrun simctl openurl booted dootask://bridge-test
 * 或 adb shell am start -a android.intent.action.VIEW -d dootask://bridge-test
 */
const TEST_URL = 'data:text/html;charset=utf-8,' + encodeURIComponent(BRIDGE_TEST_HTML);

export default function BridgeTestPage() {
  const info = useMemo<PageInfo>(
    () => ({ pageName: 'bridgeTest', pageType: 'app', url: TEST_URL, params: {} }),
    [],
  );
  return <BridgeWebView info={info} url={TEST_URL} contentInsetAdjustmentBehavior="never" />;
}
