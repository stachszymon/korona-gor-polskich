import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Route } from '../../src/data/schema';
import type { ManualTrailhead } from './trailheads';

const ManualTrailheadSchema = z.strictObject({
  name: z.string().trim().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

/** Manual fixes for one peak. Unknown keys are rejected so a typo cannot be silently ignored. */
const PeakOverridesSchema = z.strictObject({
  /** Trailhead ids to drop before route selection. */
  exclude: z.array(z.string().min(1)).optional(),
  /** Route id (`<peakId>--<trailheadId>`) → display name. */
  rename: z.record(z.string().regex(/^[a-z0-9-]+--[a-z0-9-]+$/), z.string().trim().min(1)).optional(),
  /** Extra starts treated like any other trailhead candidate (kind `manual`). */
  addTrailhead: z.array(ManualTrailheadSchema).optional(),
});

/** `route-overrides.json`, keyed by peakId. */
export const RouteOverridesSchema = z.record(z.string().regex(/^[a-z0-9-]+$/), PeakOverridesSchema);
export type RouteOverrides = z.infer<typeof RouteOverridesSchema>;

/** Reads and validates the overrides file; errors name the file and the offending JSON path. */
export async function loadOverrides(path: string): Promise<RouteOverrides> {
  const text = await readFile(path, 'utf8');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  const parsed = RouteOverridesSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${path}: invalid route overrides:\n${z.prettifyError(parsed.error)}`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export function excludedTrailheads(o: RouteOverrides, peakId: string): Set<string> {
  return new Set(o[peakId]?.exclude ?? []);
}

/** Starts to pass to `findTrailheads(..., { manual })`. */
export function manualTrailheads(o: RouteOverrides, peakId: string): ManualTrailhead[] {
  return (o[peakId]?.addTrailhead ?? []).map(({ name, lat, lon }) => ({ name, lat, lon }));
}

/** Returns copies of the routes with display names replaced by the peak's `rename` map. */
export function applyRenames(routes: Route[], o: RouteOverrides, peakId: string): Route[] {
  const rename = o[peakId]?.rename ?? {};
  return routes.map((r) => {
    const name = rename[r.id];
    return name === undefined ? r : { ...r, name };
  });
}
