import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { DISCLAIMER } from '../src/lib/copy';
import { OnboardingScreen } from '../src/screens/OnboardingScreen';
import { mockRouter } from '../jest.setup';
import { renderWithHarness } from './helpers/render';

async function fill(field: string, text: string) {
  await fireEvent.changeText(screen.getByLabelText(field), text);
}

describe('Onboarding', () => {
  it('shows the legal-record disclaimer first and hides the form until it is acknowledged', async () => {
    await renderWithHarness(<OnboardingScreen />, { profile: null });
    expect(screen.getByText(DISCLAIMER)).toBeTruthy();
    expect(screen.getByText(/not an Electronic Work Diary/)).toBeTruthy();
    expect(screen.queryByLabelText('Registration')).toBeNull();
    await fireEvent.press(screen.getByText('I understand'));
    expect(screen.getByLabelText('Registration')).toBeTruthy();
  });

  it('collects scheme, two-up, base + base time zone, rego and WWD number and saves them as a profile event', async () => {
    const h = await renderWithHarness(<OnboardingScreen />, { profile: null });
    await fireEvent.press(screen.getByText('I understand'));
    await fireEvent.press(screen.getByText('BFM (transitional)'));
    expect(screen.getByText(/current BFM accreditation/)).toBeTruthy();
    await fireEvent(screen.getByLabelText('Two-up driving'), 'valueChange', true);
    await fill('Base', '  Toowoomba ');
    await fireEvent.press(screen.getByLabelText('QLD'));
    expect(screen.getByText(/Australia\/Brisbane/)).toBeTruthy();
    await fill('Registration', 'abc 123');
    await fill('Written Work Diary number', 'WWD-777');
    await fireEvent.press(screen.getByTestId('save-profile'));

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
    const events = await h.store.list();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('profile');
    expect(events[0]?.payload).toEqual({
      profile: { schemeFamily: 'bfm', twoUp: true, baseName: 'Toowoomba', baseState: 'QLD', baseTimeZone: 'Australia/Brisbane', rego: 'ABC 123', wwdNumber: 'WWD-777', recordingMode: 'written' },
    });
    expect(h.controller.getSnapshot().profile?.baseTimeZone).toBe('Australia/Brisbane');
  });

  it('uses the base state to pick the time zone (Adelaide)', async () => {
    const h = await renderWithHarness(<OnboardingScreen />, { profile: null });
    await fireEvent.press(screen.getByText('I understand'));
    await fill('Base', 'Port Augusta');
    await fireEvent.press(screen.getByLabelText('SA'));
    await fill('Registration', 'S123ABC');
    await fill('Written Work Diary number', '1');
    await fireEvent.press(screen.getByTestId('save-profile'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    expect(h.controller.getSnapshot().profile).toMatchObject({ baseTimeZone: 'Australia/Adelaide', schemeFamily: 'standard', twoUp: false });
  });

  it('validates required fields and writes nothing when they are missing', async () => {
    const h = await renderWithHarness(<OnboardingScreen />, { profile: null });
    await fireEvent.press(screen.getByText('I understand'));
    await fireEvent.press(screen.getByTestId('save-profile'));
    expect(screen.getByText('Enter your base (town or depot).')).toBeTruthy();
    expect(screen.getByText('Choose the state your base is in.')).toBeTruthy();
    expect(screen.getByText('Enter the vehicle registration.')).toBeTruthy();
    expect(screen.getByText('Enter your Written Work Diary number.')).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(await h.store.list()).toHaveLength(0);
  });

  it('says WA and NT are not supported and offers no WA/NT base', async () => {
    await renderWithHarness(<OnboardingScreen />, { profile: null });
    await fireEvent.press(screen.getByText('I understand'));
    expect(screen.getByText(/Western Australia and Northern Territory are not supported/)).toBeTruthy();
    expect(screen.queryByLabelText('WA')).toBeNull();
    expect(screen.queryByLabelText('NT')).toBeNull();
  });

  it('asks for location only when the driver taps the button, after explaining why', async () => {
    const h = await renderWithHarness(<OnboardingScreen />, { profile: null });
    await fireEvent.press(screen.getByText('I understand'));
    expect(screen.getByText(/only to measure speed/)).toBeTruthy();
    expect(h.location.requestCalls).toBe(0);
    await fireEvent.press(screen.getByTestId('enable-location'));
    await waitFor(() => expect(h.location.requestCalls).toBe(1));
  });

  it('still lets the driver finish setup if location is declined', async () => {
    const h = await renderWithHarness(<OnboardingScreen />, { profile: null });
    h.location.grant = { foreground: false, background: false };
    await fireEvent.press(screen.getByText('I understand'));
    await fireEvent.press(screen.getByTestId('enable-location'));
    await waitFor(() => expect(h.controller.getSnapshot().locationStatus).toBe('denied'));
    await fill('Base', 'Sydney');
    await fireEvent.press(screen.getByLabelText('NSW'));
    await fill('Registration', 'AB12CD');
    await fill('Written Work Diary number', '9');
    await fireEvent.press(screen.getByTestId('save-profile'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
  });
});
