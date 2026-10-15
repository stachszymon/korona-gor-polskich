export const OVERPASS_ENDPOINTS: string[] = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export const USER_AGENT =
  'korona-gor-polskich/0.1 (+https://github.com/stachszymon/korona-gor-polskich)';

/** Bounding box of Poland as south,west,north,east (Overpass order). */
const POLAND_BBOX = '49.0,14.0,51.1,24.2';

export interface OverpassNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

export interface OverpassWayMember {
  type: 'way';
  ref: number;
  role: string;
  geometry?: { lat: number; lon: number }[];
}

export interface OverpassRelation {
  type: 'relation';
  id: number;
  tags: Record<string, string>;
  members: (OverpassWayMember | { type: 'node' | 'relation'; ref: number; role: string })[];
}

export interface OverpassResponse {
  elements: (OverpassNode | OverpassRelation)[];
}

export class OverpassError extends Error {
  readonly attempts: string[];

  constructor(message: string, attempts: string[]) {
    super(message);
    this.name = 'OverpassError';
    this.attempts = attempts;
  }
}

export interface OverpassDeps {
  fetch?: typeof fetch;
  endpoints?: string[];
  /** Retries per endpoint after the first try (default 3). */
  retries?: number;
  /** Per-request timeout in ms (default 120000). */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface RawElement {
  type: string;
  id?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassPayload {
  elements?: unknown;
  remark?: unknown;
}

/** Ways requested with `out center;` (parkings) become plain nodes at their center. */
function normalize(data: OverpassPayload): OverpassResponse {
  if (!Array.isArray(data.elements)) {
    throw new Error('response has no "elements" array');
  }
  const elements = (data.elements as RawElement[]).map((el) => {
    if (el.type === 'way' && el.center) {
      const node: OverpassNode = {
        type: 'node',
        id: el.id as number,
        lat: el.center.lat,
        lon: el.center.lon,
      };
      if (el.tags) node.tags = el.tags;
      return node;
    }
    return el;
  });
  return { elements } as OverpassResponse;
}

const DEFAULT_TIMEOUT_MS = 120_000;

async function tryOnce(
  doFetch: typeof fetch,
  endpoint: string,
  query: string,
  timeoutMs: number,
): Promise<OverpassResponse> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await request(doFetch, endpoint, query, controller.signal);
  } catch (error) {
    if (timedOut) throw new Error(`timed out after ${timeoutMs} ms`, { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function request(
  doFetch: typeof fetch,
  endpoint: string,
  query: string,
  signal: AbortSignal,
): Promise<OverpassResponse> {
  const response = await doFetch(endpoint, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `data=${encodeURIComponent(query)}`,
    signal,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const text = await response.text();
  // Overpass reports runtime errors as HTML, even with status 200.
  if (text.trimStart().startsWith('<')) {
    throw new Error('HTML body instead of JSON');
  }
  let parsed: OverpassPayload;
  try {
    parsed = JSON.parse(text) as OverpassPayload;
  } catch (error) {
    throw new Error(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  // A runtime error (e.g. timeout) can come with status 200 and partial elements.
  if (typeof parsed.remark === 'string' && parsed.remark.startsWith('runtime error')) {
    throw new Error(parsed.remark);
  }
  return normalize(parsed);
}

/**
 * POSTs a query to the Overpass mirrors in order. Each mirror gets 1 try plus
 * `retries` retries with exponential backoff (1s, 2s, 4s); only then the next mirror.
 */
export async function fetchOverpass(
  query: string,
  deps: OverpassDeps = {},
): Promise<OverpassResponse> {
  const doFetch = deps.fetch ?? fetch;
  const endpoints = deps.endpoints ?? OVERPASS_ENDPOINTS;
  const retries = deps.retries ?? 3;
  const sleep = deps.sleep ?? defaultSleep;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempts: string[] = [];

  for (const endpoint of endpoints) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
      try {
        return await tryOnce(doFetch, endpoint, query, timeoutMs);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        attempts.push(`${endpoint} attempt ${attempt + 1}: ${reason}`);
      }
    }
  }
  throw new OverpassError(
    `Overpass request failed after ${attempts.length} attempts:\n${attempts.join('\n')}`,
    attempts,
  );
}

export function hikingRelationsQuery(lat: number, lon: number, radiusM: number): string {
  return `[out:json][timeout:90];rel(around:${radiusM},${lat},${lon})[route=hiking];out geom;`;
}

export function trailheadCandidatesQuery(lat: number, lon: number, radiusM: number): string {
  const around = `(around:${radiusM},${lat},${lon})`;
  return (
    '[out:json][timeout:60];(' +
    `node[amenity=parking]${around};` +
    `way[amenity=parking]${around};` +
    `node[railway~"^(station|halt)$"]${around};` +
    `node[highway=bus_stop]${around};` +
    `node[place~"^(village|town|hamlet)$"]${around};` +
    ');out center;'
  );
}

export function peakNodesQuery(nodeIds: number[]): string {
  if (nodeIds.length === 0) throw new Error('peakNodesQuery needs at least one node id');
  return `[out:json][timeout:60];node(id:${nodeIds.join(',')});out;`;
}

const escapeOverpassString = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export function peaksByNameQuery(names: string[]): string {
  if (names.length === 0) throw new Error('peaksByNameQuery needs at least one name');
  const parts = names
    .map((name) => `node[natural=peak][name="${escapeOverpassString(name)}"](${POLAND_BBOX});`)
    .join('');
  return `[out:json][timeout:60];(${parts});out;`;
}
