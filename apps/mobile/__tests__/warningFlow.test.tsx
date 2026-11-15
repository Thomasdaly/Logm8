import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { HomeScreen } from '../src/screens/HomeScreen';
import { PROFILE } from './helpers/testDb';
import { act, advance, renderWithHarness } from './helpers/render';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('Warning flow in the UI (mocked clock + mocked location + mocked speech)', () => {
  it('speaks and shows a banner at 60, 30, 15 and 5 minutes before the earliest limit', async () => {
    const h = await renderWithHarness(<HomeScreen />);
    await act(async () => {
      await h.controller.startWork();
    });
    expect(screen.queryByTestId('warning-banner')).toBeNull();

    await advance(h, 255);
    expect(h.speech.spoken).toHaveLength(1);
    expect(h.speech.spoken[0]).toMatch(/^60 minutes until a required rest/);
    expect(screen.getByText('60 min to required rest')).toBeTruthy();

    await advance(h, 30);
    expect(h.speech.spoken[1]).toMatch(/^30 minutes/);
    expect(screen.getByText('30 min to required rest')).toBeTruthy();

    await advance(h, 15);
    expect(h.speech.spoken[2]).toMatch(/^15 minutes/);

    await advance(h, 10);
    expect(h.speech.spoken[3]).toMatch(/^5 minutes/);
    expect(screen.getByText('5 min to required rest')).toBeTruthy();
    expect(h.speech.spoken).toHaveLength(4);
  });

  it('while moving the buttons disappear, but the banner and the spoken warnings stay', async () => {
    const h = await renderWithHarness(<HomeScreen />);
    await h.controller.enableLocation();
    await act(async () => {
      await h.controller.startWork();
    });
    expect(screen.getByTestId('start-rest')).toBeTruthy();

    // drive at 80 km/h, sample every minute, until the 60 minute warning
    for (let m = 0; m < 255; m++) {
      await act(async () => {
        h.clock.advance(1);
        h.location.emit(h.clock, 80);
        jest.advanceTimersByTime(1000);
      });
    }
    expect(screen.getByTestId('driving-lock')).toBeTruthy();
    expect(screen.queryByTestId('start-work')).toBeNull();
    expect(screen.queryByTestId('start-rest')).toBeNull();
    expect(screen.queryByTestId('open-settings')).toBeNull();
    expect(screen.getByTestId('warning-banner')).toBeTruthy();
    expect(screen.getByText('60 min to required rest')).toBeTruthy();
    expect(h.speech.spoken.filter((t) => /^60 minutes/.test(t))).toHaveLength(1);

    // stopped: controls return
    await act(async () => {
      h.clock.advance(1);
      h.location.emit(h.clock, 0);
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('start-rest')).toBeTruthy();
    expect(screen.queryByTestId('driving-lock')).toBeNull();
  });

  it('shows motion suggestions as a card with Confirm/Dismiss when stopped; nothing is recorded until Confirm', async () => {
    const h = await renderWithHarness(<HomeScreen />);
    await h.controller.enableLocation();
    await act(async () => {
      h.location.emit(h.clock, 60);
      h.clock.advance(1);
      h.location.emit(h.clock, 60);
      h.clock.advance(1);
      h.location.emit(h.clock, 0);
    });
    expect(screen.getByTestId('suggestion')).toBeTruthy();
    expect(screen.getByText('Vehicle movement detected. Start work?')).toBeTruthy();
    expect((await h.store.list()).filter((e) => e.type === 'state_change')).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('suggestion-confirm'));
    await waitFor(() => expect(screen.getByTestId('current-state').props.children.join('')).toContain('Working'));
    expect((await h.store.list()).filter((e) => e.type === 'state_change')).toHaveLength(1);
    expect(screen.queryByTestId('suggestion')).toBeNull();
  });

  it('a different profile (BFM solo) warns against its own 6 hour limit', async () => {
    const h = await renderWithHarness(<HomeScreen />, { profile: { ...PROFILE, schemeFamily: 'bfm' } });
    await act(async () => {
      await h.controller.startWork();
    });
    expect(h.controller.getSnapshot().countdownSec).toBe(6 * 3600 + 0);
    await advance(h, 6 * 60 - 60);
    expect(h.speech.spoken[0]).toMatch(/^60 minutes/);
  });
});
