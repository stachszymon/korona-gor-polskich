import { describe, expect, it } from 'vitest';
import {
  PeakDetailSchema,
  PeaksIndexSchema,
  PTTK_COLORS,
  TRAILHEAD_KINDS,
} from './schema';

// Example from spec section 3.2, verbatim (its coordinates are abbreviated).
const specPeakDetail = {
  peakId: 'babia-gora',
  trails: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { colors: ['red'], name: 'Główny Szlak Beskidzki' },
        geometry: { type: 'LineString', coordinates: [[19.5, 49.57]] },
      },
    ],
  },
  routes: [
    {
      id: 'babia-gora--zawoja-markowa',
      name: 'Z Zawoi Markowej',
      trailhead: { name: 'Zawoja Markowa', lat: 49.6, lon: 19.5, kind: 'parking' },
      distanceKm: 7.4,
      ascentM: 980,
      descentM: 40,
      durationMin: 210,
      colors: ['red', 'yellow'],
      geometry: { type: 'LineString', coordinates: [[19.5, 49.6, 870]] },
      profile: [
        [0, 870],
        [25, 872],
      ],
    },
  ],
};

const specPeaksIndex = {
  generatedAt: '2026-10-15T12:00:00Z',
  peaks: [
    {
      id: 'babia-gora',
      name: 'Babia Góra',
      range: 'Beskid Żywiecki',
      elevation: 1725,
      lat: 49.5732,
      lon: 19.5294,
      routeCount: 3,
    },
  ],
};

const clone = <T>(value: T): T => structuredClone(value);

const first = <T>(items: T[]): T => {
  const item = items[0];
  if (item === undefined) throw new Error('empty array');
  return item;
};

describe('PeakDetailSchema', () => {
  it('accepts the spec example peak detail', () => {
    const parsed = PeakDetailSchema.parse(specPeakDetail);
    expect(parsed.peakId).toBe('babia-gora');
    expect(first(parsed.routes).trailhead.kind).toBe('parking');
  });

  it('rejects route coordinates without elevation', () => {
    const bad = clone(specPeakDetail);
    first(bad.routes).geometry.coordinates = [[19.5, 49.6]];
    expect(() => PeakDetailSchema.parse(bad)).toThrow();
  });

  it('rejects unknown trail color', () => {
    const bad = clone(specPeakDetail);
    first(bad.trails.features).properties.colors = ['purple'];
    expect(() => PeakDetailSchema.parse(bad)).toThrow();
  });

  it('rejects unknown route color and empty color lists', () => {
    const unknown = clone(specPeakDetail);
    first(unknown.routes).colors = ['orange'];
    expect(() => PeakDetailSchema.parse(unknown)).toThrow();

    const empty = clone(specPeakDetail);
    first(empty.routes).colors = [];
    expect(() => PeakDetailSchema.parse(empty)).toThrow();
  });

  it('rejects more than 3 routes', () => {
    const bad = clone(specPeakDetail);
    bad.routes = [0, 1, 2, 3].map((i) => ({
      ...clone(first(specPeakDetail.routes)),
      id: `babia-gora--start-${i}`,
    }));
    expect(() => PeakDetailSchema.parse(bad)).toThrow();
  });

  it('accepts exactly 3 routes', () => {
    const ok = clone(specPeakDetail);
    ok.routes = [0, 1, 2].map((i) => ({
      ...clone(first(specPeakDetail.routes)),
      id: `babia-gora--start-${i}`,
    }));
    expect(PeakDetailSchema.parse(ok).routes).toHaveLength(3);
  });

  it('rejects a route id without the peak--start separator', () => {
    const bad = clone(specPeakDetail);
    first(bad.routes).id = 'babia-gora';
    expect(() => PeakDetailSchema.parse(bad)).toThrow();
  });

  it('rejects an unknown trailhead kind', () => {
    const bad = clone(specPeakDetail);
    first(bad.routes).trailhead.kind = 'helipad';
    expect(() => PeakDetailSchema.parse(bad)).toThrow();
  });

  it('rejects a profile with fewer than 2 points', () => {
    const bad = clone(specPeakDetail);
    first(bad.routes).profile = [[0, 870]];
    expect(() => PeakDetailSchema.parse(bad)).toThrow();
  });

  it('rejects a non-integer duration', () => {
    const bad = clone(specPeakDetail);
    first(bad.routes).durationMin = 210.5;
    expect(() => PeakDetailSchema.parse(bad)).toThrow();
  });

  it('allows a trail feature without a name', () => {
    const ok = clone(specPeakDetail);
    first(ok.trails.features).properties = { colors: ['red'] } as never;
    expect(() => PeakDetailSchema.parse(ok)).not.toThrow();
  });
});

describe('PeaksIndexSchema', () => {
  it('accepts the spec example peaks index', () => {
    expect(PeaksIndexSchema.parse(specPeaksIndex).peaks).toHaveLength(1);
  });

  it('rejects a non-ISO generatedAt', () => {
    expect(() => PeaksIndexSchema.parse({ ...specPeaksIndex, generatedAt: 'yesterday' })).toThrow();
  });

  it('rejects an id with uppercase letters or spaces', () => {
    const bad = clone(specPeaksIndex);
    first(bad.peaks).id = 'Babia Gora';
    expect(() => PeaksIndexSchema.parse(bad)).toThrow();
  });

  it('rejects routeCount above 3 or below 0', () => {
    for (const routeCount of [4, -1]) {
      const bad = clone(specPeaksIndex);
      first(bad.peaks).routeCount = routeCount;
      expect(() => PeaksIndexSchema.parse(bad)).toThrow();
    }
  });

  it('rejects a fractional elevation', () => {
    const bad = clone(specPeaksIndex);
    first(bad.peaks).elevation = 1725.5;
    expect(() => PeaksIndexSchema.parse(bad)).toThrow();
  });
});

describe('constants', () => {
  it('exports the PTTK colors and trailhead kinds', () => {
    expect(PTTK_COLORS).toEqual(['red', 'blue', 'green', 'yellow', 'black']);
    expect(TRAILHEAD_KINDS).toEqual(['parking', 'station', 'bus_stop', 'place', 'manual']);
  });
});
