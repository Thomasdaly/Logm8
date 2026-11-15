import { HttpFieldReader, MockFieldReader, NullFieldReader } from '@logm8/diary-reader';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cellStartUtc } from '../../../packages/diary-reader/src/compare';
import { mockRouter } from '../jest.setup';
import { createFieldReader } from '../src/platform/fieldReader';
import { CaptureScreen } from '../src/screens/CaptureScreen';
import { HomeScreen } from '../src/screens/HomeScreen';
import { SheetResultScreen } from '../src/screens/SheetResultScreen';
import { DriverController } from '../src/state/controller';
import type { Harness } from './helpers/fakes';
import { renderWithHarness } from './helpers/render';

jest.setTimeout(120_000);

const mockGetSheetPhoto = jest.fn();
jest.mock('../src/platform/photo', () => ({ getSheetPhoto: (...a: unknown[]) => mockGetSheetPhoto(...a) }));

// The image pipeline is slow under Jest's Babel transform (full accuracy runs are in packages/diary-reader with
// Vitest). The real reader runs here, but each distinct photo + reader combination is read only once.
jest.mock('@logm8/diary-reader', () => {
  const actual = jest.requireActual('@logm8/diary-reader');
  const cache = new Map<string, unknown>();
  return {
    ...actual,
    readSheet: async (bytes: Uint8Array, opts?: { fieldReader?: object }) => {
      const key = `${bytes.length}:${bytes[100]}:${bytes[bytes.length - 100]}:${opts?.fieldReader?.constructor.name}`;
      if (!cache.has(key)) cache.set(key, await actual.readSheet(bytes, opts));
      return cache.get(key);
    },
  };
});

const TZ = 'Australia/Brisbane';
const FIX = join(__dirname, 'fixtures');
/** Synthetic photographed v1.4 sheet (diary-reader generator, seed 3036) that the reader reads exactly. */
const SHEET = {
  jpeg: new Uint8Array(readFileSync(join(FIX, 'sheet.jpg'))),
  truth: JSON.parse(readFileSync(join(FIX, 'sheet.json'), 'utf8')) as { date: string; cells: string[]; fields: Record<string, string | null> },
};
const NO_SHEET = new Uint8Array(readFileSync(join(FIX, 'no-sheet.jpg')));

/** Logs the sheet's schedule into the app (so the app log matches the sheet), then sets the clock to the end of the day. */
async function logTruth(h: Harness, cells: readonly string[], date: string, extraWorkAt?: number): Promise<void> {
  const want = [...cells];
  if (extraWorkAt !== undefined) for (let i = extraWorkAt; i < extraWorkAt + 4; i++) want[i] = 'work';
  for (let i = 0; i < 96; i++) {
    if (i > 0 && want[i] === want[i - 1]) continue;
    h.clock.ms = cellStartUtc(date, i, TZ);
    const r = want[i] === 'work' ? await h.controller.startWork() : await h.controller.startRest();
    if (!r.ok) throw new Error(r.message);
  }
  h.clock.ms = cellStartUtc(date, 96, TZ);
}

describe('photo check of a daily sheet (controller)', () => {
  it('reads the sheet, takes the date from the handwriting and finds no differences when the log matches', async () => {
    const h = await renderWithHarness(<></>);
    await logTruth(h, SHEET.truth.cells, SHEET.truth.date);
    const before = (await h.store.list()).length;
    const c = new DriverController({ store: h.store, clock: h.clock.now, speech: h.speech, location: h.location, appVersion: 'test', yieldToUi: () => Promise.resolve(), fieldReader: new MockFieldReader(SHEET.truth.fields) });
    await c.load();
    expect(await c.checkSheet(SHEET.jpeg)).toEqual({ ok: true });
    const s = c.getSnapshot().sheetCheck;
    expect(s?.status).toBe('done');
    if (s?.status !== 'done') return;
    expect(s.sheetDate).toBe(SHEET.truth.date);
    expect(s.dateSource).toBe('sheet');
    expect(s.handwritingRead).toBe(true);
    expect(s.result.cellDiffs).toEqual([]);
    expect(s.result.sheetCells).toEqual(SHEET.truth.cells);
    // a check never writes to the log
    expect((await h.store.list()).length).toBe(before);
  });

  it('reports the 15-minute blocks where the app log differs from the sheet', async () => {
    const h = await renderWithHarness(<></>);
    const restAt = SHEET.truth.cells.findIndex((c, i) => i > 4 && c === 'rest' && SHEET.truth.cells[i + 4] === 'rest' && SHEET.truth.cells[i - 1] === 'rest');
    await logTruth(h, SHEET.truth.cells, SHEET.truth.date, restAt);
    const c = new DriverController({ store: h.store, clock: h.clock.now, speech: h.speech, location: h.location, appVersion: 'test', yieldToUi: () => Promise.resolve(), fieldReader: new MockFieldReader(SHEET.truth.fields) });
    await c.load();
    await c.checkSheet(SHEET.jpeg);
    const s = c.getSnapshot().sheetCheck;
    if (s?.status !== 'done') throw new Error('not done');
    expect(s.result.cellDiffs.map((d) => d.cell)).toEqual([restAt, restAt + 1, restAt + 2, restAt + 3]);
    expect(s.result.diffRanges).toHaveLength(1);
    expect(s.result.diffRanges[0]).toMatchObject({ sheet: 'rest', app: 'work' });
  });

  it('without a handwriting reader the date defaults to today (base time) and the driver can change it', async () => {
    const h = await renderWithHarness(<></>);
    await h.controller.checkSheet(SHEET.jpeg);
    const s = h.controller.getSnapshot().sheetCheck;
    if (s?.status !== 'done') throw new Error('not done');
    expect(s.dateSource).toBe('today');
    expect(s.sheetDate).toBe('2026-11-16');
    expect(s.handwritingRead).toBe(false);
    h.controller.setSheetDate('2026-11-15');
    const s2 = h.controller.getSnapshot().sheetCheck;
    expect(s2?.status === 'done' && [s2.sheetDate, s2.dateSource]).toEqual(['2026-11-15', 'driver']);
    h.controller.setSheetDate('not a date');
    expect(h.controller.getSnapshot().sheetCheck).toBe(s2);
  });

  it('a photo without a sheet gives a clear error', async () => {
    const h = await renderWithHarness(<></>);
    const r = await h.controller.checkSheet(NO_SHEET);
    expect(r).toMatchObject({ ok: false });
    expect(h.controller.getSnapshot().sheetCheck).toMatchObject({ status: 'error', message: expect.stringMatching(/Could not find the daily sheet/) });
    expect(await h.controller.checkSheet(new Uint8Array([1, 2, 3]))).toMatchObject({ ok: false, message: expect.stringMatching(/decode/) });
    h.controller.clearSheetCheck();
    expect(h.controller.getSnapshot().sheetCheck).toBeNull();
  });
});

