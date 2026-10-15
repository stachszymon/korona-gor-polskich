import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PeakDetailSchema, PeaksIndexSchema } from '../../src/data/schema';
import {
  buildAll,
  buildPeak,
  formatReport,
  MAX_PEAK_FILE_BYTES,
  type BuildDeps,
  type PeakReport,
} from '../src/build';
import { haversineM } from '../src/geo';
import type { OverpassNode, OverpassRelation, OverpassResponse } from '../src/overpass';
import type { RouteOverrides } from '../src/overrides';
import type { PeakSource } from '../src/peaks';
import { fakeTileFetcher } from './helpers/fake-dem';

const BABIA: PeakSource = {
  id: 'babia-gora',
  name: 'Babia Góra',
  range: 'Beskid Żywiecki',
  elevation: 1725,
  lat: 49.57302,
  lon: 19.52933,
  osmNodeId: 477984782,
};

/** A peak with no trails around it. */
const PUSTY: PeakSource = {
  id: 'pusty-szczyt',
  name: 'Pusty Szczyt',
  range: 'Nigdzie',
  elevation: 1000,
  lat: 50.2,
  lon: 20.2,
  osmNodeId: 4242,
};

const readJson = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')) as T;

const RELATIONS = readJson<{ elements: OverpassRelation[] }>('babia-gora.relations.json').elements;
const POIS = readJson<{ elements: OverpassNode[] }>('babia-gora.pois.json').elements;

const isNearBabia = (query: string): boolean => {
  const m = /around:\d+,([\d.]+),([\d.]+)/.exec(query);
  return m !== null && Math.abs(Number(m[1]) - BABIA.lat) < 0.1 && Math.abs(Number(m[2]) - BABIA.lon) < 0.1;
};

interface MockOptions {
  /** Added to the relations around Babia Góra. */
  extraRelations?: OverpassRelation[];
  /** Replaces the OSM `ele` tag of the peak nodes (default: the listed elevation). */
  ele?: (src: PeakSource) => string;
}

function overpassMock(sources: PeakSource[], opts: MockOptions = {}) {
  return vi.fn((query: string): Promise<OverpassResponse> => {
    if (query.includes('route=hiking')) {
      return Promise.resolve({ elements: isNearBabia(query) ? [...RELATIONS, ...(opts.extraRelations ?? [])] : [] });
    }
    if (query.includes('amenity=parking')) {
      return Promise.resolve({ elements: isNearBabia(query) ? POIS : [] });
    }
    if (query.includes('node(id:')) {
      return Promise.resolve({
        elements: sources.map(
          (s): OverpassNode => ({
            type: 'node',
            id: s.osmNodeId,
            lat: s.lat,
            lon: s.lon,
            tags: { natural: 'peak', name: s.name, ele: opts.ele?.(s) ?? String(s.elevation) },
          }),
        ),
      });
    }
    return Promise.reject(new Error(`unexpected query: ${query}`));
  });
}

function makeDeps(sources: PeakSource[], opts: MockOptions & { overrides?: RouteOverrides } = {}) {
  const overpass = overpassMock(sources, opts);
  const fetchTile = fakeTileFetcher([BABIA.lon, BABIA.lat]);
  const log = vi.fn<(line: string) => void>();
  const deps: BuildDeps = {
    overpass,
    fetchTile,
    overrides: opts.overrides ?? {},
    now: () => new Date('2026-10-15T12:00:00Z'),
    log,
  };
  return { deps, overpass, fetchTile, log };
}

