import { objectValue, parseUid } from './params';

export interface UserInfo {
  uuid: string;
  avatar?: string;
  username?: string;
}

export interface Participant extends UserInfo {
  uid: number;
  local: boolean;
  audio: boolean;
  video: boolean;
  audioState: number;
  videoState: number;
}

export function parseUserInfo(value: unknown): UserInfo | null {
  const data = objectValue(value);
  const uid = parseUid(data.uuid);
  if (uid === null) return null;
  return {
    uuid: String(uid),
    ...(typeof data.avatar === 'string' ? { avatar: data.avatar } : {}),
    ...(typeof data.username === 'string' ? { username: data.username } : {}),
  };
}

/** 信息可能早于 userJoined 到达；按规范化 uid 合并，缺失字段不覆盖已有内容。 */
export function mergeUserInfo(infos: ReadonlyMap<string, UserInfo>, value: unknown): Map<string, UserInfo> {
  const result = new Map(infos);
  const info = parseUserInfo(value);
  if (info) result.set(info.uuid, { ...result.get(info.uuid), ...info });
  return result;
}

export function applyUserInfo(participants: readonly Participant[], infos: ReadonlyMap<string, UserInfo>): Participant[] {
  return participants.map((participant) => ({ ...participant, ...infos.get(participant.uuid) }));
}

export function addParticipant(participants: readonly Participant[], uid: number, infos: ReadonlyMap<string, UserInfo>): Participant[] {
  if (parseUid(uid) === null || participants.some((participant) => participant.uid === uid)) return [...participants];
  return [...participants, {
    uid, uuid: String(uid), local: false, audio: false, video: false, audioState: 0, videoState: 0,
    ...infos.get(String(uid)),
  }];
}

/** 与旧 meetings.vue 一致：1/2/3 为活动状态，0/4 为关闭或失败。 */
export function mediaActive(state: number): boolean {
  return state === 1 || state === 2 || state === 3;
}

export function updateMediaState(participants: readonly Participant[], uid: number, kind: 'audio' | 'video', state: number): Participant[] {
  return participants.map((participant) => participant.uid === uid
    ? { ...participant, [kind]: mediaActive(state), [`${kind}State`]: state } : participant);
}
