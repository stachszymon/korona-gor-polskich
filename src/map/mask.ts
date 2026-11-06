import type { MultiPolygon, Polygon, Position } from 'geojson';

/** Kilometres per degree of latitude. */
const KM_PER_DEGREE = 111.32;
const EARTH_RADIUS_KM = 6371;
/** At 16 km the Carpathian peaks fall apart into six pieces and Zakopane is outside; 20 km joins them into one. */
const DEFAULT_RADIUS_KM = 20;
const DEFAULT_SEGMENTS = 48;
const COORDINATE_FACTOR = 1e5;

export type MountainAreaOptions = {
  /** How far around every peak counts as "the mountains". */
  radiusKm?: number;
  /** Corners of the circle approximated around every peak. */
  segments?: number;
};

type LonLat = { lat: number; lon: number };

/** Great-circle distance in kilometres. */
function haversineKm(a: LonLat, b: LonLat): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Points of a circle of `radiusKm` around `center`, as lon/lat offsets. */
function circle(center: LonLat, radiusKm: number, segments: number): Position[] {
  const dLat = radiusKm / KM_PER_DEGREE;
  const dLon = radiusKm / (KM_PER_DEGREE * Math.cos((center.lat * Math.PI) / 180));
  const points: Position[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (2 * Math.PI * i) / segments;
    points.push([center.lon + dLon * Math.cos(angle), center.lat + dLat * Math.sin(angle)]);
  }
  return points;
}

function cross(o: Position, a: Position, b: Position): number {
  return (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
}

/** Andrew's monotone chain. Returns the hull without a closing point, counter-clockwise. */
function convexHull(points: Position[]): Position[] {
  const sorted = [...points].sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  if (sorted.length < 3) return sorted;
  const build = (input: Position[]): Position[] => {
    const chain: Position[] = [];
    for (const p of input) {
      while (chain.length >= 2 && cross(chain[chain.length - 2]!, chain[chain.length - 1]!, p) <= 0) chain.pop();
      chain.push(p);
    }
    chain.pop();
    return chain;
  };
  return [...build(sorted), ...build([...sorted].reverse())];
}

const closed = (ring: Position[]): Position[] => [...ring, ring[0]!];

/** Whether `point` lies inside the closed `ring` (ray casting). */
function pointInRing(point: Position, ring: Position[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi! > y! !== yj! > y! && x! < ((xj! - xi!) * (y! - yi!)) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
}

/** Whether `point` is inside the polygon's outer ring and outside all of its holes. */
export function pointInPolygon(point: Position, polygon: Position[][]): boolean {
  const [outer, ...holes] = polygon;
  return outer !== undefined && pointInRing(point, outer) && !holes.some((hole) => pointInRing(point, hole));
}

function segmentsCross(a: Position, b: Position, c: Position, d: Position): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Whether two closed rings overlap: an edge crossing, or one ring lying inside the other. */
export function ringsIntersect(a: Position[], b: Position[]): boolean {
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      if (segmentsCross(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!)) return true;
    }
  }
  return pointInRing(a[0]!, b) || pointInRing(b[0]!, a);
}

/** Single-linkage clusters (as lists of peak indexes): peaks within `maxKm` of each other, directly or via others. */
function clusterPeaks(peaks: LonLat[], maxKm: number): number[][] {
  const parent = peaks.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (let i = 0; i < peaks.length; i++) {
    for (let j = i + 1; j < peaks.length; j++) {
      if (haversineKm(peaks[i]!, peaks[j]!) <= maxKm) parent[find(j)] = find(i);
    }
  }
  const clusters = new Map<number, number[]>();
  peaks.forEach((_, i) => {
    const root = find(i);
    clusters.set(root, [...(clusters.get(root) ?? []), i]);
  });
  return [...clusters.values()];
}

const round = (value: number) => Math.round(value * COORDINATE_FACTOR) / COORDINATE_FACTOR;

/**
 * The "mountains": a convex area around every group of nearby peaks. Peaks closer than two radii
 * belong to one group; groups whose areas still overlap are merged, so the areas never overlap.
 * Pure: depends only on the arguments.
 */
export function mountainAreas(peaks: LonLat[], options: MountainAreaOptions = {}): MultiPolygon {
  const radiusKm = options.radiusKm ?? DEFAULT_RADIUS_KM;
  const segments = options.segments ?? DEFAULT_SEGMENTS;
  const circles = peaks.map((peak) => circle(peak, radiusKm, segments));

  type Area = { points: Position[]; hull: Position[] };
  const areas: Area[] = clusterPeaks(peaks, 2 * radiusKm).map((members) => {
    const points = members.flatMap((i) => circles[i]!);
    return { points, hull: closed(convexHull(points)) };
  });

  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < areas.length; i++) {
      for (let j = i + 1; j < areas.length; j++) {
        if (!ringsIntersect(areas[i]!.hull, areas[j]!.hull)) continue;
        const points = [...areas[i]!.points, ...areas[j]!.points];
        areas.splice(j, 1);
        areas[i] = { points, hull: closed(convexHull(points)) };
        merged = true;
        break outer;
      }
    }
  }

  return {
    type: 'MultiPolygon',
    coordinates: areas.map((area) => [area.hull.map(([lon, lat]) => [round(lon!), round(lat!)])]),
  };
}

const WORLD_RING: Position[] = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];

/** Everything except the areas: a world polygon with every area as a (clockwise) hole. */
export function outsideMask(areas: MultiPolygon): Polygon {
  return {
    type: 'Polygon',
    coordinates: [WORLD_RING, ...areas.coordinates.map((polygon) => [...polygon[0]!].reverse())],
  };
}
