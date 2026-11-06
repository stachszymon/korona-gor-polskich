import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import buffer from '@turf/buffer';
import { featureCollection, lineString, point } from '@turf/helpers';
import simplify from '@turf/simplify';
import union from '@turf/union';
import type { Feature, LineString, MultiPolygon, Point, Polygon, Position } from 'geojson';
import { MountainAreaSchema, type MountainArea } from '../../src/data/schema';
import { haversineM, simplifyLine, type LonLat } from './geo';

/** Radius of the circle around every peak. */
export const PEAK_RADIUS_KM = 12;
/** Width of the buffer around every route. */
export const ROUTE_BUFFER_KM = 4;
/** Width of the capsule bridging two groups of peaks. */
export const BRIDGE_KM = 15;
/** Douglas-Peucker tolerance of the result. */
export const SIMPLIFY_TOLERANCE_M = 200;
/** Decimal places of the written coordinates. */
export const COORDINATE_DECIMALS = 4;
/** Margin added around the area to get `bounds`, in degrees. */
export const BOUNDS_MARGIN_DEG = 0.3;
/** Peaks that are never joined to any other group, neither by overlap nor by a bridge. */
export const ISOLATED_PEAKS: readonly string[] = ['lysica'];

/** Routes are thinned before buffering; far finer than the 4 km buffer needs. */
const ROUTE_THINNING_M = 100;
const METERS_PER_DEGREE = 111_320;

export interface AreaOptions {
  peakRadiusKm?: number;
  routeBufferKm?: number;
  bridgeKm?: number;
  simplifyToleranceM?: number;
  decimals?: number;
  boundsMarginDeg?: number;
  isolatedPeaks?: readonly string[];
}

export interface AreaPeak {
  id: string;
  lat: number;
  lon: number;
}

type Shape = Feature<Polygon | MultiPolygon>;

function mustUnion(shapes: Shape[]): Shape {
  const merged = shapes.length === 1 ? shapes[0] : union(featureCollection(shapes));
  if (merged === null || merged === undefined) throw new Error('union of mountain area shapes is empty');
  return merged;
}

function mustBuffer(feature: Feature<Point | LineString>, km: number): Shape {
  const buffered = buffer(feature, km, { units: 'kilometers' });
  if (buffered === undefined) throw new Error('buffer of a mountain area shape is empty');
  return buffered;
}

type BBox = [number, number, number, number];

function bboxOf(shape: Shape): BBox {
  const box: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  const polygons = shape.geometry.type === 'Polygon' ? [shape.geometry.coordinates] : shape.geometry.coordinates;
  for (const polygon of polygons) {
    for (const [lon, lat] of polygon[0]!) {
      box[0] = Math.min(box[0], lon!);
      box[1] = Math.min(box[1], lat!);
      box[2] = Math.max(box[2], lon!);
      box[3] = Math.max(box[3], lat!);
    }
  }
  return box;
}

const boxesOverlap = (a: BBox, b: BBox): boolean =>
  a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/** Whether two shapes touch or overlap: their union is then a single polygon. */
function shapesIntersect(a: Shape, b: Shape): boolean {
  if (!boxesOverlap(bboxOf(a), bboxOf(b))) return false;
  return mustUnion([a, b]).geometry.type === 'Polygon';
}

function makeFind(parent: number[]): (i: number) => number {
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  return find;
}

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Positive for counter-clockwise rings. */
function signedArea(ring: Position[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!;
  }
  return sum / 2;
}

/** Rounds, drops repeated points, closes the ring; `null` when fewer than 3 distinct points remain. */
function cleanRing(ring: Position[], decimals: number): Position[] | null {
  const points: Position[] = [];
  for (const [lon, lat] of ring) {
    const p: Position = [roundTo(lon!, decimals), roundTo(lat!, decimals)];
    const last = points.at(-1);
    if (last === undefined || last[0] !== p[0] || last[1] !== p[1]) points.push(p);
  }
  const first = points[0];
  const end = points.at(-1);
  if (first !== undefined && end !== undefined && first[0] === end[0] && first[1] === end[1]) points.pop();
  if (points.length < 3) return null;
  return [...points, points[0]!];
}

/** Outer rings counter-clockwise, holes clockwise (RFC 7946). */
function orient(ring: Position[], counterClockwise: boolean): Position[] {
  return signedArea(ring) > 0 === counterClockwise ? ring : [...ring].reverse();
}

/**
 * The "mountains": a circle around every peak and a buffer around every route, joined into groups
 * where they overlap; groups are bridged by the minimum spanning tree of their closest peaks.
 * Isolated peaks stay apart. Pure: depends only on the arguments.
 */
