import simplify from '@turf/simplify';

export type LonLat = [number, number];

const EARTH_RADIUS_M = 6_371_008.8;
const METERS_PER_DEGREE = 111_320;
const EPSILON_M = 1e-6;
const NEAR_END_M = 1e-3; // a sampled point this close to the end is the end itself

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two [lon, lat] points. */
export function haversineM(a: LonLat, b: LonLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of a polyline in metres. */
export function lineLengthM(coords: LonLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineM(coords[i - 1]!, coords[i]!);
  }
  return total;
}

/**
 * Points every `stepM` metres along the line. Always includes the first and the
 * last point; the last point is not duplicated when the length is an exact multiple of the step.
 */
export function resample(coords: LonLat[], stepM: number): LonLat[] {
  const first = coords[0];
  if (first === undefined) return [];
  const out: LonLat[] = [first];
  if (coords.length < 2 || stepM <= 0) return coords.length < 2 ? out : [...coords];

  let nextAt = stepM; // distance along the line of the next point to emit
  let walked = 0; // distance along the line at the start of the current segment

  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const segLen = haversineM(a, b);
    if (segLen === 0) continue;
    while (nextAt <= walked + segLen + EPSILON_M) {
      const t = Math.min(1, (nextAt - walked) / segLen);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      nextAt += stepM;
    }
    walked += segLen;
  }

  const last = coords[coords.length - 1]!;
  const tail = out[out.length - 1]!;
  if (tail[0] !== last[0] || tail[1] !== last[1]) {
    // Replace a sampled point that landed within float noise of the end, otherwise append.
    if (haversineM(tail, last) < NEAR_END_M && out.length > 1) {
      out[out.length - 1] = last;
    } else {
      out.push(last);
    }
  }
  return out;
}

/** Douglas-Peucker simplification with a tolerance given in metres. */
export function simplifyLine(coords: LonLat[], toleranceM: number): LonLat[] {
  if (coords.length < 3) return [...coords];
  const simplified = simplify(
    { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
    { tolerance: toleranceM / METERS_PER_DEGREE, highQuality: true },
  );
  return simplified.geometry.coordinates as LonLat[];
}

export function roundCoord(n: number, digits = 5): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/**
 * Parts of a polyline inside the circle of `radiusM` around `center`. A line leaving the
 * circle is cut exactly at it (interpolated point); a line that re-enters starts a new part.
 * Uses a local equirectangular projection, accurate to centimetres at a 10 km scale.
 */
export function clipLineToRadius(coords: LonLat[], center: LonLat, radiusM: number): LonLat[][] {
  const kx = toRad(1) * EARTH_RADIUS_M * Math.cos(toRad(center[1]));
  const ky = toRad(1) * EARTH_RADIUS_M;
  const xy = (p: LonLat): [number, number] => [(p[0] - center[0]) * kx, (p[1] - center[1]) * ky];
  const r2 = radiusM * radiusM;
  const lerp = (a: LonLat, b: LonLat, t: number): LonLat => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  const parts: LonLat[][] = [];
  let current: LonLat[] = [];
  const close = (): void => {
    if (current.length >= 2) parts.push(current);
    current = [];
  };

  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const [ax, ay] = xy(a);
    const [bx, by] = xy(b);
    const aIn = ax * ax + ay * ay <= r2;
    const bIn = bx * bx + by * by <= r2;
    let s = 0;
    let e = 1;
    if (!aIn || !bIn) {
      // |a + t (b - a)|² = r²
      const dx = bx - ax;
      const dy = by - ay;
      const qa = dx * dx + dy * dy;
      const qb = 2 * (ax * dx + ay * dy);
      const qc = ax * ax + ay * ay - r2;
      const disc = qb * qb - 4 * qa * qc;
      if (qa === 0 || disc <= 0) {
        close();
        continue;
      }
      const t1 = (-qb - Math.sqrt(disc)) / (2 * qa);
      const t2 = (-qb + Math.sqrt(disc)) / (2 * qa);
      s = aIn ? 0 : t1;
      e = bIn ? 1 : t2;
      if (s >= e || e <= 0 || s >= 1) {
        close();
        continue;
      }
    }
    if (s > 0) close();
    if (current.length === 0) current.push(s === 0 ? a : lerp(a, b, s));
    current.push(e === 1 ? b : lerp(a, b, e));
    if (e < 1) close();
  }
  close();
  return parts;
}