describe('buildPeak', () => {
  it('buildPeak on Babia Góra fixture yields 1–3 routes that pass PeakDetailSchema and end within 150 m of the summit', async () => {
    const { deps, overpass } = makeDeps([BABIA]);

    const { detail, report } = await buildPeak(BABIA, deps);

    expect(PeakDetailSchema.safeParse(detail).success).toBe(true);
    expect(detail.peakId).toBe('babia-gora');
    expect(detail.routes.length).toBeGreaterThanOrEqual(1);
    expect(detail.routes.length).toBeLessThanOrEqual(3);
    for (const route of detail.routes) {
      const end = route.geometry.coordinates.at(-1)!;
      expect(haversineM([end[0], end[1]], [BABIA.lon, BABIA.lat])).toBeLessThanOrEqual(150);
      const start = route.geometry.coordinates[0]!;
      expect(haversineM([start[0], start[1]], [route.trailhead.lon, route.trailhead.lat])).toBeLessThan(300);
      expect(route.id.startsWith('babia-gora--')).toBe(true);
      // the fake DEM rises towards the summit
      expect(route.ascentM).toBeGreaterThan(100);
      expect(route.durationMin).toBeGreaterThan(0);
    }
    expect(report.errors).toEqual([]);
    expect(report.peakId).toBe('babia-gora');
    expect(report.routes.map((r) => r.id)).toEqual(detail.routes.map((r) => r.id));
    expect(report.sizeBytes).toBe(Buffer.byteLength(`${JSON.stringify(detail)}\n`));
    // radius 10 km for both Overpass queries
    const queries = overpass.mock.calls.map(([q]) => q);
    expect(queries).toHaveLength(2);
    expect(queries.every((q) => q.includes('around:10000,49.57302,19.52933'))).toBe(true);
  });

  it('draws the trails simplified and rounded to 5 digits', async () => {
    const { deps } = makeDeps([BABIA]);
    const { detail } = await buildPeak(BABIA, deps);

    expect(detail.trails.features.length).toBeGreaterThan(0);
    for (const f of detail.trails.features) {
      expect(f.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
      for (const [lon, lat] of f.geometry.coordinates) {
        expect(Math.round(lon * 1e5) / 1e5).toBe(lon);
        expect(Math.round(lat * 1e5) / 1e5).toBe(lat);
      }
    }
    // the fixture ways carry many more points than their simplified versions
    const raw = RELATIONS.flatMap((r) => r.members).reduce(
      (n, m) => n + (m.type === 'way' ? (m.geometry?.length ?? 0) : 0),
      0,
    );
    const drawn = detail.trails.features.reduce((n, f) => n + f.geometry.coordinates.length, 0);
    expect(drawn).toBeLessThan(raw);
    expect(detail.trails.features.some((f) => f.properties.name !== undefined)).toBe(true);
  });

  it('reports skipped relations with their reason', async () => {
    const { deps } = makeDeps([BABIA]);
    const { report } = await buildPeak(BABIA, deps);

    expect(report.relations).toBe(RELATIONS.length);
    expect(report.skipped.map((s) => [s.id, s.reason])).toEqual([
      [15482388, 'no-color'],
      [19308791, 'unsupported-color'],
    ]);
  });

  it('uses one DEM sampler per peak: the tile cache is not shared between peaks', async () => {
    const { deps, fetchTile } = makeDeps([BABIA]);
    await buildPeak(BABIA, deps);
    const first = fetchTile.calls;
    expect(first).toBeGreaterThan(0);
    await buildPeak(BABIA, deps);
    expect(fetchTile.calls).toBe(first * 2);
  });

  it('is an error when no trail vertex lies within 150 m of the summit', async () => {
    const { deps } = makeDeps([PUSTY]);
    const { detail, report } = await buildPeak(PUSTY, deps);

    expect(report.errors).toEqual([expect.stringContaining('150 m')]);
    expect(detail.routes).toEqual([]);
    expect(PeakDetailSchema.safeParse(detail).success).toBe(true);
  });

  it('is an error when no route is left after selection', async () => {
    const overrides: RouteOverrides = {
      'babia-gora': { exclude: ['markowe-szczawiny', 'zawoja-markowa', 'zawoja-czatoza'] },
    };
    const { deps } = makeDeps([BABIA], { overrides });
    const { detail, report } = await buildPeak(BABIA, deps);

    expect(detail.routes).toEqual([]);
    expect(report.errors).toEqual([expect.stringContaining('no routes')]);
    expect(report.warnings.filter((w) => w.includes('unknown trailhead'))).toEqual([]);
  });

  it('drops excluded trailheads before routing and applies renames', async () => {
    const baseline = await buildPeak(BABIA, makeDeps([BABIA]).deps);
    const [first, second] = baseline.detail.routes;
    expect(first).toBeDefined();
    const firstTrailhead = first!.id.slice('babia-gora--'.length);

    const overrides: RouteOverrides = {
      'babia-gora': {
        exclude: [firstTrailhead],
        ...(second ? { rename: { [second.id]: 'Nazwa z poprawki' } } : {}),
      },
    };
    const { detail, report } = await buildPeak(BABIA, makeDeps([BABIA], { overrides }).deps);

    expect(detail.routes.map((r) => r.id)).not.toContain(first!.id);
    if (second) {
      expect(detail.routes.find((r) => r.id === second.id)?.name).toBe('Nazwa z poprawki');
    }
    expect(report.warnings).toEqual([]);
  });

  it('warns about override entries that match nothing', async () => {
    const overrides: RouteOverrides = {
      'babia-gora': {
        exclude: ['nie-ma-takiego-startu'],
        rename: {
          'babia-gora--nie-ma-takiej-trasy': 'A',
          'pilsko--zawoja-markowa': 'B',
        },
        addTrailhead: [{ name: 'Daleko od szlaku', lat: 49.7, lon: 19.8 }],
      },
    };
    const { report } = await buildPeak(BABIA, makeDeps([BABIA], { overrides }).deps);

    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('nie-ma-takiego-startu'),
        expect.stringContaining('babia-gora--nie-ma-takiej-trasy'),
        expect.stringContaining('pilsko--zawoja-markowa'),
        expect.stringContaining('Daleko od szlaku'),
      ]),
    );
  });

  it('adds manual trailheads as route candidates', async () => {
    // on the bus stop of the POI fixture: a manual start wins over any POI on the same vertex
    const overrides: RouteOverrides = {
      'babia-gora': { addTrailhead: [{ name: 'Moja baza', lat: 49.5633, lon: 19.5077 }] },
    };
    const { detail, report } = await buildPeak(BABIA, makeDeps([BABIA], { overrides }).deps);

    expect(report.warnings).toEqual([]);
    const manual = detail.routes.find((r) => r.trailhead.kind === 'manual');
    expect(manual?.id).toBe('babia-gora--moja-baza');
    expect(detail.routes.map((r) => r.id)).not.toContain('babia-gora--zawoja-markowa');
  });
});

