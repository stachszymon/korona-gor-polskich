import { readFileSync, readdirSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Position } from 'geojson';
import { beforeAll, describe, expect, it } from 'vitest';
import { MountainAreaSchema, type MountainArea } from '../../src/data/schema';
import { pointInPolygon } from '../../src/map/mask';
import { buildMountainArea, writeMountainArea } from '../src/area';

const DATA_DIR = new URL('../../public/data/', import.meta.url).pathname;

type LonLat = [number, number];
type PeakPoint = { id: string; lat: number; lon: number };

/** Loose reading of the committed data: only ids, positions and route geometries, whatever else the files hold. */
function readCommittedInputs(): { peaks: PeakPoint[]; routes: LonLat[][] } {
  const index = JSON.parse(readFileSync(join(DATA_DIR, 'peaks.json'), 'utf8')) as { peaks: PeakPoint[] };
  const peaks = index.peaks.map(({ id, lat, lon }) => ({ id, lat, lon }));
  const routes: LonLat[][] = [];
  for (const file of readdirSync(join(DATA_DIR, 'peaks'))) {
    const detail = JSON.parse(readFileSync(join(DATA_DIR, 'peaks', file), 'utf8')) as {
      routes?: { geometry: { coordinates: number[][] } }[];
    };
    for (const route of detail.routes ?? []) {
      routes.push(route.geometry.coordinates.map((c) => [c[0]!, c[1]!] as LonLat));
    }
  }
  return { peaks, routes };
}

const polygonIndexOf = (area: MountainArea, lon: number, lat: number): number =>
  area.areas.coordinates.findIndex((polygon) => pointInPolygon([lon, lat], polygon as Position[][]));
const inside = (area: MountainArea, lon: number, lat: number): boolean => polygonIndexOf(area, lon, lat) >= 0;

/** Positive for counter-clockwise rings. */
function signedArea(ring: Position[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!;
  }
  return sum / 2;
}

describe('buildMountainArea on the committed data', () => {
  const { peaks, routes } = readCommittedInputs();
  let area: MountainArea;
  const polygonOf = (id: string): number => {
    const p = peaks.find((peak) => peak.id === id)!;
    return polygonIndexOf(area, p.lon, p.lat);
  };

  beforeAll(() => {
    area = buildMountainArea(peaks, routes);
  }, 120_000);

  it('gives exactly two polygons: the main range and Łysica', () => {
    expect(area.areas.type).toBe('MultiPolygon');
    expect(area.areas.coordinates).toHaveLength(2);
  });

  it('keeps Łysica apart from Rysy', () => {
    expect(polygonOf('lysica')).toBeGreaterThanOrEqual(0);
    expect(polygonOf('rysy')).toBeGreaterThanOrEqual(0);
    expect(polygonOf('lysica')).not.toBe(polygonOf('rysy'));
  });

  it('puts every peak except Łysica in one polygon, from Wysoka Kopa to Tarnica', () => {
    const main = polygonOf('rysy');
    for (const id of ['wysoka-kopa', 'sleza', 'rysy', 'tarnica']) expect(polygonOf(id)).toBe(main);
    for (const peak of peaks.filter((p) => p.id !== 'lysica')) expect(polygonOf(peak.id)).toBe(main);
  });

  it('contains the mountain towns', () => {
    expect(inside(area, 19.95, 49.3)).toBe(true); // Zakopane
    expect(inside(area, 15.75, 50.78)).toBe(true); // Karpacz
    expect(inside(area, 18.86, 49.65)).toBe(true); // Wisła
    expect(inside(area, 22.65, 49.1)).toBe(true); // Ustrzyki Górne
  });

  it('leaves the big cities outside', () => {
    expect(inside(area, 19.94, 50.06)).toBe(false); // Kraków
    expect(inside(area, 19.02, 50.26)).toBe(false); // Katowice
    expect(inside(area, 17.03, 51.11)).toBe(false); // Wrocław
    expect(inside(area, 21.01, 52.23)).toBe(false); // Warszawa
  });

  it('has bounds containing every vertex, with a margin', () => {
    const [west, south, east, north] = area.bounds;
    const vertices = area.areas.coordinates.flatMap((polygon) => polygon.flat());
    for (const [lon, lat] of vertices) {
      expect(lon).toBeGreaterThanOrEqual(west);
      expect(lon).toBeLessThanOrEqual(east);
      expect(lat).toBeGreaterThanOrEqual(south);
      expect(lat).toBeLessThanOrEqual(north);
    }
    expect(Math.min(...vertices.map((v) => v[0]!)) - west).toBeCloseTo(0.3, 3);
    expect(east - Math.max(...vertices.map((v) => v[0]!))).toBeCloseTo(0.3, 3);
    expect(Math.min(...vertices.map((v) => v[1]!)) - south).toBeCloseTo(0.3, 3);
    expect(north - Math.max(...vertices.map((v) => v[1]!))).toBeCloseTo(0.3, 3);
  });

  it('has counter-clockwise closed outer rings and coordinates rounded to 4 places', () => {
    for (const polygon of area.areas.coordinates) {
      const outer = polygon[0]!;
      expect(outer[0]).toEqual(outer.at(-1));
      expect(signedArea(outer as Position[])).toBeGreaterThan(0);
      for (const ring of polygon) {
        for (const [lon, lat] of ring) {
          expect(Math.round(lon! * 1e4) / 1e4).toBe(lon);
          expect(Math.round(lat! * 1e4) / 1e4).toBe(lat);
        }
      }
    }
  });

  it('passes the schema and stays small', () => {
    expect(MountainAreaSchema.safeParse(area).success).toBe(true);
    expect(JSON.stringify(area).length).toBeLessThan(100_000);
  });
});

