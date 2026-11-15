import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { DrivingLock } from '../src/components/DrivingLock';
import { AppProvider, useController } from '../src/state/AppProvider';
import { makeHarness } from './helpers/fakes';

const mockDefineTask = jest.fn();
const mockLocation = {
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
};
jest.mock('expo-location', () => mockLocation);
jest.mock('expo-task-manager', () => ({ defineTask: (...a: unknown[]) => mockDefineTask(...a) }));

const { expoLocation, toSample } = require('../src/platform/location') as typeof import('../src/platform/location');
const defineCall = mockDefineTask.mock.calls[0];
const taskExecutor = defineCall?.[1] as (b: { data?: { locations: unknown[] }; error?: unknown }) => Promise<void>;

const loc = (speed: number | null, t = 1_000) => ({ timestamp: t, coords: { latitude: -27.5, longitude: 153, accuracy: 7, speed } });

describe('expo-location adapter', () => {
  beforeEach(() => jest.clearAllMocks());

  it('converts a location to a sample: m/s -> km/h, unknown speed -> null, GNSS time kept as trusted fix time', () => {
    expect(toSample(loc(10) as never)).toEqual({ t: 1000, speedKmh: 36, fix: { lat: -27.5, lon: 153, accuracyM: 7, fixTime: '1970-01-01T00:00:01.000Z' } });
    expect(toSample(loc(-1) as never).speedKmh).toBeNull();
    expect(toSample({ timestamp: 5, coords: { latitude: 1, longitude: 2, accuracy: null, speed: null } } as never).fix?.accuracyM).toBeNull();
  });

  it('registers the background task at import time and forwards its locations to the listener', async () => {
    expect(defineCall?.[0]).toBe('logm8-background-location');
    expect(typeof taskExecutor).toBe('function');
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ granted: true });
    mockLocation.getBackgroundPermissionsAsync.mockResolvedValue({ granted: false });
    mockLocation.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
    mockLocation.watchPositionAsync.mockResolvedValue({ remove: jest.fn() });
    const got: unknown[] = [];
    await expoLocation.start((s) => got.push(s));
    await taskExecutor({ data: { locations: [loc(20, 2000), loc(0, 3000)] } });
    await taskExecutor({ error: new Error('x') });
    expect(got).toHaveLength(2);
    await expoLocation.stop();
  });

  it('reads permissions without prompting', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ granted: true });
    mockLocation.getBackgroundPermissionsAsync.mockResolvedValue({ granted: true });
    expect(await expoLocation.getPermissions()).toEqual({ foreground: true, background: true });
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ granted: false });
    expect(await expoLocation.getPermissions()).toEqual({ foreground: false, background: false });
    expect(mockLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks for foreground first and only then for background; declining either is fine', async () => {
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ granted: false });
    expect(await expoLocation.requestPermissions()).toEqual({ foreground: false, background: false });
    expect(mockLocation.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ granted: true });
    mockLocation.requestBackgroundPermissionsAsync.mockResolvedValue({ granted: false });
    expect(await expoLocation.requestPermissions()).toEqual({ foreground: true, background: false });
    mockLocation.requestBackgroundPermissionsAsync.mockResolvedValue({ granted: true });
    expect(await expoLocation.requestPermissions()).toEqual({ foreground: true, background: true });
  });

  it('with background permission: starts the OS location task with a foreground service (Android) and the background indicator (iOS)', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ granted: true });
    mockLocation.getBackgroundPermissionsAsync.mockResolvedValue({ granted: true });
    mockLocation.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
    await expoLocation.start(() => undefined);
    expect(mockLocation.startLocationUpdatesAsync).toHaveBeenCalledWith('logm8-background-location', expect.objectContaining({ showsBackgroundLocationIndicator: true, foregroundService: expect.objectContaining({ notificationTitle: expect.any(String) }) }));
    expect(mockLocation.watchPositionAsync).not.toHaveBeenCalled();
    mockLocation.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    await expoLocation.start(() => undefined);
    expect(mockLocation.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    await expoLocation.stop();
    expect(mockLocation.stopLocationUpdatesAsync).toHaveBeenCalled();
  });

  it('without background permission: degrades to foreground-only watching', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ granted: true });
    mockLocation.getBackgroundPermissionsAsync.mockResolvedValue({ granted: false });
    const remove = jest.fn();
    mockLocation.watchPositionAsync.mockImplementation(async (_o: unknown, cb: (l: unknown) => void) => {
      cb(loc(5));
      return { remove };
    });
    const got: unknown[] = [];
    await expoLocation.start((s) => got.push(s));
    expect(mockLocation.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(got).toHaveLength(1);
    mockLocation.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
    await expoLocation.stop();
    expect(remove).toHaveBeenCalled();
  });

  it('with no permission at all, start does nothing', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ granted: false });
    await expoLocation.start(() => undefined);
    expect(mockLocation.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(mockLocation.watchPositionAsync).not.toHaveBeenCalled();
  });
});

describe('AppProvider', () => {
  function Probe() {
    useController();
    return <Text>ready</Text>;
  }

  it('creates the controller, shows nothing interactive until it is ready, then renders children', async () => {
    const h = await makeHarness();
    await render(
      <AppProvider create={async () => h.controller}>
        <Probe />
      </AppProvider>,
    );
    await waitFor(() => expect(screen.getByText('ready')).toBeTruthy());
  });

  it('shows a clear message if the local database cannot be opened', async () => {
    await render(
      <AppProvider create={async () => Promise.reject(new Error('disk full'))}>
        <Probe />
      </AppProvider>,
    );
    await waitFor(() => expect(screen.getByText('LogM8 could not open its local database.')).toBeTruthy());
    expect(screen.getByText('disk full')).toBeTruthy();
  });
});

describe('DrivingLock', () => {
  it('is read-only: no buttons, only countdown, banner and a note about pending suggestions', async () => {
    const h = await makeHarness();
    await h.controller.enableLocation();
    await h.controller.startWork();
    for (let i = 0; i < 3; i++) {
      h.clock.advance(1);
      h.location.emit(h.clock, 70);
    }
    await render(<DrivingLock snap={h.controller.getSnapshot()} />);
    expect(screen.getByText('Controls are locked while the vehicle is moving.')).toBeTruthy();
    expect(screen.getByTestId('countdown')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
