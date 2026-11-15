import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { layoutFor, WIDE_BREAKPOINT } from '../src/components/useLayout';
import { HomeScreen } from '../src/screens/HomeScreen';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { act, advance, renderWithHarness } from './helpers/render';

const mockDims = { width: 820, height: 1180 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ ...mockDims, scale: 2, fontScale: 1 }),
}));

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('layoutFor', () => {
  it('uses tablet layouts from 840 pt wide: iPad landscape and iPad portrait in a wide split', () => {
    expect(WIDE_BREAKPOINT).toBe(840);
    expect(layoutFor(390, 844)).toMatchObject({ isWide: false, hoursPerRow: 12, contentMaxWidth: 640, countdownFontSize: 64, isLandscape: false });
    expect(layoutFor(1180, 820)).toMatchObject({ isWide: true, hoursPerRow: 24, contentMaxWidth: 1180, countdownFontSize: 112, isLandscape: true });
    expect(layoutFor(1024, 768).isWide).toBe(true);
    expect(layoutFor(834, 1194).isWide).toBe(false); // iPad Pro 11" portrait: single column, centred
    expect(layoutFor(320, 568).countdownFontSize).toBe(52); // small phones
  });
});

describe('iPad / tablet layout', () => {
  it('iPad portrait (820 pt): single column, content centred with a width cap', async () => {
    mockDims.width = 820;
    mockDims.height = 1180;
    await renderWithHarness(<HomeScreen />);
    expect(screen.queryByTestId('home-wide')).toBeNull();
    expect(screen.getByTestId('home').props.contentContainerStyle).toEqual(expect.arrayContaining([expect.objectContaining({ maxWidth: 640, alignSelf: 'center' })]));
  });

  it('iPad landscape (1180 pt): two columns, 24-hour timeline in one row, everything still works', async () => {
    mockDims.width = 1180;
    mockDims.height = 820;
    const h = await renderWithHarness(<HomeScreen />);
    expect(screen.getByTestId('home-wide')).toBeTruthy();
    expect(screen.getByTestId('home-left')).toBeTruthy();
    expect(screen.getByTestId('home-right')).toBeTruthy();
    // controls on the left, the day's record on the right
    expect(within(screen.getByTestId('home-left')).getByTestId('start-work')).toBeTruthy();
    expect(within(screen.getByTestId('home-right')).getByTestId('timeline')).toBeTruthy();
    expect(screen.getByTestId('timeline').children).toHaveLength(2); // one row of hours + the legend
    expect(screen.getAllByTestId(/^slot-/)).toHaveLength(96);
    expect(screen.getByTestId('home').props.contentContainerStyle).toEqual(expect.arrayContaining([expect.objectContaining({ maxWidth: 1180 })]));

    await fireEvent.press(screen.getByTestId('start-work'));
    await waitFor(() => expect(h.controller.getSnapshot().state).toBe('work'));
    await advance(h, 255);
    expect(screen.getByText('60 min to required rest')).toBeTruthy();
    expect(screen.getByTestId('countdown-time').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ fontSize: 112 })]));
  });

  it('phone portrait keeps the 12-hour rows (two rows)', async () => {
    mockDims.width = 390;
    mockDims.height = 844;
    await renderWithHarness(<HomeScreen />);
    expect(screen.getByTestId('timeline').children).toHaveLength(3); // two rows + legend
  });

  it('the driving lock is shown full-width and large on an iPad too', async () => {
    mockDims.width = 1180;
    mockDims.height = 820;
    const h = await renderWithHarness(<HomeScreen />);
    await act(async () => {
      await h.controller.enableLocation();
      h.location.emit(h.clock, 70);
    });
    expect(screen.getByTestId('driving-lock')).toBeTruthy();
    expect(screen.queryByTestId('start-work')).toBeNull();
  });

  it('a Wi-Fi-only iPad (no GPS, so no location at all) still works fully by hand', async () => {
    mockDims.width = 1180;
    mockDims.height = 820;
    const h = await renderWithHarness(<HomeScreen />);
    h.location.grant = { foreground: false, background: false };
    await act(async () => {
      await h.controller.enableLocation();
    });
    expect(h.controller.getSnapshot()).toMatchObject({ locationStatus: 'denied', speedKmh: null, interactionAllowed: true });
    await fireEvent.press(screen.getByTestId('start-work'));
    await waitFor(() => expect(h.controller.getSnapshot().state).toBe('work'));
    await fireEvent.press(screen.getByTestId('open-settings'));
  });

  it('settings render in the centred column on a tablet', async () => {
    mockDims.width = 1180;
    mockDims.height = 820;
    await renderWithHarness(<SettingsScreen />);
    expect(screen.getByTestId('settings').props.contentContainerStyle).toEqual(expect.arrayContaining([expect.objectContaining({ maxWidth: 1180 })]));
  });
});
