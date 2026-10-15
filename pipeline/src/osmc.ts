import { PTTK_COLORS, type PttkColor } from '../../src/data/schema';

const isPttkColor = (value: string): value is PttkColor =>
  (PTTK_COLORS as readonly string[]).includes(value);

/**
 * PTTK color of a hiking relation: the first part of `osmc:symbol`
 * (e.g. `red:white:red_bar`), or the `colour` tag when there is no symbol.
 * Returns null for colors outside the PTTK palette.
 */
export function trailColor(tags: Record<string, string>): PttkColor | null {
  const symbol = tags['osmc:symbol'];
  const raw = symbol !== undefined ? symbol.split(':')[0] : tags['colour'];
  const color = raw?.trim().toLowerCase();
  return color !== undefined && isPttkColor(color) ? color : null;
}
