import { describe, expect, it } from 'vitest';
import {
  clipLineToRadius,
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

describe('clipLineToRadius', () => {
  const C: LonLat = [19.5, 49.5];
  // ~1 km steps east along the parallel (1 degree of longitude ≈ 72.4 km at 49.5° N).
  const east = (km: number): LonLat => [19.5 + km / 72.43, 49.5];

  it('keeps a line that lies inside the circle unchanged', () => {
    const line = [east(0), east(1), east(2)];
    expect(clipLineToRadius(line, C, 5000)).toEqual([line]);
  });

  it('drops a line that lies completely outside', () => {
    expect(clipLineToRadius([east(6), east(7)], C, 5000)).toEqual([]);
  });

  it('cuts a leaving line at the circle', () => {
    const parts = clipLineToRadius([east(0), east(4), east(8)], C, 5000);
    expect(parts).toHaveLength(1);
    const part = parts[0]!;
    expect(part.slice(0, 2)).toEqual([east(0), east(4)]);
    expect(part).toHaveLength(3);
    expect(haversineM(C, part[2]!)).toBeCloseTo(5000, 0);
  });

  it('splits a line that leaves and re-enters into two parts', () => {
    const out: LonLat = [19.5 + 3 / 72.43, 49.5 + 9 / 111.2]; // ~9.5 km away
    const parts = clipLineToRadius([east(-3), out, east(3)], C, 5000);
    expect(parts).toHaveLength(2);
    expect(parts[0]![0]).toEqual(east(-3));
    expect(parts[1]!.at(-1)).toEqual(east(3));
    for (const part of parts) {
      for (const p of part) expect(haversineM(C, p)).toBeLessThanOrEqual(5000.5);
    }
  });

  it('keeps the inner piece of a segment crossing the circle twice', () => {
    const parts = clipLineToRadius([east(-8), east(8)], C, 5000);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveLength(2);
    expect(lineLengthM(parts[0]!)).toBeCloseTo(10_000, -1);
  });
});
