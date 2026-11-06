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

export const TERRAIN_EXAGGERATION = 1.8;
export const HILLSHADE_EXAGGERATION = 0.7;

/** Contour spacing per zoom level: `[minor, major]` elevation distance in metres. */
export const CONTOUR_THRESHOLDS: Record<number, [number, number]> = {
  11: [200, 1000],
  12: [100, 500],
  13: [50, 250],
  14: [20, 100],
};

/** Veil over everything outside the mountain areas, and the line drawn along their edge. */
export const MASK_FILL_HEX = '#f4f1ea';
export const MASK_FILL_OPACITY = 0.72;
export const MASK_OUTLINE_HEX = '#8a7a5a';
export const MASK_OUTLINE_WIDTH = 1.2;
export const MASK_OUTLINE_OPACITY = 0.55;
