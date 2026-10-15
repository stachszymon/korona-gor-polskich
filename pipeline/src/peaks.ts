import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { haversineM } from './geo';
import type { OverpassNode } from './overpass';

export const PEAK_COUNT = 28;
/** Max distance between the listed coordinates and the OSM peak node. */
export const MAX_DISTANCE_M = 200;
/** Max difference between the listed elevation and the OSM `ele` tag. */
export const MAX_ELEVATION_DIFF_M = 10;

export const PeakSourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'id must be a slug'),
  name: z.string().min(1),
  range: z.string().min(1),
  /** Metres above sea level according to the official KGP list. */
  elevation: z.number().int().positive(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  osmNodeId: z.number().int().positive(),
  /** Set after a manual review to accept a distance or elevation mismatch with OSM. */
  acceptOsmMismatch: z.boolean().optional(),
});

export type PeakSource = z.infer<typeof PeakSourceSchema>;

export const PeakSourcesSchema = z
  .array(PeakSourceSchema)
  .length(PEAK_COUNT)
  .refine((peaks) => new Set(peaks.map((p) => p.id)).size === peaks.length, {
    message: 'peak ids must be unique',
  });

export async function loadPeakSources(path: string): Promise<PeakSource[]> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const parsed = PeakSourcesSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid peak list ${path}:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export interface OsmCheck {
  distanceM: number;
  /** OSM `ele` minus the listed elevation, or null when the node has no usable `ele`. */
  elevationDiffM: number | null;
  ok: boolean;
}

/** OSM `ele` is free text: accepts "1725", "1724.6" and "1725 m"; anything else counts as missing. */
function parseEle(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = /^\s*(-?\d+(?:[.,]\d+)?)\s*(?:m)?\s*$/i.exec(value);
  if (!match) return null;
  return Number(match[1]!.replace(',', '.'));
}

export function checkPeakAgainstOsm(src: PeakSource, node: OverpassNode): OsmCheck {
  const distanceM = haversineM([src.lon, src.lat], [node.lon, node.lat]);
  const ele = parseEle(node.tags?.ele);
  const elevationDiffM = ele === null ? null : ele - src.elevation;
  const withinTolerance =
    distanceM <= MAX_DISTANCE_M &&
    (elevationDiffM === null || Math.abs(elevationDiffM) <= MAX_ELEVATION_DIFF_M);
  return { distanceM, elevationDiffM, ok: withinTolerance || src.acceptOsmMismatch === true };
}
