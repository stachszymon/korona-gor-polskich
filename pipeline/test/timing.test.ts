import { describe, expect, it } from 'vitest';
import { estimateDurationMin } from '../src/timing';

describe('estimateDurationMin', () => {
  it('uses 4 km/h + 600 m/h ascent, rounded to 5 min', () => {
    expect(estimateDurationMin(7.4, 980)).toBe(210); // 3.4833 h = 209 min → 210
  });

  it('is zero for no distance and no ascent', () => {
    expect(estimateDurationMin(0, 0)).toBe(0);
  });

  it('rounds to the nearest 5 minutes', () => {
    expect(estimateDurationMin(1, 0)).toBe(15); // 15 min
    expect(estimateDurationMin(1.1, 0)).toBe(15); // 16.5 → 15
    expect(estimateDurationMin(1.3, 0)).toBe(20); // 19.5 → 20
  });

  it('accounts for ascent alone', () => {
    expect(estimateDurationMin(0, 600)).toBe(60);
  });
});
