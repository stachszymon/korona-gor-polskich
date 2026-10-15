// @vitest-environment node
/// <reference types="node" />
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PeakDetailSchema, PeaksIndexSchema } from './schema';

/**
 * Consistency of the generated, committed data in `public/data/` (the output of
 * `npm run data:build`). Missing files make the assertions fail, not the module import.
 * Runs in Node and reads with `node:fs`: `import.meta.glob` results are cached with the
 * transformed test file and would not notice regenerated data.
 */
const DATA_DIR = fileURLToPath(new URL('../../public/data/', import.meta.url));

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const indexFiles: Record<string, unknown> = existsSync(join(DATA_DIR, 'peaks.json'))
  ? { 'peaks.json': readJson(join(DATA_DIR, 'peaks.json')) }
  : {};
const peakFiles: Record<string, unknown> = Object.fromEntries(
  (existsSync(join(DATA_DIR, 'peaks')) ? readdirSync(join(DATA_DIR, 'peaks')) : [])
    .filter((name) => name.endsWith('.json'))
    .map((name) => [name, readJson(join(DATA_DIR, 'peaks', name))]),
);

const KGP_PEAK_COUNT = 28;
/** The last point of a route must lie this close to its summit. */
const SUMMIT_TOLERANCE_M = 150;

const idFromPath = (name: string): string => name.replace(/\.json$/, '');

/** Great-circle distance in metres between two [lon, lat] points. */
function distanceM(a: [number, number], b: [number, number]): number {
  const rad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const loadIndex = () => PeaksIndexSchema.parse(Object.values(indexFiles)[0]);

const loadDetails = () =>
  Object.entries(peakFiles).map(([path, json]) => ({
    fileId: idFromPath(path),
    detail: PeakDetailSchema.parse(json),
  }));

describe('generated data in public/data', () => {
  it('peaks.json has exactly 28 peaks and passes PeaksIndexSchema', () => {
    expect(Object.keys(indexFiles)).toHaveLength(1);
    const index = loadIndex();
    expect(index.peaks).toHaveLength(KGP_PEAK_COUNT);
    expect(new Set(index.peaks.map((p) => p.id)).size).toBe(KGP_PEAK_COUNT);
  });

  it('every peak file passes PeakDetailSchema and has 1–3 routes', () => {
    const index = loadIndex();
    const details = loadDetails();
    expect(details.map((d) => d.fileId).sort()).toEqual(index.peaks.map((p) => p.id).sort());
    for (const { fileId, detail } of details) {
      expect(detail.peakId, fileId).toBe(fileId);
      expect(detail.routes.length, fileId).toBeGreaterThanOrEqual(1);
      expect(detail.routes.length, fileId).toBeLessThanOrEqual(3);
      for (const route of detail.routes) {
        expect(route.id.startsWith(`${fileId}--`), route.id).toBe(true);
      }
    }
  });

  it('routeCount in peaks.json equals routes.length in the peak file', () => {
    const index = loadIndex();
    const details = new Map(loadDetails().map((d) => [d.fileId, d.detail]));
    expect(details.size).toBe(KGP_PEAK_COUNT);
    for (const peak of index.peaks) {
      expect(details.get(peak.id)?.routes.length, peak.id).toBe(peak.routeCount);
    }
  });

  it('last point of every route lies within 150 m of its peak', () => {
    const index = loadIndex();
    const details = new Map(loadDetails().map((d) => [d.fileId, d.detail]));
    let checked = 0;
    for (const peak of index.peaks) {
      for (const route of details.get(peak.id)?.routes ?? []) {
        const last = route.geometry.coordinates.at(-1);
        expect(last, route.id).toBeDefined();
        const d = distanceM([last![0], last![1]], [peak.lon, peak.lat]);
        expect(d, `${route.id}: ${Math.round(d)} m from the summit`).toBeLessThanOrEqual(SUMMIT_TOLERANCE_M);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(KGP_PEAK_COUNT);
  });
});
