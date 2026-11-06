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
        properties: {
          colors: ['red'],
          name: 'Główny Szlak Beskidzki',
          relations: [{ id: 1234, name: 'Główny Szlak Beskidzki', color: 'red' }],
        },
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
      legs: [
        { color: 'red', lengthM: 5200 },
        { color: 'yellow', lengthM: 2200 },
      ],
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

  it('trail feature without relations is rejected', () => {
    const missing = clone(specPeakDetail) as typeof specPeakDetail;
    delete (first(missing.trails.features).properties as { relations?: unknown }).relations;
    expect(() => PeakDetailSchema.parse(missing)).toThrow();

    const empty = clone(specPeakDetail);
    first(empty.trails.features).properties.relations = [];
    expect(() => PeakDetailSchema.parse(empty)).toThrow();
  });

  it('accepts a relation without a name', () => {
    const ok = clone(specPeakDetail);
    first(ok.trails.features).properties.relations = [{ id: 7, color: 'red' } as never];
    expect(PeakDetailSchema.parse(ok).trails.features[0]!.properties.relations).toEqual([
      { id: 7, color: 'red' },
    ]);
  });

  it('rejects a relation without a colour', () => {
    const bad = clone(specPeakDetail);
    first(bad.trails.features).properties.relations = [{ id: 7, name: 'Szlak' } as never];
    expect(() => PeakDetailSchema.parse(bad)).toThrow();
  });

  it('rejects a relation with a non-integer id', () => {
    const bad = clone(specPeakDetail);
    first(bad.trails.features).properties.relations = [{ id: 1.5, color: 'red' } as never];
    expect(() => PeakDetailSchema.parse(bad)).toThrow();
  });

  it('route without legs is rejected', () => {
    const bad = clone(specPeakDetail) as Record<string, unknown> & typeof specPeakDetail;
    delete (first(bad.routes) as { legs?: unknown }).legs;
    expect(() => PeakDetailSchema.parse(bad)).toThrow();
  });

  it('leg with colour none is accepted', () => {
    const ok = clone(specPeakDetail);
    first(ok.routes).legs = [
      { color: 'red', lengthM: 6000 },
      { color: 'none', lengthM: 1400 },
    ];
    expect(PeakDetailSchema.parse(ok).routes[0]!.legs[1]!.color).toBe('none');
  });

  it('rejects an empty legs list, an unknown leg colour and a negative leg length', () => {
    const empty = clone(specPeakDetail);
    first(empty.routes).legs = [];
    expect(() => PeakDetailSchema.parse(empty)).toThrow();

    const unknown = clone(specPeakDetail);
    first(unknown.routes).legs = [{ color: 'orange', lengthM: 100 }];
    expect(() => PeakDetailSchema.parse(unknown)).toThrow();

    const negative = clone(specPeakDetail);
    first(negative.routes).legs = [{ color: 'red', lengthM: -10 }];
    expect(() => PeakDetailSchema.parse(negative)).toThrow();
  });

  it('rejects more than 20 routes', () => {
    const bad = clone(specPeakDetail);
    bad.routes = Array.from({ length: 21 }, (_, i) => ({
      ...clone(first(specPeakDetail.routes)),
      id: `babia-gora--start-${i}`,
    }));
    expect(() => PeakDetailSchema.parse(bad)).toThrow();
  });

  it('accepts exactly 20 routes', () => {
    const ok = clone(specPeakDetail);
    ok.routes = Array.from({ length: 20 }, (_, i) => ({
      ...clone(first(specPeakDetail.routes)),
      id: `babia-gora--start-${i}`,
    }));
    expect(PeakDetailSchema.parse(ok).routes).toHaveLength(20);
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
    first(ok.trails.features).properties = { colors: ['red'], relations: [{ id: 1, color: 'red' }] } as never;
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

  it('rejects routeCount above 20 or below 0', () => {
    for (const routeCount of [21, -1]) {
      const bad = clone(specPeaksIndex);
      first(bad.peaks).routeCount = routeCount;
      expect(() => PeaksIndexSchema.parse(bad)).toThrow();
    }
  });

  it('accepts routeCount 20', () => {
    const ok = clone(specPeaksIndex);
    first(ok.peaks).routeCount = 20;
    expect(() => PeaksIndexSchema.parse(ok)).not.toThrow();
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
