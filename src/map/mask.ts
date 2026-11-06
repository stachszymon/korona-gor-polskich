import type { MultiPolygon, Polygon, Position } from 'geojson';

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
