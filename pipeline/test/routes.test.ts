import { describe, expect, it } from 'vitest';
import { RouteSchema } from '../../src/data/schema';
import { haversineM, lineLengthM, type LonLat } from '../src/geo';
import { vertexKey } from '../src/graph';
import {
  candidateRoutes,
  edgeKey,
  enrichRoute,
  type EnrichedRoute,
  selectRoutes,
  shortestPaths,
  toRoute,
} from '../src/routes';
import { estimateDurationMin } from '../src/timing';
import { addWay, emptyGraph, fakeSampler, trailheadAt } from './helpers/trail-graph';

// ~111 m per 0.001 degree of latitude, ~72 m per 0.001 degree of longitude here.
const SUMMIT: LonLat = [19.5294, 49.5731];

describe('shortestPaths', () => {
  it('shortestPaths finds the shorter of two branches', () => {
    const g = emptyGraph();
    const target: LonLat = [19.5294, 49.6];
    const viaShort: LonLat = [19.531, 49.587]; // small detour east
    const viaLong: LonLat = [19.56, 49.587]; // big detour east
    addWay(g, [SUMMIT, viaShort, target], 1, ['red']);
    addWay(g, [SUMMIT, viaLong, target], 2, ['blue']);

    const { dist, prev } = shortestPaths(g, vertexKey(SUMMIT));

    expect(dist.get(vertexKey(SUMMIT))).toBe(0);
    expect(dist.get(vertexKey(target))).toBeCloseTo(lineLengthM([SUMMIT, viaShort, target]), 6);
    const step = prev.get(vertexKey(target))!;
    expect(step.from).toBe(vertexKey(viaShort));
    expect(step.edge.wayId).toBe(1);
    expect(step.edge.to).toBe(vertexKey(target));
    expect(prev.has(vertexKey(SUMMIT))).toBe(false);
  });

  it('leaves unreachable vertices out of dist', () => {
    const g = emptyGraph();
    addWay(g, [SUMMIT, [19.53, 49.58]], 1, ['red']);
    addWay(g, [[19.6, 49.6], [19.61, 49.6]], 2, ['red']);
    const { dist } = shortestPaths(g, vertexKey(SUMMIT));
    expect(dist.has(vertexKey([19.6, 49.6]))).toBe(false);
  });

  it('handles many vertices (binary heap)', () => {
    const g = emptyGraph();
    const line: LonLat[] = Array.from({ length: 2000 }, (_, i) => [19.5294, 49.5731 + i * 0.0001]);
    addWay(g, line, 1, ['red']);
    const { dist } = shortestPaths(g, vertexKey(line[0]!));
    expect(dist.get(vertexKey(line[1999]!))).toBeCloseTo(lineLengthM(line), 3);
  });
});