describe('buildAll', () => {
  let work: string;
  let outDir: string;

  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), 'kgp-build-'));
    outDir = join(work, 'data');
  });

  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  async function seedOutDir(): Promise<void> {
    await mkdir(join(outDir, 'peaks'), { recursive: true });
    await writeFile(join(outDir, 'peaks.json'), '{"old":true}');
    await writeFile(join(outDir, 'peaks', 'stary.json'), '{"old":true}');
  }

  async function expectOutDirUntouched(): Promise<void> {
    expect(await readFile(join(outDir, 'peaks.json'), 'utf8')).toBe('{"old":true}');
    expect(await readdir(join(outDir, 'peaks'))).toEqual(['stary.json']);
    expect(existsSync(`${outDir}.tmp`)).toBe(false);
  }

  it('buildAll writes peaks.json and peaks/<id>.json that pass schemas', async () => {
    const { deps } = makeDeps([BABIA]);

    const { ok, reports } = await buildAll([BABIA], deps, outDir);

    expect(ok).toBe(true);
    expect(reports).toHaveLength(1);
    const index = PeaksIndexSchema.parse(JSON.parse(await readFile(join(outDir, 'peaks.json'), 'utf8')));
    const detail = PeakDetailSchema.parse(
      JSON.parse(await readFile(join(outDir, 'peaks', 'babia-gora.json'), 'utf8')),
    );
    expect(index.generatedAt).toBe('2026-10-15T12:00:00.000Z');
    expect(index.peaks).toEqual([
      {
        id: 'babia-gora',
        name: 'Babia Góra',
        range: 'Beskid Żywiecki',
        elevation: 1725,
        lat: BABIA.lat,
        lon: BABIA.lon,
        routeCount: detail.routes.length,
      },
    ]);
    expect(detail.routes.length).toBeGreaterThanOrEqual(1);
    expect(await readdir(work)).toEqual(['data']); // no .tmp or .old left behind
  });

  it('replaces an existing outDir completely and keeps the order of the source list', async () => {
    await seedOutDir();
    const second: PeakSource = { ...BABIA, id: 'babia-gora-bis', name: 'Babia Góra bis', osmNodeId: 7 };
    const { deps } = makeDeps([second, BABIA]);

    // `second` has the same coordinates, so it gets the same routes
    const { ok } = await buildAll([second, BABIA], deps, outDir);

    expect(ok).toBe(true);
    expect((await readdir(join(outDir, 'peaks'))).sort()).toEqual(['babia-gora-bis.json', 'babia-gora.json']);
    const index = PeaksIndexSchema.parse(JSON.parse(await readFile(join(outDir, 'peaks.json'), 'utf8')));
    expect(index.peaks.map((p) => p.id)).toEqual(['babia-gora-bis', 'babia-gora']);
  });

  it('buildAll leaves existing outDir untouched when one peak has zero routes', async () => {
    await seedOutDir();
    const { deps } = makeDeps([BABIA, PUSTY]);

    const { ok, reports } = await buildAll([BABIA, PUSTY], deps, outDir);

    expect(ok).toBe(false);
    expect(reports.map((r) => r.peakId)).toEqual(['babia-gora', 'pusty-szczyt']);
    expect(reports[0]!.errors).toEqual([]);
    expect(reports[1]!.errors.length).toBeGreaterThan(0);
    await expectOutDirUntouched();
  });

  it('buildAll leaves existing outDir untouched when Overpass throws', async () => {
    await seedOutDir();
    const { deps, overpass } = makeDeps([BABIA]);
    overpass.mockImplementation((query: string) =>
      query.includes('node(id:') ? Promise.resolve({ elements: [] }) : Promise.reject(new Error('Overpass down')),
    );
    // make the validation pass so the failure happens while building the peak
    overpass.mockImplementationOnce(() =>
      Promise.resolve({
        elements: [
          { type: 'node', id: BABIA.osmNodeId, lat: BABIA.lat, lon: BABIA.lon, tags: { ele: '1725' } },
        ],
      }),
    );

    await expect(buildAll([BABIA], deps, outDir)).rejects.toThrow('Overpass down');

    await expectOutDirUntouched();
  });

  it('buildAll leaves existing outDir untouched when the DEM fails', async () => {
    await seedOutDir();
    const { deps } = makeDeps([BABIA]);
    deps.fetchTile = () => Promise.reject(new Error('DEM down'));

    await expect(buildAll([BABIA], deps, outDir)).rejects.toThrow('DEM down');

    await expectOutDirUntouched();
  });

  it('stops before building when a peak does not match OSM, and lists the mismatch', async () => {
    await seedOutDir();
    const { deps, overpass } = makeDeps([BABIA], { ele: () => '1800' });

    const { ok, reports } = await buildAll([BABIA], deps, outDir);

    expect(ok).toBe(false);
    expect(reports).toHaveLength(1);
    expect(reports[0]!.errors).toEqual([expect.stringMatching(/OSM.*75 m|75 m.*OSM/)]);
    // only the validation query was sent
    expect(overpass).toHaveBeenCalledTimes(1);
    expect(overpass.mock.calls[0]![0]).toContain('node(id:');
    await expectOutDirUntouched();
  });

  it('is an error when OSM has no node with the listed id', async () => {
    const { deps, overpass } = makeDeps([]);
    overpass.mockResolvedValue({ elements: [] });

    const { ok, reports } = await buildAll([BABIA], deps, outDir);

    expect(ok).toBe(false);
    expect(reports[0]!.errors).toEqual([expect.stringContaining(String(BABIA.osmNodeId))]);
    expect(existsSync(outDir)).toBe(false);
  });

  it('accepts a mismatch with acceptOsmMismatch and only prints it as a warning', async () => {
    const accepted: PeakSource = { ...BABIA, acceptOsmMismatch: true };
    const { deps } = makeDeps([accepted], { ele: () => '1800' });

    const { ok, reports } = await buildAll([accepted], deps, outDir);

    expect(ok).toBe(true);
    expect(reports[0]!.warnings).toEqual([expect.stringMatching(/OSM/)]);
  });

  it('warns about overrides for a peak that is not on the list', async () => {
    const { deps } = makeDeps([BABIA], { overrides: { pilsko: { exclude: ['x'] } } });
    const logs: string[] = [];
    deps.log = (line) => logs.push(line);

    const { ok } = await buildAll([BABIA], deps, outDir);

    expect(ok).toBe(true);
    expect(logs.join('\n')).toMatch(/pilsko/);
  });

  it('report lists skipped relations and size warning above 500000 bytes', async () => {
    // Disconnected zigzag ways whose points survive 5 m simplification: 30 x 1000 points, about 600 kB.
    const zigzagWay = (ref: number) => ({
      type: 'way' as const,
      ref,
      role: '',
      geometry: Array.from({ length: 1000 }, (_, i) => ({
        lat: 49.6 + ref * 0.01 + i * 0.000005,
        lon: 19.6 + (i % 2) * 0.0002,
      })),
    });
    const big: OverpassRelation = {
      type: 'relation',
      id: 999,
      tags: { route: 'hiking', name: 'Zygzak', colour: 'red', 'osmc:symbol': 'red:white:red_bar' },
      members: Array.from({ length: 30 }, (_, i) => zigzagWay(i)),
    };
    const { deps } = makeDeps([BABIA], { extraRelations: [big] });

    const { ok, reports } = await buildAll([BABIA], deps, outDir);

    const report = reports[0]!;
    expect(ok).toBe(true); // a size warning does not fail the build
    expect(report.sizeBytes).toBeGreaterThan(MAX_PEAK_FILE_BYTES);
    expect(MAX_PEAK_FILE_BYTES).toBe(500_000);
    expect(report.warnings).toEqual([expect.stringContaining('500000')]);
    expect(report.skipped.map((s) => s.id)).toEqual([15482388, 19308791]);
    const text = formatReport([report]);
    expect(text).toContain('babia-gora');
    expect(text).toContain('15482388');
    expect(text).toContain('no-color');
    expect(text).toContain('500000');
  });

  it('logs progress per peak', async () => {
    const { deps, log } = makeDeps([BABIA]);
    await buildAll([BABIA], deps, outDir);
    const lines = log.mock.calls.map(([l]) => l).join('\n');
    expect(lines).toContain('babia-gora');
  });
});

describe('formatReport', () => {
  const report: PeakReport = {
    peakId: 'babia-gora',
    relations: 7,
    skipped: [{ id: 15482388, name: 'Via Slovakia', reason: 'no-color' }],
    routes: [{ id: 'babia-gora--zawoja', name: 'Zawoja → Babia Góra', distanceKm: 7.4, durationMin: 210 }],
    sizeBytes: 12_345,
    warnings: ['uwaga'],
    errors: ['błąd'],
  };

  it('prints a block per peak with relations, skipped, routes, warnings and errors', () => {
    const text = formatReport([report]);
    expect(text).toContain('babia-gora');
    expect(text).toContain('relations: 7');
    expect(text).toContain('15482388');
    expect(text).toContain('Via Slovakia');
    expect(text).toContain('babia-gora--zawoja');
    expect(text).toContain('7.4 km');
    expect(text).toContain('210 min');
    expect(text).toContain('12345');
    expect(text).toContain('WARNING: uwaga');
    expect(text).toContain('ERROR: błąd');
  });
});
