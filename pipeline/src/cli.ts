import { fileURLToPath } from 'node:url';
import { buildAll, formatReport, type BuildDeps } from './build';
import { httpTileFetcher, TERRARIUM_URL_TEMPLATE } from './elevation';
import { loadOverrides } from './overrides';
import { fetchOverpass, USER_AGENT } from './overpass';
import { loadPeakSources } from './peaks';

/** Pause after every Overpass request, to be gentle to the public mirrors. */
const OVERPASS_PAUSE_MS = 1000;

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const fromRoot = (path: string): string => fileURLToPath(new URL(`../../${path}`, import.meta.url));

async function main(): Promise<number> {
  const sources = await loadPeakSources(fromRoot('pipeline/peaks.source.json'));
  const overrides = await loadOverrides(fromRoot('pipeline/route-overrides.json'));
  const deps: BuildDeps = {
    overpass: async (query) => {
      try {
        return await fetchOverpass(query);
      } finally {
        await pause(OVERPASS_PAUSE_MS);
      }
    },
    fetchTile: httpTileFetcher(TERRARIUM_URL_TEMPLATE, USER_AGENT),
    overrides,
    now: () => new Date(),
    log: (line) => console.log(line),
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