describe('candidateRoutes', () => {
  it('candidateRoutes drops routes shorter than 1 km and longer than 20 km', () => {
    const g = emptyGraph();
    const near: LonLat = [19.5294, 49.5776]; // ~0.5 km
    const mid: LonLat = [19.5, 49.6]; // ~3.5 km
    const far: LonLat = [19.5294, 49.8]; // ~25 km
    addWay(g, [SUMMIT, near], 1, ['red']);
    addWay(g, [SUMMIT, mid], 2, ['blue']);
    addWay(g, [SUMMIT, far], 3, ['green']);
    const trailheads = [
      trailheadAt('near', 'Near', near),
      trailheadAt('mid', 'Mid', mid),
      trailheadAt('far', 'Far', far),
    ];

    const routes = candidateRoutes(g, vertexKey(SUMMIT), trailheads);

    expect(routes.map((r) => r.trailhead.id)).toEqual(['mid']);
    expect(routes[0]!.lengthM).toBeCloseTo(haversineM(SUMMIT, mid), 6);
  });

  it('respects custom length bounds and skips unreachable trailheads', () => {
    const g = emptyGraph();
    const near: LonLat = [19.5294, 49.5776];
    const island: LonLat = [19.7, 49.7];
    addWay(g, [SUMMIT, near], 1, ['red']);
    addWay(g, [island, [19.71, 49.7]], 2, ['red']);
    const routes = candidateRoutes(
      g,
      vertexKey(SUMMIT),
      [trailheadAt('near', 'Near', near), trailheadAt('island', 'Island', island)],
      { minLenM: 100, maxLenM: 1000 },
    );
    expect(routes.map((r) => r.trailhead.id)).toEqual(['near']);
  });

  it('candidate coords start at trailhead and end at summit', () => {
    const g = emptyGraph();
    const start: LonLat = [19.5294, 49.6];
    const middle: LonLat = [19.532, 49.585];
    addWay(g, [start, middle, SUMMIT], 7, ['red']);

    const [route] = candidateRoutes(g, vertexKey(SUMMIT), [trailheadAt('start', 'Start', start)]);

    expect(route!.coords).toEqual([start, middle, SUMMIT]);
    expect(route!.lengthM).toBeCloseTo(lineLengthM([start, middle, SUMMIT]), 6);
  });

  it('lists colors in order of first appearance from the trailhead, PTTK order within an edge', () => {
    const g = emptyGraph();
    const start: LonLat = [19.5294, 49.6];
    const a: LonLat = [19.5294, 49.59];
    const b: LonLat = [19.5294, 49.58];
    addWay(g, [start, a], 1, ['yellow']);
    addWay(g, [a, b], 2, ['red', 'green']);
    addWay(g, [b, SUMMIT], 3, ['blue', 'green']);

    const [route] = candidateRoutes(g, vertexKey(SUMMIT), [trailheadAt('start', 'Start', start)]);

    expect(route!.colors).toEqual(['yellow', 'red', 'green', 'blue']);
  });

  it('keys edges by sorted vertex pair and way id', () => {
    const g = emptyGraph();
    const start: LonLat = [19.5294, 49.6];
    const a: LonLat = [19.5294, 49.59];
    addWay(g, [start, a, SUMMIT], 11, ['red']);

    const [route] = candidateRoutes(g, vertexKey(SUMMIT), [trailheadAt('start', 'Start', start)]);

    expect(edgeKey(vertexKey(a), vertexKey(start), 11)).toBe(
      edgeKey(vertexKey(start), vertexKey(a), 11),
    );
    expect([...route!.edges.keys()].sort()).toEqual(
      [edgeKey(vertexKey(start), vertexKey(a), 11), edgeKey(vertexKey(a), vertexKey(SUMMIT), 11)].sort(),
    );
    const total = [...route!.edges.values()].reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(route!.lengthM, 6);
  });
});

describe('enrichRoute', () => {
  it('adds 3D coords, profile, ascent/descent and the estimated duration', async () => {
    const g = emptyGraph();
    const start: LonLat = [19.5294, 49.6];
    addWay(g, [start, [19.532, 49.585], SUMMIT], 1, ['red']);
    const [candidate] = candidateRoutes(g, vertexKey(SUMMIT), [trailheadAt('start', 'Start', start)]);

    const r = await enrichRoute(candidate!, fakeSampler);

    expect(r.coords3d[0]!.slice(0, 2)).toEqual(start);
    expect(r.coords3d.at(-1)!.slice(0, 2)).toEqual(SUMMIT);
    expect(r.profile.length).toBe(r.coords3d.length);
    expect(r.ascentM).toBeGreaterThan(400);
    expect(r.durationMin).toBe(estimateDurationMin(r.lengthM / 1000, r.ascentM));
    expect(r.trailhead.id).toBe('start');
  });
});

/** A selection candidate with a straight line from `start` to the summit and the given edges. */
function enriched(id: string, start: LonLat, durationMin: number, edges: Record<string, number>): EnrichedRoute {
  const lengthM = Object.values(edges).reduce((s, v) => s + v, 0);
  return {
    trailhead: trailheadAt(id, id, start),
    coords: [start, SUMMIT],
    lengthM,
    colors: ['red'],
    edges: new Map(Object.entries(edges)),
    coords3d: [
      [start[0], start[1], 800],
      [SUMMIT[0], SUMMIT[1], 1725],
    ],
    profile: [
      [0, 800],
      [Math.round(lengthM), 1725],
    ],
    ascentM: 925,
    descentM: 0,
    durationMin,
  };
}

// Starts ~3.6 km apart from each other (0.05 degree of longitude).
const startAt = (i: number): LonLat => [19.3 + i * 0.05, 49.65];

