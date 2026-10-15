import { describe, expect, it, vi } from 'vitest';
import {
  OSM_API_BASE,
  bboxAround,
  osmApiFetcher,
  splitBbox,
  toHikingRelations,
  toTrailheadPois,
  type Bbox,
  type OsmElement,
} from '../src/osm-api';
import {
  USER_AGENT,
  hikingRelationsQuery,
  peakNodesQuery,
  trailheadCandidatesQuery,
  type OverpassRelation,
} from '../src/overpass';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const PEAK = { lat: 49.573, lon: 19.529 };

/** A small hiking network near PEAK, as the OSM API `map` call returns it. */
const MAP: OsmElement[] = [
  { type: 'node', id: 1, lat: 49.573, lon: 19.529 },
  { type: 'node', id: 2, lat: 49.58, lon: 19.53 },
  { type: 'node', id: 3, lat: 49.59, lon: 19.531, tags: { amenity: 'parking', name: 'Parking Markowa' } },
  { type: 'node', id: 4, lat: 49.585, lon: 19.52, tags: { highway: 'bus_stop', name: 'Zawoja Policzne' } },
  { type: 'node', id: 5, lat: 49.62, lon: 19.53, tags: { place: 'village', name: 'Zawoja' } },
  { type: 'node', id: 6, lat: 49.58, lon: 19.54, tags: { natural: 'tree' } },
  { type: 'node', id: 7, lat: 49.6, lon: 19.5 },
  { type: 'node', id: 8, lat: 49.602, lon: 19.504 },
  { type: 'node', id: 9, lat: 49.8, lon: 19.53, tags: { highway: 'bus_stop', name: 'Far away' } },
  { type: 'node', id: 10, lat: 49.585, lon: 19.52, tags: { place: 'locality', name: 'Not a settlement' } },
  { type: 'way', id: 100, nodes: [1, 2], tags: { highway: 'path' } },
  { type: 'way', id: 101, nodes: [7, 8, 8], tags: { amenity: 'parking' } },
  { type: 'way', id: 102, nodes: [2, 3], tags: { highway: 'track' } },
  {
    type: 'relation',
    id: 1000,
    tags: { type: 'route', route: 'hiking', 'osmc:symbol': 'red:white:red_bar', name: 'Czerwony' },
    members: [
      { type: 'way', ref: 100, role: '' },
      { type: 'way', ref: 999, role: '' }, // outside the downloaded area: no geometry
      { type: 'node', ref: 1, role: 'guidepost' },
    ],
  },
  {
    type: 'relation',
    id: 1001,
    tags: { type: 'route', route: 'bicycle', colour: 'red' },
    members: [{ type: 'way', ref: 102, role: '' }],
  },
];

describe('bboxes', () => {
  it('bboxAround covers the circle of the radius', () => {
    const b = bboxAround(PEAK.lat, PEAK.lon, 10_000);
    expect(b.south).toBeCloseTo(PEAK.lat - 0.0899, 3);
    expect(b.north).toBeCloseTo(PEAK.lat + 0.0899, 3);
    // 1 degree of longitude at 49.6° N is ~72 km.
    expect(b.east - b.west).toBeGreaterThan(0.27);
    expect(b.east - b.west).toBeLessThan(0.28);
  });

  it('splitBbox tiles the box without gaps into tiles no larger than the limit', () => {
    const b: Bbox = { west: 19.0, south: 49.0, east: 19.28, north: 49.18 };
    const tiles = splitBbox(b, 0.05);
    expect(tiles).toHaveLength(6 * 4);
    for (const t of tiles) {
      expect(t.east - t.west).toBeLessThanOrEqual(0.05 + 1e-9);
      expect(t.north - t.south).toBeLessThanOrEqual(0.05 + 1e-9);
    }
    const area = tiles.reduce((s, t) => s + (t.east - t.west) * (t.north - t.south), 0);
    expect(area).toBeCloseTo(0.28 * 0.18, 9);
  });
});

describe('conversion to the Overpass shape', () => {
  it('keeps route=hiking relations with the geometry of downloaded member ways', () => {
    const relations = toHikingRelations(MAP);
    expect(relations).toHaveLength(1);
    const rel = relations[0]!;
    expect(rel.id).toBe(1000);
    expect(rel.tags['osmc:symbol']).toBe('red:white:red_bar');
    expect(rel.members).toEqual([
      {
        type: 'way',
        ref: 100,
        role: '',
        geometry: [
          { lat: 49.573, lon: 19.529 },
          { lat: 49.58, lon: 19.53 },
        ],
      },
      { type: 'way', ref: 999, role: '' },
      { type: 'node', ref: 1, role: 'guidepost' },
    ]);
  });

  it('returns trailhead POIs within the radius, parking ways as their bbox centre', () => {
    const pois = toTrailheadPois(MAP, PEAK.lat, PEAK.lon, 10_000);
    expect(pois.map((p) => p.id).sort((a, b) => a - b)).toEqual([3, 4, 5, 101]);
    const parkingWay = pois.find((p) => p.id === 101)!;
    expect(parkingWay).toEqual({
      type: 'node',
      id: 101,
      lat: expect.closeTo(49.601, 9),
      lon: expect.closeTo(19.502, 9),
      tags: { amenity: 'parking' },
    });
  });
});

