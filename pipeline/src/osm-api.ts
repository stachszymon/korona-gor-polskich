/**
 * Fallback data source for days when the public Overpass servers are down: the OSM editing
 * API 0.6 (`map` and `nodes` calls). It answers the three queries the build sends
 * (`peakNodesQuery`, `hikingRelationsQuery`, `trailheadCandidatesQuery`) with responses
 * in the same shape Overpass gives.
 *
 * The `map` call returns everything inside a bbox (complete ways, relations that reference
 * them), so the circle around a peak is downloaded as tiles below the API limits
 * (0.25 deg², 50 000 nodes). Relation member ways outside the downloaded area have no geometry.
 */
import { haversineM } from './geo';
import type { OsmFetcher } from './cache';
import { USER_AGENT, type OverpassNode, type OverpassRelation, type OverpassResponse } from './overpass';

export const OSM_API_BASE = 'https://api.openstreetmap.org/api/0.6';

/** Default tile edge in degrees; tiles that still have too many nodes are split further. */
const DEFAULT_MAX_TILE_DEG = 0.05;
/** The OSM API usage policy asks for no more than about one request per second. */
const PAUSE_MS = 1000;
const METERS_PER_DEGREE_LAT = 111_320;
/** Never split below this edge; a refusal there is a real error. */
const MIN_TILE_DEG = 0.005;

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type OsmElement =
  | { type: 'node'; id: number; lat: number; lon: number; tags?: Record<string, string> }
  | { type: 'way'; id: number; nodes: number[]; tags?: Record<string, string> }
  | {
      type: 'relation';
      id: number;
      members: { type: 'node' | 'way' | 'relation'; ref: number; role: string }[];
      tags?: Record<string, string>;
    };

export interface OsmApiDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Retries per request after the first try (default 4), backoff 2 s, 4 s, 8 s... */
  retries?: number;
  maxTileDeg?: number;
  log?: (line: string) => void;
}

/** Bbox circumscribing the circle of `radiusM` around a point. */
export function bboxAround(lat: number, lon: number, radiusM: number): Bbox {
  const dLat = radiusM / METERS_PER_DEGREE_LAT;
  const dLon = radiusM / (METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
  return { west: lon - dLon, south: lat - dLat, east: lon + dLon, north: lat + dLat };
}

/** Splits a bbox into an even grid of tiles whose edges are at most `maxDeg`. */
export function splitBbox(b: Bbox, maxDeg: number): Bbox[] {
  const cols = Math.max(1, Math.ceil((b.east - b.west) / maxDeg - 1e-9));
  const rows = Math.max(1, Math.ceil((b.north - b.south) / maxDeg - 1e-9));
  const w = (b.east - b.west) / cols;
  const h = (b.north - b.south) / rows;
  const tiles: Bbox[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push({
        west: b.west + c * w,
        south: b.south + r * h,
        east: c === cols - 1 ? b.east : b.west + (c + 1) * w,
        north: r === rows - 1 ? b.north : b.south + (r + 1) * h,
      });
    }
  }
  return tiles;
}

const quarters = (b: Bbox): Bbox[] => splitBbox(b, Math.max(b.east - b.west, b.north - b.south) / 2);

type OsmNode = Extract<OsmElement, { type: 'node' }>;
type OsmWay = Extract<OsmElement, { type: 'way' }>;

/** `route=hiking` relations; way members carry `geometry` when all their nodes are known. */
export function toHikingRelations(elements: OsmElement[]): OverpassRelation[] {
  const nodes = new Map<number, OsmNode>();
  const ways = new Map<number, OsmWay>();
  for (const el of elements) {
    if (el.type === 'node') nodes.set(el.id, el);
    else if (el.type === 'way') ways.set(el.id, el);
  }
  const geometryOf = (wayId: number): { lat: number; lon: number }[] | undefined => {
    const way = ways.get(wayId);
    if (way === undefined) return undefined;
    const geometry: { lat: number; lon: number }[] = [];
    for (const id of way.nodes) {
      const n = nodes.get(id);
      if (n === undefined) return undefined;
      geometry.push({ lat: n.lat, lon: n.lon });
    }
    return geometry;
  };

  const out: OverpassRelation[] = [];
  for (const el of elements) {
    if (el.type !== 'relation' || el.tags?.['route'] !== 'hiking') continue;
    out.push({
      type: 'relation',
      id: el.id,
      tags: el.tags,
      members: el.members.map((m) => {
        if (m.type !== 'way') return { type: m.type, ref: m.ref, role: m.role };
        const geometry = geometryOf(m.ref);
        return geometry === undefined
          ? { type: 'way', ref: m.ref, role: m.role }
          : { type: 'way', ref: m.ref, role: m.role, geometry };
      }),
    });
  }
  return out;
}

const SETTLEMENTS = new Set(['village', 'town', 'hamlet']);

function isTrailheadPoi(tags: Record<string, string> | undefined): boolean {
  if (tags === undefined) return false;
  return (
    tags['amenity'] === 'parking' ||
    tags['railway'] === 'station' ||
    tags['railway'] === 'halt' ||
    tags['highway'] === 'bus_stop' ||
    SETTLEMENTS.has(tags['place'] ?? '')
  );
}

/**
 * Trailhead candidates like `trailheadCandidatesQuery` returns them: parking, station/halt,
 * bus stop and settlement nodes, plus parking ways as nodes at their bbox centre (like
 * Overpass `out center`), all within `radiusM`.
 */