export function buildMountainArea(
  peaks: AreaPeak[],
  routes: LonLat[][],
  options: AreaOptions = {},
): MountainArea {
  if (peaks.length === 0) throw new Error('cannot build the mountain area without peaks');
  const peakRadiusKm = options.peakRadiusKm ?? PEAK_RADIUS_KM;
  const routeBufferKm = options.routeBufferKm ?? ROUTE_BUFFER_KM;
  const bridgeKm = options.bridgeKm ?? BRIDGE_KM;
  const toleranceM = options.simplifyToleranceM ?? SIMPLIFY_TOLERANCE_M;
  const decimals = options.decimals ?? COORDINATE_DECIMALS;
  const margin = options.boundsMarginDeg ?? BOUNDS_MARGIN_DEG;
  const isolated = new Set(options.isolatedPeaks ?? ISOLATED_PEAKS);

  // Every route belongs to the peak closest to any of its points (it ends at its summit).
  const routesOf: LonLat[][][] = peaks.map(() => []);
  for (const route of routes) {
    if (route.length < 2) continue;
    let best = 0;
    let bestDistance = Infinity;
    peaks.forEach((peak, i) => {
      for (const p of route) {
        const d = haversineM(p, [peak.lon, peak.lat]);
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      }
    });
    routesOf[best]!.push(simplifyLine(route, ROUTE_THINNING_M));
  }

  const shapes: Shape[] = peaks.map((peak, i) =>
    mustUnion([
      mustBuffer(point([peak.lon, peak.lat]), peakRadiusKm),
      ...routesOf[i]!.map((route) => mustBuffer(lineString(route), routeBufferKm)),
    ]),
  );

  // Groups of non-isolated peaks whose shapes intersect.
  const parent = peaks.map((_, i) => i);
  const find = makeFind(parent);
  const free = peaks.map((_, i) => i).filter((i) => !isolated.has(peaks[i]!.id));
  for (const [a, i] of free.entries()) {
    for (const j of free.slice(a + 1)) {
      if (find(i) !== find(j) && shapesIntersect(shapes[i]!, shapes[j]!)) parent[find(j)] = find(i);
    }
  }

  // Kruskal on the closest pair of peaks between every two groups.
  type Edge = { a: number; b: number; distanceM: number };
  const best = new Map<string, Edge>();
  for (const [a, i] of free.entries()) {
    for (const j of free.slice(a + 1)) {
      const gi = find(i);
      const gj = find(j);
      if (gi === gj) continue;
      const key = `${Math.min(gi, gj)}:${Math.max(gi, gj)}`;
      const distanceM = haversineM([peaks[i]!.lon, peaks[i]!.lat], [peaks[j]!.lon, peaks[j]!.lat]);
      if (distanceM < (best.get(key)?.distanceM ?? Infinity)) best.set(key, { a: i, b: j, distanceM });
    }
  }
  const mstParent = peaks.map((_, i) => find(i));
  const mstFind = makeFind(mstParent);
  const capsules: Shape[] = [];
  for (const edge of [...best.values()].sort((x, y) => x.distanceM - y.distanceM)) {
    const rootA = mstFind(edge.a);
    const rootB = mstFind(edge.b);
    if (rootA === rootB) continue;
    mstParent[rootB] = rootA;
    const from = peaks[edge.a]!;
    const to = peaks[edge.b]!;
    capsules.push(
      mustBuffer(
        lineString([
          [from.lon, from.lat],
          [to.lon, to.lat],
        ]),
        bridgeKm,
      ),
    );
  }

  const merged = mustUnion([...shapes, ...capsules]);
  const simplified = simplify(merged, {
    tolerance: toleranceM / METERS_PER_DEGREE,
    highQuality: true,
    mutate: false,
  }) as Shape;
  const polygons = simplified.geometry.type === 'Polygon' ? [simplified.geometry.coordinates] : simplified.geometry.coordinates;

  const cleaned: Position[][][] = [];
  for (const polygon of polygons) {
    const [outerRaw, ...holesRaw] = polygon;
    const outer = outerRaw === undefined ? null : cleanRing(outerRaw, decimals);
    if (outer === null) continue;
    const holes = holesRaw
      .map((ring) => cleanRing(ring, decimals))
      .filter((ring): ring is Position[] => ring !== null)
      .map((ring) => orient(ring, false));
    cleaned.push([orient(outer, true), ...holes]);
  }
  if (cleaned.length === 0) throw new Error('mountain area is empty after simplification');
  cleaned.sort((x, y) => signedArea(y[0]!) - signedArea(x[0]!));

  const vertices = cleaned.flatMap((polygon) => polygon[0]!);
  const lons = vertices.map((v) => v[0]!);
  const lats = vertices.map((v) => v[1]!);
  const bounds: MountainArea['bounds'] = [
    roundTo(Math.min(...lons) - margin, decimals),
    roundTo(Math.min(...lats) - margin, decimals),
    roundTo(Math.max(...lons) + margin, decimals),
    roundTo(Math.max(...lats) + margin, decimals),
  ];

  return MountainAreaSchema.parse({
    areas: { type: 'MultiPolygon', coordinates: cleaned },
    bounds,
  });
}

/** `mountain-area.json` content: compact, one trailing newline. */
export const serializeMountainArea = (area: MountainArea): string => `${JSON.stringify(area)}\n`;

type LooseDetail = { routes?: { geometry?: { coordinates?: number[][] } }[] };

/**
 * Reads `peaks.json` and `peaks/<id>.json` from `outDir` (only positions and route geometries,
 * loosely: no schema), builds the area and writes `mountain-area.json` next to them.
 */
export async function writeMountainArea(outDir: string): Promise<MountainArea> {
  const index = JSON.parse(await readFile(join(outDir, 'peaks.json'), 'utf8')) as { peaks: AreaPeak[] };
  const peaks = index.peaks.map(({ id, lat, lon }) => ({ id, lat, lon }));
  const available = new Set(await readdir(join(outDir, 'peaks')));
  const routes: LonLat[][] = [];
  for (const { id } of peaks) {
    if (!available.has(`${id}.json`)) throw new Error(`peaks/${id}.json is missing in ${outDir}`);
    const detail = JSON.parse(await readFile(join(outDir, 'peaks', `${id}.json`), 'utf8')) as LooseDetail;
    for (const route of detail.routes ?? []) {
      routes.push((route.geometry?.coordinates ?? []).map((c) => [c[0]!, c[1]!] as LonLat));
    }
  }
  const area = buildMountainArea(peaks, routes);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'mountain-area.json'), serializeMountainArea(area));
  return area;
}
