import { bridgeStore } from '../../bridge/store';

export const MEETING_SESSION = 'meeting.session';
const REVISION = '__nativeMeetingRevision';

/** 只通知根布局重新寻找 PageHandle 中的会话，凭证和页面状态不进入全局快照。 */
export function notifyMeetingChange() {
  bridgeStore.setVariate(REVISION, Number(bridgeStore.getVariate(REVISION, 0)) + 1);
}

export function subscribeMeetingChange(listener: () => void) {
  return bridgeStore.subscribe((patch) => {
    if (patch.variates && REVISION in patch.variates) listener();
  });
}