/** Fake OSM API: every map call returns MAP, nodes.json returns the listed nodes. */
function fakeApi(overrides: (url: string) => Response | undefined = () => undefined) {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    const special = overrides(url);
    if (special) return special;
    if (url.includes('/map.json?')) return json({ version: '0.6', elements: MAP });
    if (url.includes('/nodes.json?')) {
      const ids = new URL(url).searchParams.get('nodes')!.split(',').map(Number);
      return json({ elements: MAP.filter((e) => e.type === 'node' && ids.includes(e.id)) });
    }
    return json({}, 404);
  });
}

describe('osmApiFetcher', () => {
  it('answers the hiking relations query from map tiles, deduplicated, with User-Agent and pauses', async () => {
    const fetchMock = fakeApi();
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetcher = osmApiFetcher({ fetch: fetchMock as unknown as typeof fetch, sleep, maxTileDeg: 0.1 });

    const res = await fetcher(hikingRelationsQuery(PEAK.lat, PEAK.lon, 10_000));

    // 0.18 x 0.28 deg split into tiles of at most 0.1 deg: 2 x 3.
    expect(fetchMock).toHaveBeenCalledTimes(6);
    for (const [url, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(url.startsWith(`${OSM_API_BASE}/map.json?bbox=`)).toBe(true);
      expect(new Headers(init.headers).get('user-agent')).toBe(USER_AGENT);
    }
    expect(sleep).toHaveBeenCalledTimes(6);
    for (const [ms] of sleep.mock.calls) expect(ms).toBeGreaterThanOrEqual(1000);
    expect(res.elements.map((e) => `${e.type}/${e.id}`)).toEqual(['relation/1000']);
    expect((res.elements[0] as OverpassRelation).members[0]).toMatchObject({ ref: 100 });
  });

  it('reuses the downloaded tiles for the trailhead query of the same peak', async () => {
    const fetchMock = fakeApi();
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetcher = osmApiFetcher({ fetch: fetchMock as unknown as typeof fetch, sleep, maxTileDeg: 0.1 });

    await fetcher(hikingRelationsQuery(PEAK.lat, PEAK.lon, 10_000));
    const pois = await fetcher(trailheadCandidatesQuery(PEAK.lat, PEAK.lon, 10_000));

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(pois.elements.map((e) => e.id).sort((a, b) => a - b)).toEqual([3, 4, 5, 101]);
  });

  it('splits a tile into four when the API refuses it for too many nodes', async () => {
    let refused = false;
    const fetchMock = fakeApi((url) => {
      if (!refused && url.includes('/map.json?')) {
        refused = true;
        return new Response('You requested too many nodes (limit is 50000).', { status: 400 });
      }
      return undefined;
    });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetcher = osmApiFetcher({ fetch: fetchMock as unknown as typeof fetch, sleep, maxTileDeg: 0.1 });

    await fetcher(hikingRelationsQuery(PEAK.lat, PEAK.lon, 10_000));

    // 1 refused + 4 quarters + 5 other tiles.
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('retries server errors with backoff and fails after the last retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({}, 503));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetcher = osmApiFetcher({
      fetch: fetchMock as unknown as typeof fetch,
      sleep,
      retries: 2,
      maxTileDeg: 1,
    });

    await expect(fetcher(hikingRelationsQuery(PEAK.lat, PEAK.lon, 1000))).rejects.toThrow(/HTTP 503/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('answers the peak node query with the nodes call', async () => {
    const fetchMock = fakeApi();
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetcher = osmApiFetcher({ fetch: fetchMock as unknown as typeof fetch, sleep });

    const res = await fetcher(peakNodesQuery([1, 3]));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${OSM_API_BASE}/nodes.json?nodes=1,3`);
    expect(res.elements.map((e) => e.id)).toEqual([1, 3]);
    expect(res.elements[1]).toEqual(MAP[2]);
  });

  it('rejects queries it does not understand', async () => {
    const fetcher = osmApiFetcher({ fetch: fakeApi() as unknown as typeof fetch });
    await expect(fetcher('[out:json];way(1);out;')).rejects.toThrow(/cannot answer/);
  });
});
