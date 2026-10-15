const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number) => (deg * Math.PI) / 180;

function haversineM(a: readonly number[], b: readonly number[]): number {
  const [lon1 = 0, lat1 = 0] = a;
  const [lon2 = 0, lat2 = 0] = b;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Position `[lon, lat]` on a route `distM` metres along the elevation profile.
 *
 * The route geometry is simplified, so its vertices are not evenly spaced and its length differs
 * slightly from the profile's. Cumulative geometry lengths are therefore scaled to `totalM` (the
 * profile's last distance) and the position is interpolated between the two neighbouring vertices.
 * Distances outside `[0, totalM]` clamp to the first and last vertex.
 */
export function pointAtDistance(
  coords: readonly (readonly number[])[],
  distM: number,
  totalM: number,
): [number, number] {
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (!first || !last) throw new Error('Route geometry has no vertices');
  const start: [number, number] = [first[0] ?? 0, first[1] ?? 0];
  const end: [number, number] = [last[0] ?? 0, last[1] ?? 0];

  const cumulative = [0];
  for (let i = 1; i < coords.length; i++) {
    cumulative.push((cumulative[i - 1] ?? 0) + haversineM(coords[i - 1] ?? [], coords[i] ?? []));
  }
  const length = cumulative[cumulative.length - 1] ?? 0;
  if (length === 0 || totalM <= 0 || distM <= 0) return start;
  if (distM >= totalM) return end;

  const target = (distM / totalM) * length;
  let i = 1;
  while (i < cumulative.length - 1 && (cumulative[i] ?? 0) < target) i++;
  const from = coords[i - 1] ?? first;
  const to = coords[i] ?? last;
  const before = cumulative[i - 1] ?? 0;
  const span = (cumulative[i] ?? 0) - before;
  const t = span === 0 ? 0 : (target - before) / span;
  const lon = (from[0] ?? 0) + ((to[0] ?? 0) - (from[0] ?? 0)) * t;
  const lat = (from[1] ?? 0) + ((to[1] ?? 0) - (from[1] ?? 0)) * t;
  return [lon, lat];
}
