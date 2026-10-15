import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { withResponseCache } from '../src/cache';
import type { OverpassResponse } from '../src/overpass';

const RESPONSE: OverpassResponse = {
  elements: [{ type: 'node', id: 1, lat: 49.5, lon: 19.5, tags: { amenity: 'parking' } }],
};

const tempDir = () => mkdtemp(join(tmpdir(), 'kgp-cache-'));

describe('withResponseCache', () => {
  it('fetches once and serves the same query from disk afterwards', async () => {
    const dir = await tempDir();
    const fetcher = vi.fn().mockResolvedValue(RESPONSE);
    const cached = withResponseCache(fetcher, dir);

    expect(await cached('query A')).toEqual(RESPONSE);
    expect(await cached('query A')).toEqual(RESPONSE);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // A fresh wrapper over the same directory (= next pipeline run) needs no request either.
    const again = withResponseCache(fetcher, dir);
    expect(await again('query A')).toEqual(RESPONSE);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keys entries by query text', async () => {
    const dir = await tempDir();
    const fetcher = vi.fn().mockResolvedValue(RESPONSE);
    const cached = withResponseCache(fetcher, dir);
    await cached('query A');
    await cached('query B');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await readdir(dir)).toHaveLength(2);
  });

  it('does not store failures', async () => {
    const dir = await tempDir();
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('HTTP 504')).mockResolvedValue(RESPONSE);
    const cached = withResponseCache(fetcher, dir);
    await expect(cached('query A')).rejects.toThrow('HTTP 504');
    expect(await cached('query A')).toEqual(RESPONSE);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
