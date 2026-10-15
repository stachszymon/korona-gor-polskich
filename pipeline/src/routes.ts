import type { PttkColor, Route } from '../../src/data/schema';
import { ascentDescent, buildProfile, type DemSampler } from './elevation';
import { haversineM, roundCoord, simplifyLine, type LonLat } from './geo';
import type { TrailEdge, TrailGraph } from './graph';
import { estimateDurationMin } from './timing';
import type { Trailhead } from './trailheads';

export interface ShortestPaths {
  /** Distance in metres from the source; unreachable vertices are absent. */
  dist: Map<string, number>;
  /** Last step of the shortest path to a vertex: `edge` leads from `from` to that vertex. */
  prev: Map<string, { from: string; edge: TrailEdge }>;
}

export interface CandidateRoute {
  trailhead: Trailhead;
  /** From the trailhead's vertex to the summit vertex. */
  coords: LonLat[];
  lengthM: number;
  /** Distinct colours in order of first appearance from the trailhead. */
  colors: PttkColor[];
  /** Undirected edge key (see `edgeKey`) → length in metres. */
  edges: Map<string, number>;
}

export interface EnrichedRoute extends CandidateRoute {
  coords3d: [number, number, number][];
  profile: [number, number][];
  ascentM: number;
  descentM: number;
  durationMin: number;
}

export interface CandidateRouteOptions {
  minLenM?: number;
  maxLenM?: number;
}

export interface SelectRoutesOptions {
  maxCount?: number;
  minStartSeparationM?: number;
  maxOverlap?: number;
}

const SIMPLIFY_TOLERANCE_M = 5;

/**
 * Key of an undirected edge: the sorted vertex pair plus the OSM way id. Parallel edges
 * of different ways over the same ground get different keys (they are not merged).
 */
export const edgeKey = (a: string, b: string, wayId: number): string =>
  a < b ? `${a}|${b}|${wayId}` : `${b}|${a}|${wayId}`;

interface HeapItem {
  d: number;
  v: string;
}

const before = (x: HeapItem, y: HeapItem): boolean => x.d < y.d || (x.d === y.d && x.v < y.v);

/** Minimal binary min-heap ordered by distance, then vertex key (deterministic). */
class MinHeap {
  private items: HeapItem[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: HeapItem): void {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(a[i]!, a[parent]!)) break;
      [a[i], a[parent]] = [a[parent]!, a[i]!];
      i = parent;
    }
  }

  pop(): HeapItem | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last !== undefined) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && before(a[l]!, a[m]!)) m = l;
        if (r < a.length && before(a[r]!, a[m]!)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }
}

/** Dijkstra from `source` over the trail graph (binary heap, lazy deletion). */
export function shortestPaths(graph: TrailGraph, source: string): ShortestPaths {
  const dist = new Map<string, number>([[source, 0]]);
  const prev = new Map<string, { from: string; edge: TrailEdge }>();
  const done = new Set<string>();
  const heap = new MinHeap();
  heap.push({ d: 0, v: source });

  while (heap.size > 0) {
    const { d, v } = heap.pop()!;
    if (done.has(v)) continue;
    done.add(v);
    for (const edge of graph.adj.get(v) ?? []) {
      if (done.has(edge.to)) continue;
      const nd = d + edge.lengthM;
      const current = dist.get(edge.to);
      if (current === undefined || nd < current) {
        dist.set(edge.to, nd);
        prev.set(edge.to, { from: v, edge });
        heap.push({ d: nd, v: edge.to });
      }
    }
  }
  return { dist, prev };
}

/**
 * One candidate per trailhead: the shortest path from the trailhead to the summit,
 * kept when its length is within [minLenM, maxLenM] (defaults 1 km and 20 km).
 * Trailheads that cannot reach the summit are skipped.
 */
export function candidateRoutes(
  graph: TrailGraph,
  summitVertex: string,
  trailheads: Trailhead[],
  opts: CandidateRouteOptions = {},
): CandidateRoute[] {
  const minLenM = opts.minLenM ?? 1000;
  const maxLenM = opts.maxLenM ?? 20_000;
  const { dist, prev } = shortestPaths(graph, summitVertex);
  const out: CandidateRoute[] = [];

  for (const trailhead of trailheads) {
    const lengthM = dist.get(trailhead.vertex);
    if (lengthM === undefined || lengthM < minLenM || lengthM > maxLenM) continue;

    // The prev chain from the trailhead leads towards the summit (the Dijkstra source).
    const coords: LonLat[] = [graph.vertices.get(trailhead.vertex)!];
    const colors: PttkColor[] = [];
    const seen = new Set<PttkColor>();
    const edges = new Map<string, number>();
    let v = trailhead.vertex;
    while (v !== summitVertex) {
      const step = prev.get(v)!;
      for (const c of step.edge.colors) {
        if (!seen.has(c)) {
          seen.add(c);
          colors.push(c);
        }
      }
      const key = edgeKey(step.from, v, step.edge.wayId);
      edges.set(key, (edges.get(key) ?? 0) + step.edge.lengthM);
      v = step.from;
      coords.push(graph.vertices.get(v)!);
    }
    out.push({ trailhead, coords, lengthM, colors, edges });
  }
  return out;
}

