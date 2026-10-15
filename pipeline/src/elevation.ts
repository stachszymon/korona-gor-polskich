import { PNG } from 'pngjs';
import { haversineM, resample, type LonLat } from './geo';

/** AWS Terrain Tiles (Mapzen terrarium encoding), 256 px PNG tiles. */
export const TERRARIUM_URL_TEMPLATE =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const TILE_SIZE = 256;

/** Returns the PNG bytes of tile (z, x, y). */
export type FetchTile = (z: number, x: number, y: number) => Promise<Buffer>;

export interface DemSampler {
  elevationAt(p: LonLat): Promise<number>;
}

/** Terrarium encoding: height in metres = r * 256 + g + b / 256 - 32768. */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

function decodeTile(png: Buffer, tileKey: string): Float64Array {
  let image: PNG;
  try {
    image = PNG.sync.read(png);
  } catch (error) {
    throw new Error(`DEM tile ${tileKey}: invalid PNG`, { cause: error });
  }
  if (image.width !== TILE_SIZE || image.height !== TILE_SIZE) {
    throw new Error(
      `DEM tile ${tileKey}: expected ${TILE_SIZE}x${TILE_SIZE} px, got ${image.width}x${image.height}`,
    );
  }
  const heights = new Float64Array(TILE_SIZE * TILE_SIZE);
  for (let i = 0; i < heights.length; i++) {
    const o = i * 4;
    heights[i] = decodeTerrarium(image.data[o]!, image.data[o + 1]!, image.data[o + 2]!);
  }
  return heights;
}

/** Global Web Mercator pixel coordinates of a point at zoom `z` (256 px tiles). */
function worldPixel(p: LonLat, z: number): [number, number] {
  const size = TILE_SIZE * 2 ** z;
  const lat = (Math.max(-85.0511287798, Math.min(85.0511287798, p[1])) * Math.PI) / 180;
  const x = ((p[0] + 180) / 360) * size;
  const y = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * size;
  return [x, y];
}

/**
 * Samples elevations from terrarium tiles at a fixed zoom.
 *
 * Pixel-centre convention: pixel (px, py) of tile (x, y, z) covers global pixel
 * coordinates [x*256+px, x*256+px+1) and its height is the value at the pixel centre
 * (x*256+px+0.5). A point is interpolated bilinearly between the 4 nearest pixel
 * centres in global pixel space at zoom z, so a point between the last pixel centre
 * of one tile and the first pixel centre of its neighbour reads both tiles.
 * Each tile is fetched and decoded once (cached by `z/x/y`); a failed fetch is not cached.
 */
export function createDemSampler(fetchTile: FetchTile, zoom = 14): DemSampler {
  const cache = new Map<string, Promise<Float64Array>>();
  const tilesPerSide = 2 ** zoom;
  const worldSize = TILE_SIZE * tilesPerSide;

  const tile = (x: number, y: number): Promise<Float64Array> => {
    const tileKey = `${zoom}/${x}/${y}`;
    let entry = cache.get(tileKey);
    if (!entry) {
      const pending = fetchTile(zoom, x, y).then((png) => decodeTile(png, tileKey));
      pending.catch(() => {
        if (cache.get(tileKey) === pending) cache.delete(tileKey);
      });
      cache.set(tileKey, pending);
      entry = pending;
    }
    return entry;
  };

  /** Height of the pixel with global pixel indices (gx, gy); wraps in x, clamps in y. */
  const pixel = async (gx: number, gy: number): Promise<number> => {
    const wx = ((gx % worldSize) + worldSize) % worldSize;
    const wy = Math.max(0, Math.min(worldSize - 1, gy));
    const heights = await tile(Math.floor(wx / TILE_SIZE), Math.floor(wy / TILE_SIZE));
    return heights[(wy % TILE_SIZE) * TILE_SIZE + (wx % TILE_SIZE)]!;
  };

  return {
    async elevationAt(p: LonLat): Promise<number> {
      const [wx, wy] = worldPixel(p, zoom);
      // Shift into pixel-centre space: centre of pixel i sits at i + 0.5.
      const u = wx - 0.5;
      const v = wy - 0.5;
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const fx = u - x0;
      const fy = v - y0;
      const [h00, h10, h01, h11] = await Promise.all([
        pixel(x0, y0),
        pixel(x0 + 1, y0),
        pixel(x0, y0 + 1),
        pixel(x0 + 1, y0 + 1),
      ]);
      const top = h00 * (1 - fx) + h10 * fx;
      const bottom = h01 * (1 - fx) + h11 * fx;
      return top * (1 - fy) + bottom * fy;
    },
  };
}

