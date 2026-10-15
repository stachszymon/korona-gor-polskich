import { PNG } from 'pngjs';
import { describe, expect, it, vi } from 'vitest';
import {
  TERRARIUM_URL_TEMPLATE,
  ascentDescent,
  buildProfile,
  createDemSampler,
  decodeTerrarium,
  httpTileFetcher,
  type FetchTile,
} from '../src/elevation';
import { lineLengthM, type LonLat } from '../src/geo';

const Z = 14;
const TILE_X = 9080;
const TILE_Y = 5600;

/** Inverse of decodeTerrarium for heights that are multiples of 1/256 m. */
function encodeTerrarium(h: number): [number, number, number] {
  const v = Math.round((h + 32768) * 256);
  return [Math.floor(v / 65536), Math.floor(v / 256) % 256, v % 256];
}

function tilePng(height: (px: number, py: number) => number): Buffer {
  const png = new PNG({ width: 256, height: 256 });
  for (let py = 0; py < 256; py++) {
    for (let px = 0; px < 256; px++) {
      const i = (py * 256 + px) * 4;
      const [r, g, b] = encodeTerrarium(height(px, py));
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

/** [lon, lat] of a global Web Mercator pixel coordinate at zoom `z` (256 px tiles). */
function worldPixelToLonLat(wx: number, wy: number, z = Z): LonLat {
  const size = 256 * 2 ** z;
  const lon = (wx / size) * 360 - 180;
  const n = Math.PI * (1 - (2 * wy) / size);
  const lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI;
  return [lon, lat];
}

/** Point at pixel offset (ox, oy) within tile (TILE_X, TILE_Y); offsets may leave the tile. */
const inTile = (ox: number, oy: number): LonLat =>
  worldPixelToLonLat(TILE_X * 256 + ox, TILE_Y * 256 + oy);

const tiles = (map: Record<string, Buffer>): FetchTile =>
  vi.fn((z: number, x: number, y: number) => {
    const tile = map[`${z}/${x}/${y}`];
    if (!tile) return Promise.reject(new Error(`unexpected tile ${z}/${x}/${y}`));
    return Promise.resolve(tile);
  });

const key = (dx = 0, dy = 0): string => `${Z}/${TILE_X + dx}/${TILE_Y + dy}`;

describe('decodeTerrarium', () => {
  it('decodes sea level and a known height', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(134, 189, 0)).toBe(1725);
  });

  it('round-trips the test encoder', () => {
    expect(decodeTerrarium(...encodeTerrarium(1234.5))).toBe(1234.5);
    expect(decodeTerrarium(...encodeTerrarium(-12.25))).toBe(-12.25);
  });
});

describe('createDemSampler', () => {
  it('reads the pixel value at a pixel centre', async () => {
    const sampler = createDemSampler(tiles({ [key()]: tilePng((px, py) => px * 10 + py) }), Z);
    // Pixel (40, 70) covers [40, 41) x [70, 71); its sample sits at the centre (40.5, 70.5).
    expect(await sampler.elevationAt(inTile(40.5, 70.5))).toBeCloseTo(470, 4);
  });

  it('bilinear interpolation between four pixels', async () => {
    const special: Record<string, number> = { '10,20': 100, '11,20': 200, '10,21': 300, '11,21': 400 };
    const sampler = createDemSampler(
      tiles({ [key()]: tilePng((px, py) => special[`${px},${py}`] ?? 0) }),
      Z,
    );
    // Centres at 10.5/11.5 and 20.5/21.5 → fx = 0.25, fy = 0.5.
    const expected = 0.75 * 0.5 * 100 + 0.25 * 0.5 * 200 + 0.75 * 0.5 * 300 + 0.25 * 0.5 * 400;
    expect(await sampler.elevationAt(inTile(10.75, 21))).toBeCloseTo(expected, 4);
  });

  it('interpolates a gradient tile exactly', async () => {
    const sampler = createDemSampler(
      tiles({ [key()]: tilePng((px, py) => 1000 + 2 * px + 7 * py) }),
      Z,
    );
    // Sample coordinate in pixel-centre space is (offset - 0.5).
    expect(await sampler.elevationAt(inTile(100.3, 33.9))).toBeCloseTo(
      1000 + 2 * 99.8 + 7 * 33.4,
      4,
    );
  });

  it('sampling the last pixel column reads the neighbouring tile', async () => {
    const sampler = createDemSampler(
      tiles({ [key()]: tilePng(() => 1000), [key(1, 0)]: tilePng(() => 2000) }),
      Z,
    );
    // Halfway between the centre of pixel 255 (255.5) and of the neighbour's pixel 0 (256.5).
    expect(await sampler.elevationAt(inTile(256, 128.5))).toBeCloseTo(1500, 4);
    // A quarter of the way: still inside the last pixel of the first tile.
    expect(await sampler.elevationAt(inTile(255.75, 128.5))).toBeCloseTo(1250, 4);
  });

  it('sampling the last pixel row reads the tile below', async () => {
    const sampler = createDemSampler(
      tiles({ [key()]: tilePng(() => 1000), [key(0, 1)]: tilePng(() => 2000) }),
      Z,
    );
    expect(await sampler.elevationAt(inTile(64.5, 256))).toBeCloseTo(1500, 4);
  });

  it('sampling a tile corner reads all four tiles', async () => {
    const sampler = createDemSampler(
      tiles({
        [key()]: tilePng(() => 1000),
        [key(1, 0)]: tilePng(() => 2000),
        [key(0, 1)]: tilePng(() => 3000),
        [key(1, 1)]: tilePng(() => 4000),
      }),
      Z,
    );
    expect(await sampler.elevationAt(inTile(256, 256))).toBeCloseTo(2500, 4);
  });

  it('sampling the first pixel column reads the tile to the left', async () => {
    const sampler = createDemSampler(
      tiles({ [key()]: tilePng(() => 1000), [key(-1, 0)]: tilePng(() => 2000) }),
      Z,
    );
    expect(await sampler.elevationAt(inTile(0, 10.5))).toBeCloseTo(1500, 4);
  });

  it('fetches each tile once', async () => {
    const fetchTile = tiles({ [key()]: tilePng((px) => px) });
    const sampler = createDemSampler(fetchTile, Z);
    await Promise.all([
      sampler.elevationAt(inTile(10.5, 10.5)),
      sampler.elevationAt(inTile(100.5, 50.5)),
    ]);
    await sampler.elevationAt(inTile(200.5, 200.5));
    expect(fetchTile).toHaveBeenCalledTimes(1);
    expect(fetchTile).toHaveBeenCalledWith(Z, TILE_X, TILE_Y);
  });

  it('retries a tile whose fetch failed earlier', async () => {
    const png = tilePng(() => 500);
    const fetchTile = vi
      .fn<FetchTile>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(png);
    const sampler = createDemSampler(fetchTile, Z);
    await expect(sampler.elevationAt(inTile(10.5, 10.5))).rejects.toThrow('boom');
    expect(await sampler.elevationAt(inTile(10.5, 10.5))).toBeCloseTo(500, 4);
    expect(fetchTile).toHaveBeenCalledTimes(2);
  });

  it('defaults to zoom 14', async () => {
    const sampler = createDemSampler(tiles({ [key()]: tilePng(() => 42) }));
    expect(await sampler.elevationAt(inTile(5.5, 5.5))).toBeCloseTo(42, 4);
  });
});

describe('buildProfile', () => {
  it('samples the line every stepM with rounded heights and distances', async () => {
    const sampler = createDemSampler(
      tiles({ [key()]: tilePng((px) => 1000 + px * 0.5) }),
      Z,
    );
    const coords: LonLat[] = [inTile(20.5, 128.5), inTile(220.5, 128.5)];
    const { coords3d, profile } = await buildProfile(coords, sampler, 25);

    expect(coords3d.length).toBe(profile.length);
    expect(coords3d.length).toBeGreaterThan(2);
    expect(coords3d[0]).toEqual([coords[0]![0], coords[0]![1], 1010]);
    expect(coords3d.at(-1)).toEqual([coords[1]![0], coords[1]![1], 1110]);
    expect(profile[0]).toEqual([0, 1010]);
    expect(profile.at(-1)).toEqual([Math.round(lineLengthM(coords)), 1110]);
    for (const [d, h] of profile) {
      expect(Number.isInteger(d)).toBe(true);
      expect(Number.isInteger(h)).toBe(true);
    }
    for (let i = 1; i < profile.length - 1; i++) {
      expect(profile[i]![0] - profile[i - 1]![0]).toBeGreaterThanOrEqual(24);
      expect(profile[i]![0] - profile[i - 1]![0]).toBeLessThanOrEqual(26);
    }
  });
});

describe('ascentDescent', () => {
  const profileOf = (heights: number[]): [number, number][] =>
    heights.map((h, i) => [i * 25, h]);

  it('ascentDescent ignores ±1 m noise', () => {
    const saw = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 1000 : 1001));
    expect(ascentDescent(profileOf(saw))).toEqual({ ascentM: 0, descentM: 0 });
  });

  it('ascentDescent on monotonic climb 800→1725 gives ascent 925', () => {
    const climb = Array.from({ length: 38 }, (_, i) => 800 + i * 25);
    expect(climb.at(-1)).toBe(1725);
    expect(ascentDescent(profileOf(climb))).toEqual({ ascentM: 925, descentM: 0 });
  });

  it('counts a climb and the descent back', () => {
    const up = Array.from({ length: 21 }, (_, i) => 500 + i * 10);
    const summit = [700, 700, 700, 700]; // a plateau wider than the window keeps the peak height
    const down = Array.from({ length: 20 }, (_, i) => 690 - i * 10);
    expect(ascentDescent(profileOf([...up, ...summit, ...down]))).toEqual({
      ascentM: 200,
      descentM: 200,
    });
  });

  it('smooths a single spike with the moving average', () => {
    const heights = [1000, 1000, 1000, 1000, 1010, 1000, 1000, 1000, 1000];
    // Window 5 spreads the 10 m spike to +2 m over five points.
    expect(ascentDescent(profileOf(heights))).toEqual({ ascentM: 2, descentM: 2 });
    // Without smoothing the spike counts in full.
    expect(ascentDescent(profileOf(heights), { window: 1 })).toEqual({
      ascentM: 10,
      descentM: 10,
    });
  });

  it('respects a custom threshold', () => {
    const steps = [1000, 1003, 1006, 1009];
    expect(ascentDescent(profileOf(steps), { window: 1, thresholdM: 5 })).toEqual({
      ascentM: 6,
      descentM: 0,
    });
  });

  it('returns zeros for empty and single-point profiles', () => {
    expect(ascentDescent([])).toEqual({ ascentM: 0, descentM: 0 });
    expect(ascentDescent([[0, 1000]])).toEqual({ ascentM: 0, descentM: 0 });
  });
});

