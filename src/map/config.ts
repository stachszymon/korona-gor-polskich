import type { PttkColor } from '../data/schema';

export const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export const PTTK_HEX: Record<PttkColor, string> = {
  red: '#d32f2f',
  blue: '#1565c0',
  green: '#2e7d32',
  yellow: '#f9a825',
  black: '#212121',
};

export const STATUS_HEX = { done: '#2e7d32', planned: '#f9a825', todo: '#c62828' } as const;

export const TERRAIN_EXAGGERATION = 1.3;

/** Contour spacing per zoom level: `[minor, major]` elevation distance in metres. */
export const CONTOUR_THRESHOLDS: Record<number, [number, number]> = {
  11: [200, 1000],
  12: [100, 500],
  13: [50, 250],
  14: [20, 100],
};
