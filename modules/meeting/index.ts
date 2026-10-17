import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

interface MeetingModule {
  start(session: string, camera: boolean, microphone: boolean, title: string, text: string): Promise<void>;
  stop(session: string): void;
}

export async function startMeetingService(session: string, camera: boolean, microphone: boolean, title: string, text: string) {
  if (Platform.OS === 'android') {
    await requireNativeModule<MeetingModule>('DooTaskMeeting').start(session, camera, microphone, title, text);
  }
}

export function stopMeetingService(session: string) {
  if (Platform.OS === 'android') requireNativeModule<MeetingModule>('DooTaskMeeting').stop(session);
}
