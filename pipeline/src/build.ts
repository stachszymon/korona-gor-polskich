import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  PeakDetailSchema,
  PeaksIndexSchema,
  type PeakDetail,
  type PeaksIndex,
  type TrailFeature,
} from '../../src/data/schema';
import { createDemSampler, type FetchTile } from './elevation';
import { roundCoord, simplifyLine, type LonLat } from './geo';
import { buildTrailGraph, nearestVertex, type SkippedRelation, type TrailPart } from './graph';
import {
  applyRenames,
  excludedTrailheads,
  manualTrailheads,
  type RouteOverrides,
} from './overrides';
import {
  hikingRelationsQuery,
  peakNodesQuery,
  trailheadCandidatesQuery,
  type OverpassNode,
  type OverpassRelation,
  type OverpassResponse,
} from './overpass';
import { checkPeakAgainstOsm, MAX_DISTANCE_M, MAX_ELEVATION_DIFF_M, type PeakSource } from './peaks';
import { candidateRoutes, enrichRoute, selectRoutes, toRoute } from './routes';
import { findTrailheads } from './trailheads';

export interface BuildDeps {
  overpass(query: string): Promise<OverpassResponse>;
  fetchTile: FetchTile;
  overrides: RouteOverrides;
  now(): Date;
  log(line: string): void;
}

export interface PeakReport {
  peakId: string;
  /** Hiking relations returned by Overpass (before colour filtering). */
  relations: number;
  skipped: SkippedRelation[];
  routes: { id: string; name: string; distanceKm: number; durationMin: number }[];
  sizeBytes: number;
  warnings: string[];
  errors: string[];
}

/** Radius of both Overpass queries around a summit. */
export const QUERY_RADIUS_M = 10_000;
/** The summit must lie this close to a trail vertex. */
export const SUMMIT_SNAP_M = 150;
/** Larger peak files are reported as a warning. */
export const MAX_PEAK_FILE_BYTES = 500_000;

const TRAIL_SIMPLIFY_TOLERANCE_M = 5;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Content of `peaks/<id>.json`; compact, because the size limit applies to it. */
const serializeDetail = (detail: PeakDetail): string => `${JSON.stringify(detail)}\n`;

/** Trails for display: simplified (5 m), rounded to 5 digits, consecutive duplicates removed. */
function toTrailFeature(part: TrailPart): TrailFeature | null {
  const coordinates: [number, number][] = [];
  for (const p of simplifyLine(part.coords, TRAIL_SIMPLIFY_TOLERANCE_M)) {
    const rounded: LonLat = [roundCoord(p[0]), roundCoord(p[1])];
    const last = coordinates.at(-1);
    if (last === undefined || last[0] !== rounded[0] || last[1] !== rounded[1]) {
      coordinates.push(rounded);
    }
  }
  if (coordinates.length < 2) return null;
  return {
    type: 'Feature',
    properties: { colors: part.colors, ...(part.name !== undefined ? { name: part.name } : {}) },
    geometry: { type: 'LineString', coordinates },
  };
}

const isRelation = (el: OverpassResponse['elements'][number]): el is OverpassRelation =>
  el.type === 'relation';
const isNode = (el: OverpassResponse['elements'][number]): el is OverpassNode => el.type === 'node';

/**
 * Builds one peak: Overpass trails and trailhead candidates, trail graph, routes with DEM
 * heights. Domain problems (no trail at the summit, no route left) end up in `report.errors`;
 * Overpass and DEM failures are thrown.
 */