describe('buildMountainArea on synthetic data', () => {
  it('merges two peaks 20 km apart into one polygon', () => {
    const area = buildMountainArea(
      [
        { id: 'a', lat: 50, lon: 20 },
        { id: 'b', lat: 50, lon: 20.28 },
      ],
      [],
    );
    expect(area.areas.coordinates).toHaveLength(1);
  });

  it('bridges two far groups with a capsule instead of leaving them apart', () => {
    const area = buildMountainArea(
      [
        { id: 'a', lat: 50, lon: 20 },
        { id: 'b', lat: 50, lon: 21.5 }, // about 107 km away
      ],
      [],
    );
    expect(area.areas.coordinates).toHaveLength(1);
    expect(inside(area, 20.75, 50)).toBe(true); // midway, only the capsule covers it
  });

  it('never joins an isolated peak, even a close one', () => {
    const area = buildMountainArea(
      [
        { id: 'a', lat: 50, lon: 20 },
        { id: 'lysica', lat: 50.4, lon: 20.4 },
      ],
      [],
    );
    expect(area.areas.coordinates).toHaveLength(2);
  });

  it('widens the area along a route', () => {
    const peaks = [{ id: 'a', lat: 50, lon: 20 }];
    const without = buildMountainArea(peaks, []);
    // about 14 km east of the peak: the 4 km buffer reaches beyond the 12 km circle
    const route: LonLat[] = [
      [20, 50],
      [20.2, 50],
    ];
    const withRoute = buildMountainArea(peaks, [route]);
    expect(inside(without, 20.2, 50.03)).toBe(false);
    expect(inside(withRoute, 20.2, 50.03)).toBe(true);
  });

  it('throws without peaks', () => {
    expect(() => buildMountainArea([], [])).toThrow();
  });
});

describe('writeMountainArea', () => {
  it('reads peaks.json and peaks/*.json from outDir and writes mountain-area.json', async () => {
    const work = await mkdtemp(join(tmpdir(), 'kgp-area-'));
    try {
      await cp(DATA_DIR, work, { recursive: true });
      await rm(join(work, 'mountain-area.json'), { force: true });
      const area = await writeMountainArea(work);
      const written = MountainAreaSchema.parse(JSON.parse(await readFile(join(work, 'mountain-area.json'), 'utf8')));
      expect(written).toEqual(area);
      expect(written.areas.coordinates).toHaveLength(2);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }, 120_000);
});
