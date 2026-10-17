import { registerMessage } from '../../bridge/dispatcher';
import { startMeeting, updateMeetingInfo } from './registry';

registerMessage('startMeeting', (page, payload) => startMeeting(page, payload.meetingParams));
registerMessage('updateMeetingInfo', (page, payload) => updateMeetingInfo(page, payload.infos));