export async function buildPeak(
  src: PeakSource,
  deps: BuildDeps,
): Promise<{ detail: PeakDetail; report: PeakReport }> {
  const report: PeakReport = {
    peakId: src.id,
    relations: 0,
    skipped: [],
    routes: [],
    sizeBytes: 0,
    warnings: [],
    errors: [],
  };
  const peakOverrides = deps.overrides[src.id];

  const relationsResponse = await deps.overpass(hikingRelationsQuery(src.lat, src.lon, QUERY_RADIUS_M));
  const poisResponse = await deps.overpass(trailheadCandidatesQuery(src.lat, src.lon, QUERY_RADIUS_M));
  const relations = relationsResponse.elements.filter(isRelation);
  const pois = poisResponse.elements.filter(isNode);

  const { graph, skipped, trails } = buildTrailGraph(relations);
  report.relations = relations.length;
  report.skipped = skipped;

  const features = trails.map(toTrailFeature).filter((f): f is TrailFeature => f !== null);
  let routes: PeakDetail['routes'] = [];

  for (const key of Object.keys(peakOverrides?.rename ?? {})) {
    if (!key.startsWith(`${src.id}--`)) {
      report.warnings.push(`override rename "${key}": the id does not belong to peak ${src.id}`);
    }
  }

  const summit = nearestVertex(graph, [src.lon, src.lat], SUMMIT_SNAP_M);
  if (summit === null) {
    report.errors.push(`no trail vertex within ${SUMMIT_SNAP_M} m of the summit`);
  } else {
    const manual = manualTrailheads(deps.overrides, src.id);
    const found = findTrailheads(graph, pois, { manual });
    for (const m of manual) {
      if (!found.some((t) => t.kind === 'manual' && t.name === m.name.trim())) {
        report.warnings.push(
          `override addTrailhead "${m.name}": no trail vertex within 300 m, or another manual start on the same vertex`,
        );
      }
    }
    const excluded = excludedTrailheads(deps.overrides, src.id);
    const known = new Set(found.map((t) => t.id));
    for (const id of excluded) {
      if (!known.has(id)) report.warnings.push(`override exclude: unknown trailhead id "${id}"`);
    }

    const candidates = candidateRoutes(
      graph,
      summit,
      found.filter((t) => !excluded.has(t.id)),
    );
    // One sampler (and tile cache) per peak keeps memory bounded.
    const sampler = createDemSampler(deps.fetchTile);
    const enriched = [];
    for (const candidate of candidates) enriched.push(await enrichRoute(candidate, sampler));

    const selected = selectRoutes(enriched);
    routes = applyRenames(
      selected.map((r) => toRoute(src.id, r, src.name)),
      deps.overrides,
      src.id,
    );

    const routeIds = new Set(routes.map((r) => r.id));
    for (const key of Object.keys(peakOverrides?.rename ?? {})) {
      if (key.startsWith(`${src.id}--`) && !routeIds.has(key)) {
        report.warnings.push(`override rename "${key}": no such route among the selected routes`);
      }
    }
    if (routes.length === 0) {
      report.errors.push(
        `no routes after selection (${found.length} trailheads, ${candidates.length} candidates of 1-20 km)`,
      );
    }
  }

  const detail: PeakDetail = {
    peakId: src.id,
    trails: { type: 'FeatureCollection', features },
    routes,
  };
  const valid = PeakDetailSchema.safeParse(detail);
  if (!valid.success) {
    report.errors.push(`peak file does not match the schema: ${valid.error.message}`);
  }
  report.routes = routes.map((r) => ({
    id: r.id,
    name: r.name,
    distanceKm: r.distanceKm,
    durationMin: r.durationMin,
  }));
  report.sizeBytes = Buffer.byteLength(serializeDetail(detail));
  if (report.sizeBytes > MAX_PEAK_FILE_BYTES) {
    report.warnings.push(
      `peak file is ${report.sizeBytes} bytes, above the ${MAX_PEAK_FILE_BYTES} byte limit`,
    );
  }
  return { detail, report };
}

function emptyReport(peakId: string): PeakReport {
  return { peakId, relations: 0, skipped: [], routes: [], sizeBytes: 0, warnings: [], errors: [] };
}

/** Compares every listed peak with its OSM node. `problems` hold the peaks that must stop the build. */
function validateAgainstOsm(
  sources: PeakSource[],
  response: OverpassResponse,
): { problems: PeakReport[]; warnings: Map<string, string[]> } {
  const nodes = new Map(response.elements.filter(isNode).map((n) => [n.id, n]));
  const problems: PeakReport[] = [];
  const warnings = new Map<string, string[]>();

  for (const src of sources) {
    const node = nodes.get(src.osmNodeId);
    if (node === undefined) {
      const report = emptyReport(src.id);
      report.errors.push(`OSM node ${src.osmNodeId} not found`);
      problems.push(report);
      continue;
    }
    const check = checkPeakAgainstOsm(src, node);
    const mismatch = `OSM node ${src.osmNodeId}: ${Math.round(check.distanceM)} m from the listed position, elevation difference ${
      check.elevationDiffM === null ? 'unknown (no ele tag)' : `${check.elevationDiffM} m`
    } (limits ${MAX_DISTANCE_M} m and ${MAX_ELEVATION_DIFF_M} m)`;
    const exceeds =
      check.distanceM > MAX_DISTANCE_M ||
      (check.elevationDiffM !== null && Math.abs(check.elevationDiffM) > MAX_ELEVATION_DIFF_M);
    if (!check.ok) {
      const report = emptyReport(src.id);
      report.errors.push(`${mismatch}; fix peaks.source.json or set acceptOsmMismatch after review`);
      problems.push(report);
    } else if (exceeds) {
      warnings.set(src.id, [`accepted mismatch with ${mismatch}`]);
    }
  }
  return { problems, warnings };
}

