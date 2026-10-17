export type MeetingEvent =
  | { act: 'getInfo' | 'success' | 'error' | 'endMeeting'; uuid: string }
  | { act: 'invent'; meetingid: string }
  | { act: 'status'; status: boolean };

/** 保留旧壳的 invent 拼写、字符串 ID，以及 status 的 boolean 类型。 */
export function meetingEvent(act: 'getInfo' | 'success' | 'error' | 'endMeeting' | 'invent', id: string | number): MeetingEvent;
export function meetingEvent(act: 'status', status: boolean): MeetingEvent;
export function meetingEvent(act: MeetingEvent['act'], value: string | number | boolean): MeetingEvent {
  if (act === 'status') return { act, status: value === true };
  if (act === 'invent') return { act, meetingid: String(value) };
  return { act, uuid: String(value) };
}
