import { LogM8Watch } from '../../modules/logm8-watch/src';
import { type WatchPort, noWatch } from '../lib/watch';

/** Apple Watch link over WatchConnectivity (iOS dev/release builds only). */
export function createWatchPort(): WatchPort {
  const native = LogM8Watch;
  if (!native?.isSupported()) return noWatch;
  return {
    updateContext: (ctx) => native.updateContext(JSON.stringify(ctx)),
    onCommand: (handler) => {
      const sub = native.addListener('onCommand', (e) => {
        let raw: unknown;
        try {
          raw = JSON.parse(e.json);
        } catch {
          raw = null;
        }
        void handler(raw)
          .catch((err: unknown) => ({ id: '', ok: false as const, reason: 'error', message: (err as Error).message }))
          .then((reply) => native.reply(e.requestId, JSON.stringify(reply)));
      });
      return () => sub.remove();
    },
  };
}
