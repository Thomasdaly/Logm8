import { type ReactNode, createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { colors } from '../components/theme';
import type { DriverController, Snapshot } from './controller';

const Ctx = createContext<DriverController | null>(null);

export function useController(): DriverController {
  const c = useContext(Ctx);
  if (!c) throw new Error('useController must be used inside <AppProvider>');
  return c;
}

export function useSnapshot(): Snapshot {
  const c = useController();
  return useSyncExternalStore(c.subscribe, c.getSnapshot, c.getSnapshot);
}

interface Props {
  /** Tests inject a ready controller. In the app the controller is created from the SQLite store. */
  controller?: DriverController;
  create?: () => Promise<DriverController>;
  /** Tick interval in ms (the countdown and the warnings). */
  tickMs?: number;
  children: ReactNode;
}

export function AppProvider({ controller: injected, create, tickMs = 1000, children }: Props) {
  const [controller, setController] = useState<DriverController | null>(injected ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (injected || !create) return;
    let cancelled = false;
    create().then(
      (c) => {
        if (!cancelled) setController(c);
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [injected, create]);

  useEffect(() => {
    if (!controller) return;
    const id = setInterval(() => controller.tick(), tickMs);
    return () => clearInterval(id);
  }, [controller, tickMs]);

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: colors.text, fontSize: 18 }}>LogM8 could not open its local database.</Text>
        <Text style={{ color: colors.muted, marginTop: 8 }}>{error}</Text>
      </View>
    );
  }
  if (!controller) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }
  return <Ctx.Provider value={controller}>{children}</Ctx.Provider>;
}
