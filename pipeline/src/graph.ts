import { PTTK_COLORS, type PttkColor } from '../../src/data/schema';
import { haversineM, type LonLat } from './geo';
import type { OverpassRelation, OverpassWayMember } from './overpass';
import { trailColor } from './osmc';

export interface TrailEdge {
  to: string;
  lengthM: number;
  colors: PttkColor[];
  wayId: number;
}

export interface TrailGraph {
  vertices: Map<string, LonLat>;
  adj: Map<string, TrailEdge[]>;
}

export interface SkippedRelation {
  id: number;
  name?: string;
  reason: 'no-color' | 'unsupported-color';
}

export interface TrailPart {
  colors: PttkColor[];
  name?: string;
  coords: LonLat[];
}

export const vertexKey = (p: LonLat): string => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;

const sortColors = (colors: Iterable<PttkColor>): PttkColor[] => {
  const set = new Set(colors);
  return PTTK_COLORS.filter((c) => set.has(c));
};

const isWayMember = (m: OverpassRelation['members'][number]): m is OverpassWayMember =>
  m.type === 'way';

interface WayAccumulator {
  wayId: number;
  coords: LonLat[];
  colors: Set<PttkColor>;
  name?: string;
}

/**
 * Builds an undirected trail graph (two directed edges per segment) from hiking
 * relations with `out geom` geometry. Every point of a way is a vertex. A way shared
 * by several relations yields one edge pair carrying the union of their colors.
 */
export function buildTrailGraph(relations: OverpassRelation[]): {
  graph: TrailGraph;
  skipped: SkippedRelation[];
  trails: TrailPart[];
} {
  const skipped: SkippedRelation[] = [];
  const ways = new Map<number, WayAccumulator>();

  for (const relation of relations) {
    const color = trailColor(relation.tags);
    const name = relation.tags['name'];
    if (color === null) {
      const hasColorTag =
        relation.tags['osmc:symbol'] !== undefined || relation.tags['colour'] !== undefined;
      skipped.push({
        id: relation.id,
        ...(name !== undefined ? { name } : {}),
        reason: hasColorTag ? 'unsupported-color' : 'no-color',
      });
      continue;
    }
    for (const member of relation.members) {
      if (!isWayMember(member) || !member.geometry || member.geometry.length < 2) continue;
      let way = ways.get(member.ref);
      if (!way) {
        way = {
          wayId: member.ref,
          coords: member.geometry.map((p): LonLat => [p.lon, p.lat]),
          colors: new Set(),
        };
        ways.set(member.ref, way);
      }
      way.colors.add(color);
      if (way.name === undefined && name !== undefined) way.name = name;
    }
  }

  const graph: TrailGraph = { vertices: new Map(), adj: new Map() };
  const trails: TrailPart[] = [];

  const addVertex = (p: LonLat): string => {
    const key = vertexKey(p);
    if (!graph.vertices.has(key)) {
      graph.vertices.set(key, p);
      graph.adj.set(key, []);
    }
    return key;
  };

  for (const way of ways.values()) {
    const colors = sortColors(way.colors);
    trails.push({ colors, ...(way.name !== undefined ? { name: way.name } : {}), coords: way.coords });

    let prev: LonLat | undefined;
    let prevKey: string | undefined;
    for (const point of way.coords) {
      const key = addVertex(point);
      if (prev !== undefined && prevKey !== undefined && key !== prevKey) {
        const lengthM = haversineM(prev, point);
        graph.adj.get(prevKey)!.push({ to: key, lengthM, colors, wayId: way.wayId });
        graph.adj.get(key)!.push({ to: prevKey, lengthM, colors, wayId: way.wayId });
      }
      prev = point;
      prevKey = key;
    }
  }

  return { graph, skipped, trails };
}

/** Key of the vertex closest to `p`, or null when none is within `maxDistM`. */
export function nearestVertex(graph: TrailGraph, p: LonLat, maxDistM: number): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const [key, vertex] of graph.vertices) {
    const d = haversineM(p, vertex);
    if (d < bestDist) {
      bestDist = d;
      best = key;
    }
  }
  return bestDist <= maxDistM ? best : null;
}

/** Way id of edges added by `addUnmarkedPath` (real OSM way ids are positive). */
export const UNMARKED_WAY_ID = -1;

/**
 * Adds an unmarked path (no PTTK colour) to the graph, e.g. the short path from a marked
 * trail to a summit that no trail reaches. The last point is snapped to the nearest graph
 * vertex within `snapM`; when there is none, nothing is added and `false` is returned.
 */
export function addUnmarkedPath(graph: TrailGraph, coords: LonLat[], snapM: number): boolean {
  const last = coords.at(-1);
  if (coords.length < 2 || last === undefined) return false;
  const joint = nearestVertex(graph, last, snapM);
  if (joint === null) return false;

  const points = [...coords.slice(0, -1), graph.vertices.get(joint)!];
  let prevKey: string | undefined;
  let prev: LonLat | undefined;
  for (const point of points) {
    const key = vertexKey(point);
    if (!graph.vertices.has(key)) {
      graph.vertices.set(key, point);
      graph.adj.set(key, []);
    }
    if (prev !== undefined && prevKey !== undefined && key !== prevKey) {
      const lengthM = haversineM(prev, point);
      graph.adj.get(prevKey)!.push({ to: key, lengthM, colors: [], wayId: UNMARKED_WAY_ID });
      graph.adj.get(key)!.push({ to: prevKey, lengthM, colors: [], wayId: UNMARKED_WAY_ID });
    }
    prev = point;
    prevKey = key;
  }
  return true;
}
