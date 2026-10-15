import { describe, expect, it } from 'vitest';
import {
  haversineM,
  lineLengthM,
  resample,
  roundCoord,
  simplifyLine,
  type LonLat,
} from '../src/geo';

describe('haversineM', () => {
  it('computes Babia Góra → Rysy distance (~59.6 km)', () => {
    expect(haversineM([19.5294, 49.5732], [20.0881, 49.1795])).toBeCloseTo(59_600, -3);
  });

  it('is zero for identical points', () => {
    expect(haversineM([19, 50], [19, 50])).toBe(0);
  });
});

describe('lineLengthM', () => {
  it('sums segment lengths', () => {
    const a: LonLat = [0, 0];
    const b: LonLat = [0, 0.001];
    const c: LonLat = [0, 0.002];
    expect(lineLengthM([a, b, c])).toBeCloseTo(haversineM(a, b) + haversineM(b, c), 6);
  });

  it('is zero for fewer than two points', () => {
    expect(lineLengthM([])).toBe(0);
    expect(lineLengthM([[1, 1]])).toBe(0);
  });
});

describe('resample', () => {
  it('returns points every stepM plus the last point', () => {
    const out = resample(
      [
        [0, 0],
        [0, 0.001],
      ],
      25,
    );
    expect(out.length).toBe(6); // 111 m → 0,25,50,75,100,111
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([0, 0.001]);
  });

  it('keeps first and last point for lines shorter than the step', () => {
    const out = resample(
      [
        [0, 0],
        [0, 0.0001],
      ],
      25,
    );
    expect(out).toEqual([
      [0, 0],
      [0, 0.0001],
    ]);
  });

  it('walks across multiple segments at even spacing', () => {
    const out = resample(
      [
        [0, 0],
        [0, 0.0005],
        [0, 0.001],
      ],
      25,
    );
    expect(out.length).toBe(6);
    expect(haversineM(out[1]!, out[0]!)).toBeCloseTo(25, 0);
    expect(haversineM(out[4]!, out[3]!)).toBeCloseTo(25, 0);
  });

  it('does not duplicate the last point when length is an exact multiple of step', () => {
    const step = haversineM([0, 0], [0, 0.0005]);
    const out = resample(
      [
        [0, 0],
        [0, 0.001],
      ],
      step,
    );
    expect(out.length).toBe(3);
  });

  it('handles degenerate input', () => {
    expect(resample([], 25)).toEqual([]);
    expect(resample([[1, 2]], 25)).toEqual([[1, 2]]);
  });
});

describe('simplifyLine', () => {
  it('drops collinear points and keeps endpoints', () => {
    const line: LonLat[] = [
      [0, 0],
      [0, 0.0005],
      [0, 0.001],
    ];
    expect(simplifyLine(line, 5)).toEqual([
      [0, 0],
      [0, 0.001],
    ]);
  });

  it('keeps points that deviate more than the tolerance', () => {
    const line: LonLat[] = [
      [0, 0],
      [0.001, 0.0005], // ~111 m off the straight line
      [0, 0.001],
    ];
    expect(simplifyLine(line, 5)).toHaveLength(3);
  });

  it('removes points that deviate less than the tolerance', () => {
    const line: LonLat[] = [
      [0, 0],
      [0.00001, 0.0005], // ~1 m off
      [0, 0.001],
    ];
    expect(simplifyLine(line, 5)).toHaveLength(2);
  });
});

describe('roundCoord', () => {
  it('rounds to 5 digits by default', () => {
    expect(roundCoord(19.529412345)).toBe(19.52941);
  });

  it('accepts a custom digit count', () => {
    expect(roundCoord(19.529412345, 2)).toBe(19.53);
  });
});
