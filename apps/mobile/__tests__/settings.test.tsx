import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';
import { DISCLAIMER } from '../src/lib/copy';
import { HistoryScreen } from '../src/screens/HistoryScreen';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { act, advance, renderWithHarness } from './helpers/render';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('Settings', () => {
  it('shows the legal-record disclaimer', async () => {
    await renderWithHarness(<SettingsScreen />);
    expect(screen.getByText(DISCLAIMER)).toBeTruthy();
    expect(screen.getByText(/not an Electronic Work Diary/)).toBeTruthy();
  });

  it('shows the profile and the recording mode', async () => {
    await renderWithHarness(<SettingsScreen />);
    expect(screen.getByText('Base: Brisbane, QLD (Australia/Brisbane)')).toBeTruthy();
    expect(screen.getByText('Registration: ABC123')).toBeTruthy();
    expect(screen.getByText('Written Work Diary: WWD-0001')).toBeTruthy();
  });

  it('changing the hours option appends a new profile event; the old one stays in the log', async () => {
    const h = await renderWithHarness(<SettingsScreen />);
    expect(screen.getByTestId('save-scheme').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByText('BFM (transitional)'));
    await fireEvent.press(screen.getByTestId('save-scheme'));
    await waitFor(async () => expect((await h.store.list()).filter((e) => e.type === 'profile')).toHaveLength(2));
    const profiles = (await h.store.list()).filter((e) => e.type === 'profile');
    expect(profiles[0]?.payload).toMatchObject({ profile: { schemeFamily: 'standard' } });
    expect(profiles[1]?.payload).toMatchObject({ profile: { schemeFamily: 'bfm' } });
    expect(h.controller.getSnapshot().profile?.schemeFamily).toBe('bfm');
  });

  it('verifies log integrity, and reports a problem if the chain is broken', async () => {
    const h = await renderWithHarness(<SettingsScreen />);
    await fireEvent.press(screen.getByTestId('verify-integrity'));
    await waitFor(() => expect(screen.getByTestId('integrity-result').props.children).toMatch(/Log intact \(1 entries\)/));
    jest.spyOn(h.store, 'verify').mockResolvedValueOnce({ ok: false, count: 3, brokenAtSeq: 2, reason: 'record content does not match its hash (the record was altered)' });
    await fireEvent.press(screen.getByTestId('verify-integrity'));
    await waitFor(() => expect(screen.getByTestId('integrity-result').props.children).toMatch(/Log problem at entry #2: record content does not match its hash/));
  });

  it('explains location status honestly and can request it', async () => {
    const h = await renderWithHarness(<SettingsScreen />);
    expect(screen.getByTestId('location-status').props.children).toMatch(/Off\. You can still log work and rest by hand/);
    h.location.grant = { foreground: true, background: false };
    await fireEvent.press(screen.getByTestId('settings-enable-location'));
    await waitFor(() => expect(screen.getByTestId('location-status').props.children).toMatch(/while the app is open only/));
  });

  it('exports the log as JSON through the share sheet', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    const h = await renderWithHarness(<SettingsScreen />);
    await act(async () => {
      await h.controller.startWork();
    });
    await fireEvent.press(screen.getByTestId('export-log'));
    await waitFor(() => expect(share).toHaveBeenCalled());
    const payload = JSON.parse(share.mock.calls[0]![0].message as string);
    expect(payload.integrity.ok).toBe(true);
    expect(payload.rulesetVersion).toMatch(/^1\.0\.0\+nhvr/);
    expect(payload.events.map((e: { type: string }) => e.type)).toEqual(['profile', 'state_change']);
    share.mockRestore();
  });
});

describe('History and corrections', () => {
  async function withEntries() {
    const h = await renderWithHarness(<HistoryScreen />);
    await act(async () => {
      await h.controller.startWork();
    });
    await advance(h, 60);
    await act(async () => {
      await h.controller.startRest();
    });
    await advance(h, 30);
    return h;
  }

  it('lists entries newest first and explains that nothing is edited', async () => {
    await withEntries();
    expect(screen.getByText(/never changed or removed/)).toBeTruthy();
    expect(screen.getAllByText(/^(Work|Rest) from/)).toHaveLength(2);
  });

  it('a correction needs a reason', async () => {
    const h = await withEntries();
    await fireEvent.press(screen.getByTestId('correct-2'));
    await fireEvent.press(screen.getByTestId('correct-earlier'));
    expect(screen.getByText('Enter a reason for the correction.')).toBeTruthy();
    expect((await h.store.list()).filter((e) => e.type === 'correction')).toHaveLength(0);
  });

  it('a correction is appended as a new event with a reason; the original entry is untouched', async () => {
    const h = await withEntries();
    const before = JSON.stringify((await h.store.list())[2]);
    await fireEvent.press(screen.getByTestId('correct-3'));
    await fireEvent.changeText(screen.getByLabelText('Reason for correction'), 'Forgot to tap Rest when I stopped');
    await fireEvent.press(screen.getByTestId('correct-earlier'));
    await waitFor(async () => expect((await h.store.list()).filter((e) => e.type === 'correction')).toHaveLength(1));
    const list = await h.store.list();
    expect(JSON.stringify(list[2])).toBe(before);
    const c = list.at(-1)!;
    expect(c.type).toBe('correction');
    expect(c.payload).toMatchObject({ targetSeq: 3, reason: 'Forgot to tap Rest when I stopped', replacement: { state: 'rest', at: '2026-11-15T20:45:00.000Z' } });
    expect((await h.store.verify()).ok).toBe(true);
    // the projection uses the corrected time
    expect(h.controller.getSnapshot().entries.find((e) => e.seq === 3)).toMatchObject({ at: '2026-11-15T20:45:00.000Z', correctedBySeq: c.seq });
    await waitFor(() => expect(screen.getByText(/\(corrected\)/)).toBeTruthy());
  });

  it('withdrawing an entry adds a void correction; the entry stays in the log but leaves the projection', async () => {
    const h = await withEntries();
    await fireEvent.press(screen.getByTestId('correct-3'));
    await fireEvent.changeText(screen.getByLabelText('Reason for correction'), 'Tapped by mistake');
    await fireEvent.press(screen.getByTestId('correct-void'));
    await waitFor(() => expect(h.controller.getSnapshot().entries).toHaveLength(1));
    expect((await h.store.list()).filter((e) => e.type === 'state_change')).toHaveLength(2);
  });
});