describe('photo check screens', () => {
  it('Capture: take a photo, read it and open the results', async () => {
    mockGetSheetPhoto.mockResolvedValueOnce({ ok: true, jpeg: SHEET.jpeg });
    await renderWithHarness(<CaptureScreen />);
    expect(screen.getByText(/Lay the sheet flat/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('take-photo'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/sheet-result'), { timeout: 20_000 });
    expect(mockGetSheetPhoto).toHaveBeenCalledWith('camera');
  });

  it('Capture: camera permission refused shows the reason; cancel shows nothing', async () => {
    mockGetSheetPhoto.mockResolvedValueOnce({ ok: false, reason: 'denied', message: 'Camera permission is needed' });
    await renderWithHarness(<CaptureScreen />);
    await fireEvent.press(screen.getByTestId('take-photo'));
    await waitFor(() => expect(screen.getByTestId('capture-error').props.children).toMatch(/Camera permission/));
    mockGetSheetPhoto.mockResolvedValueOnce({ ok: false, reason: 'cancelled', message: 'x' });
    await fireEvent.press(screen.getByTestId('choose-photo'));
    expect(mockGetSheetPhoto).toHaveBeenLastCalledWith('library');
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('Capture: a photo with no sheet in it shows the reader error', async () => {
    mockGetSheetPhoto.mockResolvedValueOnce({ ok: true, jpeg: NO_SHEET });
    await renderWithHarness(<CaptureScreen />);
    await fireEvent.press(screen.getByTestId('take-photo'));
    await waitFor(() => expect(screen.getByTestId('capture-error').props.children).toMatch(/Could not find the daily sheet/));
  });

  it('Results: grid comparison, differences, missing items, optional items not flagged, breaches', async () => {
    const h = await renderWithHarness(<SheetResultScreen />);
    // nothing logged: every recorded block differs
    expect((await h.controller.checkSheet(SHEET.jpeg)).ok).toBe(true);
    await waitFor(() => expect(screen.getByTestId('sheet-result')).toBeTruthy());
    expect(screen.getByTestId('grid-summary').props.children).toMatch(/of 96 blocks differ from your log/);
    expect(screen.getAllByTestId('diff-range').length).toBeGreaterThan(0);
    expect(screen.getByTestId('sheet-row').children).toHaveLength(96);
    expect(screen.getByText(/assumed today/)).toBeTruthy();
    expect(screen.getByTestId('not-required').props.children).toMatch(/optional since 1 August 2026/);
    expect(screen.getByTestId('sheet-breaches')).toBeTruthy();
    expect(screen.getByText(/Your Written Work Diary is your legal record/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('date-prev'));
    expect(screen.getByTestId('sheet-date').props.children.join('')).toContain('2026-11-15');
    await fireEvent.press(screen.getByTestId('date-next'));
    expect(screen.getByTestId('sheet-date').props.children.join('')).toContain('2026-11-16');
    await fireEvent.press(screen.getByTestId('check-another'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/capture');
    await fireEvent.press(screen.getByTestId('result-done'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });

  it('Results without a check redirect to the capture screen', async () => {
    await renderWithHarness(<SheetResultScreen />);
    expect(screen.getByTestId('redirect').props.children).toBe('redirect:/capture');
  });

  it('Home has a "Check diary page" entry', async () => {
    await renderWithHarness(<HomeScreen />);
    await fireEvent.press(screen.getByTestId('open-capture'));
    expect(mockRouter.push).toHaveBeenCalledWith('/capture');
  });
});

describe('field reader configuration (no API keys in the app)', () => {
  it('uses the server endpoint only when a URL is configured', () => {
    expect(createFieldReader(undefined)).toBeInstanceOf(NullFieldReader);
    expect(createFieldReader('ftp://nope')).toBeInstanceOf(NullFieldReader);
    expect(createFieldReader('https://api.example.test/v1/fields/read')).toBeInstanceOf(HttpFieldReader);
  });

  it('the mobile app source contains no API keys or vision-provider credentials', () => {
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        if (f.isDirectory()) walk(join(d, f.name));
        else if (/\.(ts|tsx|json)$/.test(f.name)) files.push(join(d, f.name));
      }
    };
    walk(join(__dirname, '..', 'src'));
    walk(join(__dirname, '..', 'app'));
    files.push(join(__dirname, '..', 'app.json'));
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/sk-ant-|ANTHROPIC_API_KEY|OPENAI_API_KEY|x-api-key|Bearer\s+[A-Za-z0-9]/i);
    }
  });
});

