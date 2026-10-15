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