export function toTrailheadPois(
  elements: OsmElement[],
  lat: number,
  lon: number,
  radiusM: number,
): OverpassNode[] {
  const nodes = new Map<number, OsmNode>();
  for (const el of elements) if (el.type === 'node') nodes.set(el.id, el);
  const within = (p: { lat: number; lon: number }) => haversineM([lon, lat], [p.lon, p.lat]) <= radiusM;

  const out: OverpassNode[] = [];
  for (const el of elements) {
    if (el.type === 'node' && isTrailheadPoi(el.tags) && within(el)) {
      out.push({ type: 'node', id: el.id, lat: el.lat, lon: el.lon, tags: el.tags! });
    } else if (el.type === 'way' && el.tags?.['amenity'] === 'parking') {
      const pts = el.nodes.map((id) => nodes.get(id)).filter((n): n is OsmNode => n !== undefined);
      if (pts.length === 0) continue;
      const lats = pts.map((p) => p.lat);
      const lons = pts.map((p) => p.lon);
      const centre = {
        lat: (Math.min(...lats) + Math.max(...lats)) / 2,
        lon: (Math.min(...lons) + Math.max(...lons)) / 2,
      };
      if (within(centre)) out.push({ type: 'node', id: el.id, ...centre, tags: el.tags });
    }
  }
  return out;
}

class TooManyNodesError extends Error {}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const AROUND = String.raw`\(around:(\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\)`;
const RELATIONS_RE = new RegExp(String.raw`rel${AROUND}\[route=hiking\]`);
const POIS_RE = new RegExp(String.raw`node\[amenity=parking\]${AROUND}`);
const NODES_RE = /node\(id:([\d,]+)\)/;

/**
 * An `OsmFetcher` backed by the OSM API instead of Overpass. Requests are sequential with
 * a pause of at least 1 s after each; the merged tiles of the last peak are kept so the
 * relations and trailhead queries of one peak share the downloads.
 */
export function osmApiFetcher(deps: OsmApiDeps = {}): OsmFetcher {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const retries = deps.retries ?? 4;
  const maxTileDeg = deps.maxTileDeg ?? DEFAULT_MAX_TILE_DEG;
  const log = deps.log ?? (() => {});
  let lastArea: { key: string; elements: OsmElement[] } | undefined;

  async function getJson(url: string): Promise<{ elements: OsmElement[] }> {
    const failures: string[] = [];
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(2000 * 2 ** (attempt - 1));
      let response: Response;
      try {
        response = await doFetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        continue;
      } finally {
        await sleep(PAUSE_MS);
      }
      if (response.status === 400) {
        const text = await response.text();
        if (/too many nodes/i.test(text)) throw new TooManyNodesError(text);
        throw new Error(`HTTP 400 for ${url}: ${text}`);
      }
      if (!response.ok) {
        failures.push(`HTTP ${response.status}`);
        continue;
      }
      return (await response.json()) as { elements: OsmElement[] };
    }
    throw new Error(`OSM API request failed: ${url}\n${failures.join('\n')}`);
  }

  async function fetchTile(tile: Bbox, into: Map<string, OsmElement>): Promise<void> {
    const bbox = [tile.west, tile.south, tile.east, tile.north].map((v) => v.toFixed(6)).join(',');
    try {
      const { elements } = await getJson(`${OSM_API_BASE}/map.json?bbox=${bbox}`);
      for (const el of elements) into.set(`${el.type}/${el.id}`, el);
    } catch (error) {
      if (!(error instanceof TooManyNodesError) || tile.east - tile.west < MIN_TILE_DEG) throw error;
      log(`  osm-api: tile ${bbox} has too many nodes, splitting`);
      for (const q of quarters(tile)) await fetchTile(q, into);
    }
  }

  async function area(lat: number, lon: number, radiusM: number): Promise<OsmElement[]> {
    const key = `${lat},${lon},${radiusM}`;
    if (lastArea?.key === key) return lastArea.elements;
    const tiles = splitBbox(bboxAround(lat, lon, radiusM), maxTileDeg);
    const merged = new Map<string, OsmElement>();
    for (const [i, tile] of tiles.entries()) {
      log(`  osm-api: tile ${i + 1}/${tiles.length}`);
      await fetchTile(tile, merged);
    }
    lastArea = { key, elements: [...merged.values()] };
    return lastArea.elements;
  }

  return async (query) => {
    const rel = RELATIONS_RE.exec(query);
    if (rel) {
      const [, r, lat, lon] = rel.map(Number) as [number, number, number, number];
      return { elements: toHikingRelations(await area(lat, lon, r)) };
    }
    const pois = POIS_RE.exec(query);
    if (pois) {
      const [, r, lat, lon] = pois.map(Number) as [number, number, number, number];
      return { elements: toTrailheadPois(await area(lat, lon, r), lat, lon, r) };
    }
    const ids = NODES_RE.exec(query);
    if (ids) {
      const { elements } = await getJson(`${OSM_API_BASE}/nodes.json?nodes=${ids[1]}`);
      const response: OverpassResponse = {
        elements: elements.filter((e): e is OsmNode => e.type === 'node'),
      };
      return response;
    }
    throw new Error(`osm-api source cannot answer this query: ${query}`);
  };
}
