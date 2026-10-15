import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAll, formatReport, type BuildDeps } from './build';
import { withResponseCache, type OsmFetcher } from './cache';
import { httpTileFetcher, TERRARIUM_URL_TEMPLATE } from './elevation';
import { loadOverrides } from './overrides';
import { osmApiFetcher } from './osm-api';
import { fetchOverpass, USER_AGENT } from './overpass';
import { loadPeakSources } from './peaks';

/** Pause after every Overpass request, to be gentle to the public mirrors. */
const OVERPASS_PAUSE_MS = 1000;

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const fromRoot = (path: string): string => fileURLToPath(new URL(`../../${path}`, import.meta.url));

export const DATA_SOURCES = ['overpass', 'osm-api'] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

export interface CliOptions {
  /** `overpass` (default) or the `osm-api` fallback for days when Overpass is down. */
  source: DataSource;
  /** Directory for cached OSM responses (`--cache=<dir>`); no cache when absent. */
  cacheDir?: string;
}

const isDataSource = (value: string): value is DataSource =>
  (DATA_SOURCES as readonly string[]).includes(value);

/** Parses `npm run data:build -- [--source=overpass|osm-api] [--cache=<dir>]`. */
export function parseCliArgs(args: string[]): CliOptions {
  const options: CliOptions = { source: 'overpass' };
  for (const arg of args) {
    if (arg.startsWith('--source=')) {
      const source = arg.slice('--source='.length);
      if (!isDataSource(source)) throw new Error('--source must be "overpass" or "osm-api"');
      options.source = source;
    } else if (arg.startsWith('--cache=')) {
      const dir = arg.slice('--cache='.length);
      if (dir === '') throw new Error('--cache needs a directory, e.g. --cache=.superpowers/osm-cache');
      options.cacheDir = dir;
    } else {
      throw new Error(`unknown argument "${arg}"`);
    }
  }
  return options;
}

async function main(): Promise<number> {
  const options = parseCliArgs(process.argv.slice(2));
  const sources = await loadPeakSources(fromRoot('pipeline/peaks.source.json'));
  const overrides = await loadOverrides(fromRoot('pipeline/route-overrides.json'));
  const log = (line: string): void => console.log(line);
  const politeOverpass: OsmFetcher = async (query) => {
    try {
      return await fetchOverpass(query);
    } finally {
      await pause(OVERPASS_PAUSE_MS);
    }
  };
  const fetcher = options.source === 'osm-api' ? osmApiFetcher({ log }) : politeOverpass;
  log(`data source: ${options.source}`);
  const deps: BuildDeps = {
    // One cache subdirectory per source, so their responses never mix.
    overpass:
      options.cacheDir === undefined ? fetcher : withResponseCache(fetcher, join(options.cacheDir, options.source)),
    fetchTile: httpTileFetcher(TERRARIUM_URL_TEMPLATE, USER_AGENT),
    overrides,
    now: () => new Date(),
    log,
  };

  const { ok, reports } = await buildAll(sources, deps, fromRoot('public/data'));
  console.log(`\n${formatReport(reports)}`);
  if (!ok) {
    console.error('Build failed, public/data was not changed.');
    return 1;
  }
  console.log('public/data replaced. Review the routes above before committing.');
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