/** Adds DEM heights (sampled every 25 m), ascent/descent and the estimated duration. */
export async function enrichRoute(c: CandidateRoute, sampler: DemSampler): Promise<EnrichedRoute> {
  const { coords3d, profile } = await buildProfile(c.coords, sampler);
  const { ascentM, descentM } = ascentDescent(profile);
  const durationMin = estimateDurationMin(c.lengthM / 1000, ascentM);
  return { ...c, coords3d, profile, ascentM, descentM, durationMin };
}

/** Share of `candidate`'s length that runs over edges of `selected`. */
function overlap(candidate: CandidateRoute, selected: CandidateRoute): number {
  if (candidate.lengthM <= 0) return 0;
  let shared = 0;
  for (const [key, len] of candidate.edges) {
    if (selected.edges.has(key)) shared += len;
  }
  return shared / candidate.lengthM;
}

const startOf = (r: CandidateRoute): LonLat => [r.trailhead.lon, r.trailhead.lat];

/**
 * Greedy selection by estimated duration (ties: shorter first, then trailhead id).
 * A route is taken only when its start lies at least `minStartSeparationM` from every
 * selected start and at most `maxOverlap` of its length is shared with any selected route.
 */
export function selectRoutes(routes: EnrichedRoute[], opts: SelectRoutesOptions = {}): EnrichedRoute[] {
  const maxCount = opts.maxCount ?? 3;
  const minStartSeparationM = opts.minStartSeparationM ?? 2000;
  const maxOverlap = opts.maxOverlap ?? 0.5;

  const ranked = [...routes].sort(
    (a, b) =>
      a.durationMin - b.durationMin ||
      a.lengthM - b.lengthM ||
      (a.trailhead.id < b.trailhead.id ? -1 : a.trailhead.id > b.trailhead.id ? 1 : 0),
  );

  const selected: EnrichedRoute[] = [];
  for (const r of ranked) {
    if (selected.length >= maxCount) break;
    const ok = selected.every(
      (s) => haversineM(startOf(r), startOf(s)) >= minStartSeparationM && overlap(r, s) <= maxOverlap,
    );
    if (ok) selected.push(r);
  }
  return selected;
}

/**
 * Converts a selected route to the shared schema: simplified (Douglas-Peucker, 5 m)
 * and rounded geometry, each point keeping the height of its nearest `coords3d` point.
 */
export function toRoute(peakId: string, r: EnrichedRoute, peakName: string): Route {
  const flat = r.coords3d.map((p): LonLat => [p[0], p[1]]);
  const simplified = simplifyLine(flat, SIMPLIFY_TOLERANCE_M);

  // Simplified points keep their order along the line, so search forward from the last match.
  let from = 0;
  const coordinates = simplified.map((p): [number, number, number] => {
    let best = from;
    let bestDist = Infinity;
    for (let i = from; i < flat.length; i++) {
      const d = haversineM(p, flat[i]!);
      if (d < bestDist) {
        bestDist = d;
        best = i;
        if (d === 0) break;
      }
    }
    from = best;
    return [roundCoord(p[0]), roundCoord(p[1]), Math.round(r.coords3d[best]![2])];
  });

  const { trailhead } = r;
  return {
    id: `${peakId}--${trailhead.id}`,
    name: `${trailhead.name} → ${peakName}`,
    trailhead: {
      name: trailhead.name,
      lat: roundCoord(trailhead.lat),
      lon: roundCoord(trailhead.lon),
      kind: trailhead.kind,
    },
    distanceKm: Math.round(r.lengthM / 100) / 10,
    ascentM: r.ascentM,
    descentM: r.descentM,
    durationMin: r.durationMin,
    colors: [...r.colors],
    geometry: { type: 'LineString', coordinates },
    profile: r.profile.map(([d, h]): [number, number] => [d, h]),
  };
}
