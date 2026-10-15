import { PNG } from 'pngjs';
import type { FetchTile } from '../../src/elevation';
import { haversineM, type LonLat } from '../../src/geo';

const TILE = 256;

function pixelToLonLat(gx: number, gy: number, z: number): LonLat {
  const size = TILE * 2 ** z;
  const lon = (gx / size) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / size))) * 180) / Math.PI;
  return [lon, lat];
}

/** Terrarium encoding: height in metres = `r * 256 + g + b / 256 - 32768`. */
function encode(h: number, data: Buffer, offset: number): void {
  const v = h + 32768;
  const whole = Math.floor(v);
  data[offset] = Math.floor(whole / 256);
  data[offset + 1] = whole % 256;
  data[offset + 2] = Math.floor((v - whole) * 256);
  data[offset + 3] = 255;
}

export type CountingFetchTile = FetchTile & { calls: number };

/**
 * Fake terrarium tiles: a cone whose height falls by `slope` metres per metre of
 * distance from `summit`, so every route climbs towards the summit.
 */
export function fakeTileFetcher(summit: LonLat, summitHeightM = 1725, slope = 0.25): CountingFetchTile {
  const fetchTile = ((z: number, x: number, y: number): Promise<Buffer> => {
    fetchTile.calls++;
    const png = new PNG({ width: TILE, height: TILE });
    for (let py = 0; py < TILE; py++) {
      for (let px = 0; px < TILE; px++) {
        const p = pixelToLonLat(x * TILE + px + 0.5, y * TILE + py + 0.5, z);
        const h = Math.max(0, summitHeightM - slope * haversineM(summit, p));
        encode(h, png.data, (py * TILE + px) * 4);
      }
    }
    return Promise.resolve(PNG.sync.write(png));
  }) as CountingFetchTile;
  fetchTile.calls = 0;
  return fetchTile;
}