describe('httpTileFetcher', () => {
  const URL_TEMPLATE = 'https://example.test/terrarium/{z}/{x}/{y}.png';
  const UA = 'test-agent/1.0';

  it('uses the terrarium tiles of the elevation-tiles-prod bucket', () => {
    expect(TERRARIUM_URL_TEMPLATE).toBe(
      'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    );
  });

  it('GETs the tile URL with the User-Agent and returns the body', async () => {
    const body = new Uint8Array([1, 2, 3]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchTile = httpTileFetcher(URL_TEMPLATE, UA, {
      fetch: fetchMock as unknown as typeof fetch,
      sleep,
    });

    const result = await fetchTile(14, 9080, 5600);

    expect(Buffer.isBuffer(result)).toBe(true);
    expect([...result]).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.test/terrarium/14/9080/5600.png');
    expect(new Headers(init.headers).get('user-agent')).toBe(UA);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('httpTileFetcher retries on 503 and throws after 4 failed attempts', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('busy', { status: 503 })));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchTile = httpTileFetcher(URL_TEMPLATE, UA, {
      fetch: fetchMock as unknown as typeof fetch,
      sleep,
    });

    await expect(fetchTile(14, 1, 2)).rejects.toThrow('https://example.test/terrarium/14/1/2.png');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000]);
  });

  it('recovers when a retry succeeds, including after a network error', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([9]), { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchTile = httpTileFetcher(URL_TEMPLATE, UA, {
      fetch: fetchMock as unknown as typeof fetch,
      sleep,
    });

    expect([...(await fetchTile(14, 1, 2))]).toEqual([9]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });
});
