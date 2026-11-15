import { requireOptionalNativeModule, type EventSubscription } from 'expo';

export interface WatchCommandEvent {
  requestId: string;
  json: string;
}

interface LogM8WatchNative {
  isSupported(): boolean;
  updateContext(json: string): void;
  reply(requestId: string, json: string): void;
  addListener(event: 'onCommand', listener: (e: WatchCommandEvent) => void): EventSubscription;
}

/** Null on Android, web, Expo Go and in tests: the app then runs without a watch. */
export const LogM8Watch = requireOptionalNativeModule<LogM8WatchNative>('LogM8Watch');
