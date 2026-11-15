import { act, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { AppProvider } from '../../src/state/AppProvider';
import { type Harness, makeHarness } from './fakes';

/** Renders a screen inside the provider with an injected controller and a mocked clock/location/speech. */
export async function renderWithHarness(ui: ReactElement, opts: Parameters<typeof makeHarness>[0] = {}): Promise<Harness & Awaited<ReturnType<typeof render>>> {
  const h = await makeHarness(opts);
  const utils = await render(<AppProvider controller={h.controller}>{ui}</AppProvider>);
  return { ...h, ...utils };
}

/** Moves the mocked clock forward and lets the provider's 1 s ticker run. */
export async function advance(h: Harness, minutes: number): Promise<void> {
  await act(async () => {
    h.clock.advance(minutes);
    jest.advanceTimersByTime(1000);
  });
}

export { act };
