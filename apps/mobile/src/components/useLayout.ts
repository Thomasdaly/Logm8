import { useWindowDimensions } from 'react-native';

/** Width from which tablet layouts (iPad / Android tablets, or a phone in landscape on large phones) are used. */
export const WIDE_BREAKPOINT = 840;

export interface LayoutInfo {
  width: number;
  isWide: boolean;
  isLandscape: boolean;
  /** Maximum width of the content column. */
  contentMaxWidth: number;
  /** Hours shown per row of the timeline (24 in a single row on wide screens). */
  hoursPerRow: number;
  countdownFontSize: number;
}

export function layoutFor(width: number, height: number): LayoutInfo {
  const isWide = width >= WIDE_BREAKPOINT;
  return {
    width,
    isWide,
    isLandscape: width > height,
    contentMaxWidth: isWide ? 1180 : 640,
    hoursPerRow: isWide ? 24 : 12,
    countdownFontSize: isWide ? 112 : width < 360 ? 52 : 64,
  };
}

/** Responsive layout info. Re-evaluated on rotation and iPad split-view resizing. */
export function useLayout(): LayoutInfo {
  const { width, height } = useWindowDimensions();
  return layoutFor(width, height);
}
