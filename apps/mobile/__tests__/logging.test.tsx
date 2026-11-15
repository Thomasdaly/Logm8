import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { HomeScreen } from '../src/screens/HomeScreen';
import { PROFILE } from './helpers/testDb';
import { mockRouter } from '../jest.setup';
import { act, advance, renderWithHarness } from './helpers/render';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('Home: work/rest logging', () => {
  it('redirects to onboarding when no profile exists', async () => {
    await renderWithHarness(<HomeScreen />, { profile: null });
    expect(screen.getByTestId('redirect').props.children).toBe('redirect:/onboarding');
  });

  it('Start Work records a state_change event and shows Working', async () => {
    const h = await renderWithHarness(<HomeScreen />);
    expect(screen.getByTestId('current-state').props.children.join('')).toContain('Not started');
    await fireEvent.press(screen.getByTestId('start-work'));
    await waitFor(() => expect(screen.getByTestId('current-state').props.children.join('')).toContain('Working since 06:00'));
    const last = (await h.store.list()).at(-1)!;
    expect(last.type).toBe('state_change');
    expect(last.payload).toMatchObject({ state: 'work', source: 'manual', at: '2026-11-15T20:00:00.000Z' });
    expect(last.appVersion).toBe('test');
    expect(screen.getByTestId('start-work').props.accessibilityState.disabled).toBe(true);
  });

  it('Start Rest records rest with the chosen location; rest in a sleeper berth while moving is offered for two-up only', async () => {
    const solo = await renderWithHarness(<HomeScreen />);
    expect(screen.queryByLabelText('Sleeper berth (moving)')).toBeNull();
    await fireEvent.press(screen.getByTestId('start-work'));
    await advance(solo, 30);
    await fireEvent.press(screen.getByLabelText('Sleeper berth (parked)'));
    await fireEvent.press(screen.getByTestId('start-rest'));
    await waitFor(async () => expect((await solo.store.list()).at(-1)?.payload).toMatchObject({ state: 'rest', restLocation: 'sleeper_berth_stationary' }));
    expect(screen.getByTestId('current-state').props.children.join('')).toContain('Resting since 06:30');
  });

  it('two-up drivers can log rest in a sleeper berth while moving', async () => {
    const h = await renderWithHarness(<HomeScreen />, { profile: { ...PROFILE, twoUp: true } });
    await fireEvent.press(screen.getByLabelText('Sleeper berth (moving)'));
    await fireEvent.press(screen.getByTestId('start-rest'));
    await waitFor(async () => expect((await h.store.list()).at(-1)?.payload).toMatchObject({ restLocation: 'sleeper_berth_moving' }));
  });

  it("stamps every record with device time, GPS position and accuracy once a fix is available", async () => {
    const h = await renderWithHarness(<HomeScreen />);
    await h.controller.enableLocation();
    await act(async () => h.location.emit(h.clock, 0));
    await fireEvent.press(screen.getByTestId('start-work'));
    await waitFor(async () => expect((await h.store.list()).length).toBe(2));
    const e = (await h.store.list())[1]!;
    expect(e.deviceTime).toBe('2026-11-15T20:00:00.000Z');
    expect(e.position).toEqual({ lat: -27.47, lon: 153.02, accuracyM: 6, fixTime: '2026-11-15T20:00:00.000Z' });
  });

  it("shows today's 15-minute timeline: 96 blocks, work in green blocks, future blocks greyed", async () => {
    const h = await renderWithHarness(<HomeScreen />);
    await fireEvent.press(screen.getByTestId('start-work'));
    await advance(h, 61);
    const slot = (t: string) => screen.getByTestId(`slot-${t}`).props.accessibilityLabel as string;
    await waitFor(() => expect(slot('06:00')).toBe('06:00 work'));
    expect(slot('06:45')).toBe('06:45 work');
    expect(slot('05:45')).toBe('05:45 not recorded');
    expect(slot('12:00')).toBe('12:00 later');
    expect(screen.getAllByTestId(/^slot-/)).toHaveLength(96);
    await fireEvent.press(screen.getByTestId('start-rest'));
    await advance(h, 31);
    // work ran until 07:01, so the 07:00 block stays work (any work in a block makes it a work block)
    await waitFor(() => expect(slot('07:15')).toBe('07:15 rest'));
    expect(slot('07:00')).toBe('07:00 work');
  });

  it('shows the live countdown from forecast() and counts down each second', async () => {
    const h = await renderWithHarness(<HomeScreen />);
    await fireEvent.press(screen.getByTestId('start-work'));
    await waitFor(() => expect(screen.getByTestId('countdown-time').props.children).toBe('5:15:00'));
    expect(screen.getByText(/In any 5 1\/2 hours: max 5 1\/4 h work/)).toBeTruthy();
    expect(screen.getByText('Rest needed then: 15 min')).toBeTruthy();
    await act(async () => {
      h.clock.ms += 5000;
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('countdown-time').props.children).toBe('5:14:55');
  });

  it('shows available work time while resting, and no banner', async () => {
    await renderWithHarness(<HomeScreen />);
    expect(screen.getByText('Work time available if you start now')).toBeTruthy();
    expect(screen.queryByTestId('warning-banner')).toBeNull();
  });

  it('refuses a double Start Work with a message and no new event', async () => {
    const h = await renderWithHarness(<HomeScreen />);
    await h.controller.startWork();
    const before = (await h.store.list()).length;
    expect(await h.controller.startWork()).toMatchObject({ ok: false, reason: 'already' });
    expect((await h.store.list()).length).toBe(before);
  });

  it('opens History and Settings', async () => {
    await renderWithHarness(<HomeScreen />);
    await fireEvent.press(screen.getByTestId('open-history'));
    await fireEvent.press(screen.getByTestId('open-settings'));
    expect(mockRouter.push).toHaveBeenCalledWith('/history');
    expect(mockRouter.push).toHaveBeenCalledWith('/settings');
  });

  it('lists possible breaches from the rules engine when the record has one', async () => {
    const h = await renderWithHarness(<HomeScreen />);
    await h.controller.startWork();
    await act(async () => {
      h.clock.advance(6 * 60);
    });
    await h.controller.startRest();
    await waitFor(() => expect(screen.getByTestId('breaches')).toBeTruthy());
    expect(screen.getByText(/max 5 1\/4 h work.*exceeds/)).toBeTruthy();
  });
});
