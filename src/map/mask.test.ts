import type { MultiPolygon, Position } from 'geojson';
import peaksFile from '../../public/data/peaks.json';
import { mountainAreas, outsideMask, pointInPolygon, ringsIntersect } from './mask';

const realPeaks = peaksFile.peaks;

/** Signed area of a ring in lon/lat space: positive for counter-clockwise rings. */
function signedArea(ring: Position[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    sum += x1! * y2! - x2! * y1!;
  }
  return sum / 2;
}

const inAny = (areas: MultiPolygon, lon: number, lat: number) => areas.coordinates.some((polygon) => pointInPolygon([lon, lat], polygon));

/** A peak `eastKm` east and `northKm` north of `origin` (flat-earth offsets, fine at these distances). */
function offset(origin: { lat: number; lon: number }, eastKm: number, northKm: number) {
  return {
    lat: origin.lat + northKm / 111.32,
    lon: origin.lon + eastKm / (111.32 * Math.cos((origin.lat * Math.PI) / 180)),
  };
}

const ORIGIN = { lat: 49.5, lon: 19.5 };

describe('mountainAreas', () => {
  it('returns no areas for no peaks', () => {
    expect(mountainAreas([])).toEqual({ type: 'MultiPolygon', coordinates: [] });
  });

  it('merges two peaks 10 km apart into one area', () => {
    const areas = mountainAreas([ORIGIN, offset(ORIGIN, 10, 0)]);
    expect(areas.type).toBe('MultiPolygon');
    expect(areas.coordinates).toHaveLength(1);
  });

  it('keeps two peaks 200 km apart as two areas', () => {
    const areas = mountainAreas([ORIGIN, offset(ORIGIN, 200, 0)]);
    expect(areas.coordinates).toHaveLength(2);
  });

  it('draws a single peak as a roughly 20 km radius area with a closed counter-clockwise ring', () => {
    const areas = mountainAreas([{ lat: 50, lon: 20 }]);
    const ring = areas.coordinates[0]![0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(signedArea(ring)).toBeGreaterThan(0);
    const lats = ring.map((p) => p[1]!);
    expect((Math.max(...lats) - Math.min(...lats)) * 111.32).toBeCloseTo(40, 0);
  });

  it('honours radiusKm and segments', () => {
    const small = mountainAreas([{ lat: 50, lon: 20 }], { radiusKm: 5, segments: 8 });
    // 8 distinct points plus the closing point
    expect(small.coordinates[0]![0]).toHaveLength(9);
    expect(inAny(small, 20, 50.1)).toBe(false);
    expect(inAny(small, 20, 50.03)).toBe(true);
  });

  it('rounds coordinates to 5 decimals', () => {
    const areas = mountainAreas([{ lat: 49.57302, lon: 19.52933 }]);
    for (const [lon, lat] of areas.coordinates[0]![0]!) {
      expect(Math.round(lon! * 1e5) / 1e5).toBe(lon);
      expect(Math.round(lat! * 1e5) / 1e5).toBe(lat);
    }
  });

  it('merges areas whose hulls overlap although no two peaks are within two radii', () => {
    // Two peaks 30 km apart form a stadium that reaches 16 km north of their midpoint; a third
    // peak 31 km north of the midpoint is 34 km from both (> 32 km) yet its circle dips into it.
    const west = ORIGIN;
    const east = offset(ORIGIN, 30, 0);
    const north = offset(ORIGIN, 15, 31);
    expect(mountainAreas([west, east, north], { radiusKm: 16 }).coordinates).toHaveLength(1);
  });

  it('keeps areas apart when the hulls only come close', () => {
    const west = ORIGIN;
    const east = offset(ORIGIN, 30, 0);
    const north = offset(ORIGIN, 15, 35);
    expect(mountainAreas([west, east, north], { radiusKm: 16 }).coordinates).toHaveLength(2);
  });
});

// A 16 km radius splits the Carpathians into six pieces and leaves Zakopane outside; from 20 km the
// peaks form the four expected mountain areas.
describe('mountainAreas with the real Korona Gor Polskich peaks', () => {
  const areas = mountainAreas(realPeaks);
  const groupOf = (peak: { lon: number; lat: number }) => areas.coordinates.findIndex((polygon) => pointInPolygon([peak.lon, peak.lat], polygon));
  const groups = new Map<number, string[]>();
  for (const peak of realPeaks) {
    const index = groupOf(peak);
    groups.set(index, [...(groups.get(index) ?? []), peak.id]);
  }

  it('has 28 peaks', () => {
    expect(realPeaks).toHaveLength(28);
  });

  it('puts every peak inside some area', () => {
    for (const peak of realPeaks) expect(groupOf(peak), peak.id).toBeGreaterThanOrEqual(0);
  });

  it('forms the expected four areas', () => {
    const composition = [...groups.values()].map((ids) => ids.slice().sort());
    expect(composition).toHaveLength(4);
    expect(areas.coordinates).toHaveLength(4);
    const byPeak = (id: string) => composition.find((ids) => ids.includes(id))!;
    expect(byPeak('sniezka')).toEqual(expect.arrayContaining(['sniezka', 'snieznik', 'sleza']));
    expect(byPeak('rysy')).toEqual(expect.arrayContaining(['rysy', 'babia-gora', 'turbacz', 'radziejowa', 'skrzyczne']));
    expect(byPeak('tarnica')).toEqual(['tarnica']);
    expect(byPeak('lysica')).toEqual(['lysica']);
    expect(composition.flat().sort()).toEqual(realPeaks.map((p) => p.id).sort());
  });

  it('has areas that do not intersect each other', () => {
    const rings = areas.coordinates.map((polygon) => polygon[0]!);
    for (let i = 0; i < rings.length; i++) {
      for (let j = i + 1; j < rings.length; j++) expect(ringsIntersect(rings[i]!, rings[j]!), `${i}/${j}`).toBe(false);
    }
  });

  it('leaves Krakow, Wroclaw and Warsaw outside every area', () => {
    expect(inAny(areas, 19.94, 50.06)).toBe(false);
    expect(inAny(areas, 17.03, 51.11)).toBe(false);
    expect(inAny(areas, 21.01, 52.23)).toBe(false);
  });

  it('keeps mountain towns inside', () => {
    expect(inAny(areas, 19.95, 49.3)).toBe(true); // Zakopane
    expect(inAny(areas, 15.75, 50.78)).toBe(true); // Karpacz
  });

  it('uses counter-clockwise outer rings', () => {
    for (const polygon of areas.coordinates) expect(signedArea(polygon[0]!)).toBeGreaterThan(0);
  });
});

describe('outsideMask', () => {
  const areas = mountainAreas([ORIGIN, offset(ORIGIN, 300, 0)]);
  const mask = outsideMask(areas);

  it('is one world polygon with a hole per area', () => {
    expect(areas.coordinates).toHaveLength(2);
    expect(mask.type).toBe('Polygon');
    expect(mask.coordinates).toHaveLength(1 + areas.coordinates.length);
    expect(mask.coordinates[0]).toEqual([
      [-180, -85],
      [180, -85],
      [180, 85],
      [-180, 85],
      [-180, -85],
    ]);
  });

  it('has a counter-clockwise outer ring and clockwise holes', () => {
    expect(signedArea(mask.coordinates[0]!)).toBeGreaterThan(0);
    for (const hole of mask.coordinates.slice(1)) expect(signedArea(hole)).toBeLessThan(0);
  });

  it('uses the area rings, reversed, as holes', () => {
    areas.coordinates.forEach((polygon, i) => {
      expect(mask.coordinates[i + 1]).toEqual([...polygon[0]!].reverse());
    });
  });

  it('is just the world for no areas', () => {
    expect(outsideMask({ type: 'MultiPolygon', coordinates: [] }).coordinates).toHaveLength(1);
  });
});

describe('geometry helpers', () => {
  const square: Position[] = [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
    [0, 0],
  ];
  const shifted = (dx: number, dy: number, size = 2): Position[] => [
    [dx, dy],
    [dx + size, dy],
    [dx + size, dy + size],
    [dx, dy + size],
    [dx, dy],
  ];

  it('pointInPolygon respects holes', () => {
    const hole: Position[] = [
      [0.5, 0.5],
      [0.5, 1.5],
      [1.5, 1.5],
      [1.5, 0.5],
      [0.5, 0.5],
    ];
    expect(pointInPolygon([0.2, 0.2], [square, hole])).toBe(true);
    expect(pointInPolygon([1, 1], [square, hole])).toBe(false);
    expect(pointInPolygon([3, 1], [square])).toBe(false);
  });

  it('ringsIntersect detects crossing edges, containment and disjoint rings', () => {
    expect(ringsIntersect(square, shifted(1, 1))).toBe(true);
    expect(ringsIntersect(square, shifted(0.5, 0.5, 1))).toBe(true);
    expect(ringsIntersect(shifted(0.5, 0.5, 1), square)).toBe(true);
    expect(ringsIntersect(square, shifted(5, 5))).toBe(false);
  });
});