/**
 * Replaces `outDir` with `files` (relative path → content). Everything is written to
 * `${outDir}.tmp` first; then the old directory is renamed aside, the new one renamed into
 * place and the old one deleted. On any error `outDir` keeps its previous content.
 */
async function replaceDirectory(outDir: string, files: Map<string, string>): Promise<void> {
  const tmp = `${outDir}.tmp`;
  const old = `${outDir}.old`;
  await rm(tmp, { recursive: true, force: true });
  await rm(old, { recursive: true, force: true });
  try {
    await mkdir(tmp, { recursive: true });
    for (const [relPath, content] of files) {
      const target = join(tmp, relPath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }

    let movedAside = false;
    try {
      await rename(outDir, old);
      movedAside = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      await rename(tmp, outDir);
    } catch (error) {
      if (movedAside) await rename(old, outDir);
      throw error;
    }
    await rm(old, { recursive: true, force: true });
  } catch (error) {
    await rm(tmp, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Validates all peaks against OSM (one query), builds them one after another and, only when
 * every peak succeeded, replaces `outDir` atomically. Mismatches and per-peak errors give
 * `ok: false` with the reports; Overpass and DEM failures reject. `outDir` is untouched in both cases.
 */
export async function buildAll(
  sources: PeakSource[],
  deps: BuildDeps,
  outDir: string,
): Promise<{ ok: boolean; reports: PeakReport[] }> {
  const listed = new Set(sources.map((s) => s.id));
  for (const peakId of Object.keys(deps.overrides)) {
    if (!listed.has(peakId)) {
      deps.log(`warning: route-overrides.json has entries for unknown peak "${peakId}"`);
    }
  }

  deps.log(`validating ${sources.length} peaks against OSM`);
  const validation = validateAgainstOsm(sources, await deps.overpass(peakNodesQuery(sources.map((s) => s.osmNodeId))));
  if (validation.problems.length > 0) {
    deps.log(`${validation.problems.length} peaks do not match OSM, nothing was built`);
    return { ok: false, reports: validation.problems };
  }

  const reports: PeakReport[] = [];
  const details = new Map<string, PeakDetail>();
  for (const [i, src] of sources.entries()) {
    deps.log(`[${i + 1}/${sources.length}] ${src.id}`);
    let built;
    try {
      built = await buildPeak(src, deps);
    } catch (error) {
      throw new Error(`${src.id}: ${errorMessage(error)}`, { cause: error });
    }
    built.report.warnings.unshift(...(validation.warnings.get(src.id) ?? []));
    reports.push(built.report);
    details.set(src.id, built.detail);
    deps.log(
      `[${i + 1}/${sources.length}] ${src.id}: ${built.report.routes.length} routes, ${built.report.errors.length} errors`,
    );
  }

  if (reports.some((r) => r.errors.length > 0)) {
    deps.log('there were errors, the output directory was not changed');
    return { ok: false, reports };
  }

  const index: PeaksIndex = PeaksIndexSchema.parse({
    generatedAt: deps.now().toISOString(),
    peaks: sources.map((s) => ({
      id: s.id,
      name: s.name,
      range: s.range,
      elevation: s.elevation,
      lat: s.lat,
      lon: s.lon,
      routeCount: details.get(s.id)!.routes.length,
    })),
  });
  const files = new Map<string, string>([['peaks.json', `${JSON.stringify(index, null, 2)}\n`]]);
  for (const [id, detail] of details) files.set(join('peaks', `${id}.json`), serializeDetail(detail));

  await replaceDirectory(outDir, files);
  deps.log(`wrote ${files.size} files to ${outDir}`);
  return { ok: true, reports };
}

/** Human readable report: one block per peak, to be reviewed before committing the data. */
export function formatReport(reports: PeakReport[]): string {
  const lines: string[] = [];
  for (const r of reports) {
    lines.push(`== ${r.peakId} ==`);
    lines.push(`  relations: ${r.relations}, skipped: ${r.skipped.length}`);
    for (const s of r.skipped) {
      lines.push(`    skipped ${s.id}${s.name !== undefined ? ` "${s.name}"` : ''} (${s.reason})`);
    }
    lines.push(`  routes: ${r.routes.length}`);
    for (const route of r.routes) {
      lines.push(
        `    ${route.id}  ${route.name}  ${route.distanceKm} km  ${route.durationMin} min`,
      );
    }
    lines.push(`  size: ${r.sizeBytes} bytes`);
    for (const w of r.warnings) lines.push(`  WARNING: ${w}`);
    for (const e of r.errors) lines.push(`  ERROR: ${e}`);
    lines.push('');
  }
  return lines.join('\n');
}
