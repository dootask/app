import { getLocales } from 'expo-localization';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import { getAllPages, getPage, type PageHandle } from '../../bridge/pages';
import { bridgeStore } from '../../bridge/store';
import { meetingEvent } from './events';
import { meetingLanguage, objectValue, parseMeetingParams, sameMeeting, stringValue } from './params';
import { MEETING_SESSION } from './runtime';
import { MeetingSession } from './session';
import { meetingStrings } from './strings';

export function activeMeeting(): MeetingSession | null {
  for (const page of getAllPages()) {
    const session = page.state.get(MEETING_SESSION) as MeetingSession | undefined;
    if (session && !session.ended) return session;
  }
  return null;
}

export function findMeeting(pageName: unknown, id: unknown): MeetingSession | null {
  if (typeof pageName !== 'string' || typeof id !== 'string') return null;
  const session = getPage(pageName)?.state.get(MEETING_SESSION) as MeetingSession | undefined;
  return session?.id === id && !session.ended ? session : null;
}

export function showMeeting(session: MeetingSession) {
  if (session.ended || session.hasRoute) return;
  session.prepareRoute();
  session.setMinimized(false);
  try {
    router.push({ pathname: '/meeting', params: { meetingPage: session.page.pageName, meetingRequest: session.id } });
  } catch (error) {
    console.warn('[meeting] 打开会议页失败', error);
    session.fail(session.strings.failed);
  }
}

export function startMeeting(page: PageHandle, value: unknown) {
  const language = meetingLanguage(bridgeStore.getVariate('appMessage'), bridgeStore.getCachesString('language'), getLocales()[0].languageTag);
  const strings = meetingStrings(language);
  let params;
  try { params = parseMeetingParams(value); }
  catch {
    page.invokeWindow('__onMeetingEvent', meetingEvent('error', stringValue(objectValue(value).uuid) || '0'));
    Alert.alert(strings.meeting, strings.failed, [{ text: strings.ok }]);
    return;
  }
  const active = activeMeeting();
  if (active) {
    if (sameMeeting(active.params, params)) {
      showMeeting(active);
      if (active.getSnapshot().phase !== 'joining') {
        page.invokeWindow('__onMeetingEvent', meetingEvent('success', active.localUid));
      }
    } else {
      page.invokeWindow('__onMeetingEvent', meetingEvent('error', params.uuid));
      Alert.alert(strings.meeting, strings.busy, [{ text: strings.ok }]);
    }
    return;
  }
  const next = Number(page.state.get('meeting.nextRequest') ?? 0) + 1;
  page.state.set('meeting.nextRequest', next);
  const session = new MeetingSession(page, `${Date.now()}-${next}`, params, language);
  page.state.set(MEETING_SESSION, session);
  showMeeting(session);
}

export function updateMeetingInfo(page: PageHandle, value: unknown) {
  const session = page.state.get(MEETING_SESSION) as MeetingSession | undefined;
  // 前端主页面也可能为二级 WebView 发起的会议回传用户信息。
  (session && !session.ended ? session : activeMeeting())?.updateInfo(value);
}
