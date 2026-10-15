import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Route } from '../../src/data/schema';
import type { LonLat } from '../src/geo';
import { vertexKey } from '../src/graph';
import {
  applyRenames,
  excludedTrailheads,
  loadOverrides,
  manualTrailheads,
  RouteOverridesSchema,
} from '../src/overrides';
import { candidateRoutes, enrichRoute, selectRoutes } from '../src/routes';
import { findTrailheads } from '../src/trailheads';
import { addWay, emptyGraph, fakeSampler, trailheadAt } from './helpers/trail-graph';

const SUMMIT: LonLat = [19.5294, 49.5731];

async function tempFile(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kgp-overrides-'));
  const path = join(dir, 'route-overrides.json');
  await writeFile(path, content, 'utf8');
  return path;
}

function route(id: string, name: string): Route {
  return {
    id,
    name,
    trailhead: { name: 'Start', lat: 49.6, lon: 19.5, kind: 'parking' },
    distanceKm: 5,
    ascentM: 900,
    descentM: 0,
    durationMin: 165,
    colors: ['red'],
    geometry: { type: 'LineString', coordinates: [[19.5, 49.6, 800], [19.5294, 49.5731, 1725]] },
    profile: [[0, 800], [5000, 1725]],
  };
}

describe('route overrides', () => {
  it('exclude removes trailhead before selection', async () => {
    const g = emptyGraph();
    const zawoja: LonLat = [19.5294, 49.6]; // ~3 km north, fastest
    const krowiarki: LonLat = [19.46, 49.6]; // ~5.9 km north-west, slower
    addWay(g, [zawoja, SUMMIT], 1, ['blue']);
    addWay(g, [krowiarki, SUMMIT], 2, ['red']);
    const trailheads = [
      trailheadAt('zawoja-markowa', 'Zawoja Markowa', zawoja),
      trailheadAt('przelecz-krowiarki', 'Przełęcz Krowiarki', krowiarki),
    ];
    const overrides = RouteOverridesSchema.parse({ 'babia-gora': { exclude: ['zawoja-markowa'] } });

    const select = async (ths: typeof trailheads) =>
      selectRoutes(
        await Promise.all(candidateRoutes(g, vertexKey(SUMMIT), ths).map((c) => enrichRoute(c, fakeSampler))),
        { maxCount: 1 },
      ).map((r) => r.trailhead.id);

    expect(await select(trailheads)).toEqual(['zawoja-markowa']);
    const excluded = excludedTrailheads(overrides, 'babia-gora');
    expect(excluded).toEqual(new Set(['zawoja-markowa']));
    expect(await select(trailheads.filter((t) => !excluded.has(t.id)))).toEqual(['przelecz-krowiarki']);
    expect(excludedTrailheads(overrides, 'pilsko')).toEqual(new Set());
  });

  it('rename replaces route name', () => {
    const overrides = RouteOverridesSchema.parse({
      'babia-gora': { rename: { 'babia-gora--zawoja-markowa': 'Z Zawoi przez Markowe Szczawiny' } },
      pilsko: { rename: { 'babia-gora--przelecz-krowiarki': 'Wrong peak' } },
    });
    const routes = [
      route('babia-gora--zawoja-markowa', 'Zawoja Markowa → Babia Góra'),
      route('babia-gora--przelecz-krowiarki', 'Przełęcz Krowiarki → Babia Góra'),
    ];

    const renamed = applyRenames(routes, overrides, 'babia-gora');

    expect(renamed.map((r) => r.name)).toEqual([
      'Z Zawoi przez Markowe Szczawiny',
      'Przełęcz Krowiarki → Babia Góra',
    ]);
    expect(routes[0]!.name).toBe('Zawoja Markowa → Babia Góra'); // input untouched
    expect(applyRenames(routes, overrides, 'tarnica')).toEqual(routes);
  });

  it("addTrailhead appears as kind 'manual'", () => {
    const g = emptyGraph();
    const krowiarki: LonLat = [19.48, 49.585];
    addWay(g, [krowiarki, SUMMIT], 1, ['red']);
    const overrides = RouteOverridesSchema.parse({
      'babia-gora': { addTrailhead: [{ name: 'Przełęcz Krowiarki', lat: 49.5851, lon: 19.4801 }] },
    });

    const manual = manualTrailheads(overrides, 'babia-gora');
    const trailheads = findTrailheads(g, [], { manual });

    expect(manual).toEqual([{ name: 'Przełęcz Krowiarki', lat: 49.5851, lon: 19.4801 }]);
    expect(trailheads).toEqual([
      {
        id: 'przelecz-krowiarki',
        name: 'Przełęcz Krowiarki',
        kind: 'manual',
        lon: 19.4801,
        lat: 49.5851,
        vertex: vertexKey(krowiarki),
      },
    ]);
    expect(manualTrailheads(overrides, 'pilsko')).toEqual([]);
  });

  it('invalid overrides file fails with zod error naming the path', async () => {
    const path = await tempFile(JSON.stringify({ 'babia-gora': { exclude: 'zawoja-markowa' } }));
    const error = await loadOverrides(path).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(path);
    expect((error as Error).message).toContain('["babia-gora"].exclude'); // zod's issue path
    expect((error as Error).message).toContain('expected array');
  });

  it('rejects unknown operations and malformed JSON, naming the file', async () => {
    const typo = await tempFile(JSON.stringify({ 'babia-gora': { exlude: ['x'] } }));
    await expect(loadOverrides(typo)).rejects.toThrow(typo);
    await expect(loadOverrides(typo)).rejects.toThrow(/exlude/);
    const broken = await tempFile('{ "babia-gora": ');
    await expect(loadOverrides(broken)).rejects.toThrow(broken);
  });

  it('accepts maxRoutes between 1 and 3', () => {
    expect(RouteOverridesSchema.parse({ rysy: { maxRoutes: 2 } })).toEqual({ rysy: { maxRoutes: 2 } });
    for (const bad of [0, 4, 1.5]) {
      expect(RouteOverridesSchema.safeParse({ rysy: { maxRoutes: bad } }).success).toBe(false);
    }
  });

  it('loads a valid file and the committed overrides', async () => {
    const path = await tempFile(
      JSON.stringify({ 'babia-gora': { exclude: ['a'], rename: { 'babia-gora--b': 'B' } } }),
    );
    expect(await loadOverrides(path)).toEqual({
      'babia-gora': { exclude: ['a'], rename: { 'babia-gora--b': 'B' } },
    });
    const committed = await loadOverrides(join(import.meta.dirname, '..', 'route-overrides.json'));
    expect(typeof committed).toBe('object');
  });
});