describe('selectRoutes', () => {
  it('selectRoutes picks at most 3, fastest first', () => {
    const routes = [200, 100, 300, 150, 250].map((d, i) =>
      enriched(`r${d}`, startAt(i), d, { [`e${i}`]: 5000 }),
    );
    expect(selectRoutes(routes).map((r) => r.trailhead.id)).toEqual(['r100', 'r150', 'r200']);
    expect(selectRoutes(routes, { maxCount: 2 }).map((r) => r.trailhead.id)).toEqual(['r100', 'r150']);
  });

  it('selectRoutes rejects a start within 2 km of an already selected start', () => {
    const base: LonLat = [19.5, 49.65];
    const a = enriched('a', base, 100, { e1: 5000 });
    const b = enriched('b', [base[0] + 0.02, base[1]], 120, { e2: 5000 }); // ~1.4 km from a
    const c = enriched('c', [base[0] + 0.035, base[1]], 140, { e3: 5000 }); // ~2.5 km from a
    expect(selectRoutes([c, b, a]).map((r) => r.trailhead.id)).toEqual(['a', 'c']);
  });

  it('selectRoutes rejects a route sharing more than 50% of its length with a selected route', () => {
    const a = enriched('a', startAt(0), 100, { e1: 1000, e2: 1000 });
    const b = enriched('b', startAt(1), 120, { e1: 1000, e3: 900 }); // 1000/1900 > 0.5 with a
    const c = enriched('c', startAt(2), 140, { e2: 1000, e4: 1000 }); // exactly 0.5 with a: allowed
    const d = enriched('d', startAt(3), 160, { e4: 1000, e5: 500 }); // 0 with a, 2/3 with c
    expect(selectRoutes([a, b, c, d]).map((r) => r.trailhead.id)).toEqual(['a', 'c']);
  });

  it('breaks duration ties by length, then trailhead id', () => {
    const x = enriched('x', startAt(0), 100, { e1: 3000 });
    const y = enriched('y', startAt(1), 100, { e2: 2000 });
    const z = enriched('z', startAt(2), 100, { e3: 2000 });
    expect(selectRoutes([z, x, y]).map((r) => r.trailhead.id)).toEqual(['y', 'z', 'x']);
  });
});

describe('toRoute', () => {
  it("toRoute builds id 'babia-gora--zawoja-markowa' and passes RouteSchema", async () => {
    const g = emptyGraph();
    const start: LonLat = [19.5294, 49.61];
    // Two collinear intermediate points that simplification removes, and one real bend.
    addWay(g, [start, [19.5294, 49.6], [19.5294, 49.59], [19.535, 49.58], SUMMIT], 1, ['blue']);
    const trailhead = trailheadAt('zawoja-markowa', 'Zawoja Markowa', start);
    const [candidate] = candidateRoutes(g, vertexKey(SUMMIT), [trailhead]);
    const r = await enrichRoute(candidate!, fakeSampler);

    const route = toRoute('babia-gora', r, 'Babia Góra');

    expect(RouteSchema.parse(route)).toEqual(route);
    expect(route.id).toBe('babia-gora--zawoja-markowa');
    expect(route.name).toBe('Zawoja Markowa → Babia Góra');
    expect(route.trailhead).toEqual({ name: 'Zawoja Markowa', lat: 49.61, lon: 19.5294, kind: 'parking' });
    expect(route.distanceKm).toBe(Math.round(r.lengthM / 100) / 10);
    expect(route.ascentM).toBe(r.ascentM);
    expect(route.descentM).toBe(r.descentM);
    expect(route.durationMin).toBe(r.durationMin);
    expect(route.colors).toEqual(r.colors);
    expect(route.profile).toEqual(r.profile);

    const coords = route.geometry.coordinates;
    expect(coords.length).toBeLessThan(r.coords3d.length);
    expect(coords.length).toBeGreaterThanOrEqual(3);
    expect(coords[0]).toEqual([19.5294, 49.61, r.coords3d[0]![2]]);
    expect(coords.at(-1)).toEqual([SUMMIT[0], SUMMIT[1], r.coords3d.at(-1)![2]]);
    for (const [lon, lat, h] of coords) {
      expect(Math.abs(lon * 1e5 - Math.round(lon * 1e5))).toBeLessThan(1e-6);
      expect(Math.abs(lat * 1e5 - Math.round(lat * 1e5))).toBeLessThan(1e-6);
      expect(Number.isInteger(h)).toBe(true);
      const nearest = r.coords3d.reduce((best, p) =>
        haversineM([p[0], p[1]], [lon, lat]) < haversineM([best[0], best[1]], [lon, lat]) ? p : best,
      );
      expect(h).toBe(nearest[2]);
    }
  });
});
