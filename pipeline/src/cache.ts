import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OverpassResponse } from './overpass';

export type OsmFetcher = (query: string) => Promise<OverpassResponse>;

/**
 * Wraps a fetcher with an on-disk cache in `dir`, one JSON file per query (keyed by the
 * SHA-256 of the query text). Only successful responses are stored. Used to re-run the
 * pipeline after editing route overrides without asking the public servers again.
 */
export function withResponseCache(fetcher: OsmFetcher, dir: string): OsmFetcher {
  return async (query) => {
    const file = join(dir, `${createHash('sha256').update(query).digest('hex').slice(0, 32)}.json`);
    try {
      return JSON.parse(await readFile(file, 'utf8')) as OverpassResponse;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const response = await fetcher(query);
    await mkdir(dir, { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(response));
    await rename(`${file}.tmp`, file);
    return response;
  };
}
