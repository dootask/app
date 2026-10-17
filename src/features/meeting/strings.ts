import type { MeetingAlert } from './params';

const zh = {
  meeting: '会议', joining: '正在加入会议…', reconnecting: '连接中断，正在重连…',
  microphone: '麦克风', camera: '摄像头', switchCamera: '翻转', speaker: '扬声器',
  invite: '邀请', minimize: '最小化', leave: '离开', close: '关闭', me: '我',
  restore: '返回会议', background: '会议进行中，点按返回 DooTask',
  failed: '无法加入会议，请稍后重试。', operationFailed: '操作失败，请重试。',
  expired: '会议已结束', busy: '您正在另一场会议中，请先离开当前会议。',
  permissionTitle: '需要相机或麦克风权限', permissionMessage: '请在系统设置中允许 DooTask 使用相机或麦克风，然后重新操作。',
  settings: '前往设置', cancel: '取消', tokenExpiring: '会议凭证即将过期，请准备重新入会。',
  tokenExpired: '会议凭证已过期，请重新加入会议。',
  alert: { title: '温馨提示', message: '确定要离开会议吗？', cancel: '继续', confirm: '退出' } as MeetingAlert,
};

export type MeetingStrings = typeof zh;

/** 旧会议控件以图标为主，退出弹窗完全使用前端已翻译的 alert；新增文字同媒体页回退策略。 */
export function meetingStrings(language: string): MeetingStrings {
  if (/^zh[-_]?(hant|cht|tw|hk)/i.test(language)) return {
    meeting: '會議', joining: '正在加入會議…', reconnecting: '連線中斷，正在重新連線…',
    microphone: '麥克風', camera: '攝影機', switchCamera: '翻轉', speaker: '揚聲器',
    invite: '邀請', minimize: '最小化', leave: '離開', close: '關閉', me: '我',
    restore: '返回會議', background: '會議進行中，點按返回 DooTask',
    failed: '無法加入會議，請稍後重試。', operationFailed: '操作失敗，請重試。',
    expired: '會議已結束', busy: '您正在另一場會議中，請先離開目前會議。',
    permissionTitle: '需要攝影機或麥克風權限', permissionMessage: '請在系統設定中允許 DooTask 使用攝影機或麥克風，然後重新操作。',
    settings: '前往設定', cancel: '取消', tokenExpiring: '會議憑證即將過期，請準備重新入會。',
    tokenExpired: '會議憑證已過期，請重新加入會議。',
    alert: { title: '溫馨提示', message: '確定要離開會議嗎？', cancel: '繼續', confirm: '退出' },
  };
  if (!language || /^zh/i.test(language)) return zh;
  return {
    meeting: 'Meeting', joining: 'Joining meeting…', reconnecting: 'Connection lost. Reconnecting…',
    microphone: 'Microphone', camera: 'Camera', switchCamera: 'Flip', speaker: 'Speaker',
    invite: 'Invite', minimize: 'Minimize', leave: 'Leave', close: 'Close', me: 'Me',
    restore: 'Return to meeting', background: 'Meeting in progress. Tap to return to DooTask',
    failed: 'Unable to join the meeting. Please try again.', operationFailed: 'Unable to complete this action. Please try again.',
    expired: 'Meeting ended', busy: 'You are in another meeting. Please leave it first.',
    permissionTitle: 'Camera or microphone access needed', permissionMessage: 'Allow DooTask to use the camera or microphone in system settings, then try again.',
    settings: 'Settings', cancel: 'Cancel', tokenExpiring: 'Your meeting token expires soon. Please prepare to rejoin.',
    tokenExpired: 'Your meeting token expired. Please rejoin the meeting.',
    alert: { title: 'Notice', message: 'Leave this meeting?', cancel: 'Stay', confirm: 'Leave' },
  };
}
