/** Normalised box [x, y, width, height], as fractions of the sheet's width and height. */
export type Box = [number, number, number, number];

export type CellState = 'work' | 'rest' | 'none';

export type SheetVersionId = 'v1.4' | 'pre-2026';

export interface TemplateField {
  id: string;
  label: string;
  kind: 'text' | 'date' | 'signature';
  box: Box;
}

export interface CheckboxGroup {
  id: string;
  label: string;
  /** false when the printed sheet has no box outline (e.g. the optional "Day" letters on v1.4). */
  outlined: boolean;
  options: Array<{ value: string; box: Box }>;
}

/** Geometry of a daily sheet, as data (normalised to the printed page). */
export interface SheetTemplate {
  id: SheetVersionId;
  name: string;
  /** Page width / height. */
  aspect: number;
  source: string;
  calibration: string;
  validFrom: string | null;
  note: string;
  grid: {
    x0: number;
    x1: number;
    workTop: number;
    split: number;
    restBottom: number;
    hours: number;
    cellsPerHour: number;
    shadedHours: Array<[number, number]>;
    labelLeft: number;
    totalsRight: number;
  };
  activities: { top: number; odometerTop: number; placeTop: number; twoUpTop: number; labelsTop: number; bottom: number };
  fields: TemplateField[];
  checkboxGroups: CheckboxGroup[];
}

/** Single-channel image, 0 = black, 1 = white. */
export interface GrayImage {
  width: number;
  height: number;
  data: Float32Array;
}

/** 8-bit RGBA image (e.g. a decoded JPEG). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export interface Point {
  x: number;
  y: number;
}

/** Page corners in image pixels: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];