export interface TileFetcherDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Per-request timeout in ms (default 30000). */
  timeoutMs?: number;
}

const RETRY_DELAYS_MS = [1000, 2000, 4000];
const DEFAULT_TIMEOUT_MS = 30_000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetches tiles over HTTP from a `{z}/{x}/{y}` URL template: 1 try plus 3 retries
 * after 1 s, 2 s and 4 s; then throws an error naming the tile URL.
 */
export function httpTileFetcher(
  urlTemplate: string,
  userAgent: string,
  deps: TileFetcherDeps = {},
): FetchTile {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (z, x, y) => {
    const url = urlTemplate
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y));
    const failures: string[] = [];
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]!);
      try {
        const response = await doFetch(url, {
          headers: { 'User-Agent': userAgent },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return Buffer.from(await response.arrayBuffer());
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    throw new Error(
      `DEM tile ${url} failed after ${failures.length} attempts: ${failures.join('; ')}`,
    );
  };
}

/**
 * Resamples the line every `stepM` metres and samples the DEM at each point.
 * Heights and distances along the line are rounded to 1 m.
 */
export async function buildProfile(
  coords: LonLat[],
  sampler: DemSampler,
  stepM = 25,
): Promise<{ coords3d: [number, number, number][]; profile: [number, number][] }> {
  const points = resample(coords, stepM);
  const coords3d: [number, number, number][] = [];
  const profile: [number, number][] = [];
  let distance = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (i > 0) distance += haversineM(points[i - 1]!, p);
    const h = Math.round(await sampler.elevationAt(p));
    coords3d.push([p[0], p[1], h]);
    profile.push([Math.round(distance), h]);
  }
  return { coords3d, profile };
}

/**
 * Total ascent and descent of a [distance, height] profile.
 *
 * Heights are smoothed with a centred moving average of `window` points; near the ends
 * the window shrinks symmetrically so it stays centred (the end points keep their height).
 * Then, from `ref = h[0]`, a rise of at least `thresholdM` above `ref` adds to the ascent
 * and moves `ref`; a drop of at least `thresholdM` below `ref` adds to the descent and moves `ref`.
 */
export function ascentDescent(
  profile: [number, number][],
  opts: { window?: number; thresholdM?: number } = {},
): { ascentM: number; descentM: number } {
  const half = Math.max(0, Math.floor((opts.window ?? 5) / 2));
  const thresholdM = opts.thresholdM ?? 2;
  const raw = profile.map(([, h]) => h);
  const n = raw.length;
  if (n === 0) return { ascentM: 0, descentM: 0 };

  const smooth = raw.map((_, i) => {
    const k = Math.min(half, i, n - 1 - i);
    let sum = 0;
    for (let j = i - k; j <= i + k; j++) sum += raw[j]!;
    return sum / (2 * k + 1);
  });

  let ascent = 0;
  let descent = 0;
  let ref = smooth[0]!;
  for (const h of smooth) {
    if (h - ref >= thresholdM) {
      ascent += h - ref;
      ref = h;
    } else if (ref - h >= thresholdM) {
      descent += ref - h;
      ref = h;
    }
  }
  return { ascentM: Math.round(ascent), descentM: Math.round(descent) };
}
