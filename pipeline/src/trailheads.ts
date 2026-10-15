import type { TrailheadKind } from '../../src/data/schema';
import { haversineM, type LonLat } from './geo';
import { nearestVertex, type TrailGraph } from './graph';
import type { OverpassNode } from './overpass';

export interface Trailhead {
  id: string;
  name: string;
  kind: TrailheadKind;
  lon: number;
  lat: number;
  vertex: string;
}

export interface ManualTrailhead {
  name: string;
  lat: number;
  lon: number;
}

export interface FindTrailheadsOptions {
  /** Maximum distance from a POI to the nearest trail vertex (default 300 m). */
  maxDistM?: number;
  /** Hand-curated starts; they win over any automatically found POI on the same vertex. */
  manual?: ManualTrailhead[];
}

const DEFAULT_MAX_DIST_M = 300;
const FALLBACK_SLUG = 'start';

const POLISH_TO_ASCII: Record<string, string> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
};

/** Lowercase ASCII slug: Polish letters transliterated, other runs of non-alphanumerics become one `-`. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => POLISH_TO_ASCII[c] ?? c)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Higher number wins when several candidates snap to the same vertex. */
const KIND_RANK: Record<TrailheadKind, number> = {
  manual: 4,
  parking: 3,
  station: 2,
  bus_stop: 1,
  place: 0,
};

/** Parkings with these `access` values are not usable by visitors. */
const CLOSED_ACCESS = new Set(['private', 'no', 'customers']);

function kindOf(tags: Record<string, string> | undefined): TrailheadKind | null {
  if (!tags) return null;
  if (tags['amenity'] === 'parking') return CLOSED_ACCESS.has(tags['access'] ?? '') ? null : 'parking';
  if (tags['railway'] === 'station' || tags['railway'] === 'halt') return 'station';
  if (tags['highway'] === 'bus_stop') return 'bus_stop';
  if (tags['place'] !== undefined) return 'place';
  return null;
}

const SETTLEMENT_PLACES = new Set(['village', 'town', 'hamlet']);

/** Trimmed name; a missing or whitespace-only name becomes the empty string (= unnamed). */
const cleanName = (name: string | undefined): string => (name ?? '').trim();

interface Candidate {
  name: string;
  kind: TrailheadKind;
  lon: number;
  lat: number;
  vertex: string;
  distM: number;
}

/** Candidate `a` should replace `b` on the same vertex. */
function beats(a: Candidate, b: Candidate): boolean {
  if (a.kind !== b.kind) return KIND_RANK[a.kind] > KIND_RANK[b.kind];
  if (a.distM !== b.distM) return a.distM < b.distM;
  // Fully deterministic regardless of input order.
  if (a.lon !== b.lon) return a.lon < b.lon;
  if (a.lat !== b.lat) return a.lat < b.lat;
  return a.name < b.name;
}

/**
 * Trailhead candidates: parkings (except private ones), stations/halts, bus stops and places that lie within
 * `maxDistM` of a trail vertex. One trailhead per vertex (parking > station > bus_stop > place;
 * manual points beat all of them). Unnamed POIs borrow the name of the nearest named place POI
 * and are dropped when there is none. Ids are slugs of the names, with `-2`, `-3`... for
 * duplicates, numbered in order of longitude, then latitude.
 *
 * POIs are never keyed by OSM id: way centers arrive as nodes carrying the way id, so ids
 * from different element types may collide.
 */
export function findTrailheads(
  graph: TrailGraph,
  pois: OverpassNode[],
  opts: FindTrailheadsOptions = {},
): Trailhead[] {
  const maxDistM = opts.maxDistM ?? DEFAULT_MAX_DIST_M;

  // Names are only borrowed from settlements (miejscowość), not from suburbs, regions etc.
  const places: { name: string; pos: LonLat }[] = [];
  for (const p of pois) {
    const place = p.tags?.['place'];
    const name = cleanName(p.tags?.['name']);
    if (name && place !== undefined && SETTLEMENT_PLACES.has(place)) {
      places.push({ name, pos: [p.lon, p.lat] });
    }
  }
  const nearestPlaceName = (p: LonLat): string | undefined => {
    let best: string | undefined;
    let bestDist = Infinity;
    for (const place of places) {
      const d = haversineM(p, place.pos);
      if (d < bestDist) {
        bestDist = d;
        best = place.name;
      }
    }
    return best;
  };

  const byVertex = new Map<string, Candidate>();
  const consider = (name: string, kind: TrailheadKind, lon: number, lat: number): void => {
    const position: LonLat = [lon, lat];
    const vertex = nearestVertex(graph, position, maxDistM);
    if (vertex === null) return;
    const candidate: Candidate = {
      name,
      kind,
      lon,
      lat,
      vertex,
      distM: haversineM(position, graph.vertices.get(vertex)!),
    };
    const current = byVertex.get(vertex);
    if (current === undefined || beats(candidate, current)) byVertex.set(vertex, candidate);
  };

  for (const poi of pois) {
    const kind = kindOf(poi.tags);
    if (kind === null) continue;
    const name = cleanName(poi.tags?.['name']) || nearestPlaceName([poi.lon, poi.lat]);
    if (!name) continue;
    consider(name, kind, poi.lon, poi.lat);
  }
  for (const m of opts.manual ?? []) {
    const name = cleanName(m.name);
    if (name) consider(name, 'manual', m.lon, m.lat);
  }

  const sorted = [...byVertex.values()].sort(
    (a, b) => a.lon - b.lon || a.lat - b.lat || (a.vertex < b.vertex ? -1 : a.vertex > b.vertex ? 1 : 0),
  );

  const used = new Set<string>();
  return sorted.map(({ name, kind, lon, lat, vertex }) => {
    const base = slugify(name) || FALLBACK_SLUG;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return { id, name, kind, lon, lat, vertex };
  });
}
