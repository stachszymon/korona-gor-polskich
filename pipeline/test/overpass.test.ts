import { describe, expect, it, vi } from 'vitest';
import {
  OVERPASS_ENDPOINTS,
  OverpassError,
  USER_AGENT,
  fetchOverpass,
  hikingRelationsQuery,
  peakNodesQuery,
  peaksByNameQuery,
  trailheadCandidatesQuery,
} from '../src/overpass';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const html = (status = 200): Response =>
  new Response('<html><body>runtime error: Query timed out</body></html>', {
    status,
    headers: { 'content-type': 'text/html' },
  });

const OK = { elements: [{ type: 'node', id: 1, lat: 50, lon: 20 }] };

describe('constants', () => {
  it('lists the mirrors in order', () => {
    expect(OVERPASS_ENDPOINTS).toEqual([
      'https://overpass-api.de/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ]);
  });

  it('identifies the project in the User-Agent', () => {
    expect(USER_AGENT).toBe(
      'korona-gor-polskich/0.1 (+https://github.com/stachszymon/korona-gor-polskich)',
    );
  });
});

describe('fetchOverpass', () => {
  it('sends POST with form-encoded data and User-Agent header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(OK));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const query = '[out:json];node(1);out;';

    const result = await fetchOverpass(query, {
      fetch: fetchMock as unknown as typeof fetch,
      sleep,
    });

    expect(result).toEqual(OK);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(OVERPASS_ENDPOINTS[0]);
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('user-agent')).toBe(USER_AGENT);
    expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(init.body).toBe(`data=${encodeURIComponent(query)}`);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries same endpoint up to 3 times with backoff 1s, 2s, 4s then moves to next mirror', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({}, 502))
      .mockResolvedValueOnce(json({}, 502))
      .mockResolvedValueOnce(json({}, 502))
      .mockResolvedValueOnce(json({}, 502))
      .mockResolvedValueOnce(json(OK));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await fetchOverpass('q', {
      fetch: fetchMock as unknown as typeof fetch,
      sleep,
    });

    expect(result).toEqual(OK);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000]);
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls).toEqual([
      OVERPASS_ENDPOINTS[0],
      OVERPASS_ENDPOINTS[0],
      OVERPASS_ENDPOINTS[0],
      OVERPASS_ENDPOINTS[0],
      OVERPASS_ENDPOINTS[1],
    ]);
  });

  it('treats HTML body with 200 status as failure', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(html(200)).mockResolvedValueOnce(json(OK));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await fetchOverpass('q', {
      fetch: fetchMock as unknown as typeof fetch,
      sleep,
    });

    expect(result).toEqual(OK);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('treats a network error as failure and retries', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(json(OK));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await fetchOverpass('q', {
      fetch: fetchMock as unknown as typeof fetch,
      sleep,
    });

    expect(result).toEqual(OK);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000]);
  });

  it('treats a 200 JSON response with a runtime error remark as failure', async () => {
    const partial = {
      remark: 'runtime error: Query timed out in "query" at line 1 after 91 seconds.',
      elements: [{ type: 'node', id: 9, lat: 1, lon: 2 }],
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(json(partial)).mockResolvedValueOnce(json(OK));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await fetchOverpass('q', {
      fetch: fetchMock as unknown as typeof fetch,
      sleep,
    });

    expect(result).toEqual(OK);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000]);
  });

  it('records the runtime error remark in the attempts', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(json({ remark: 'runtime error: Out of memory', elements: [] })),
      );

    const error = await fetchOverpass('q', {
      fetch: fetchMock as unknown as typeof fetch,
      sleep: vi.fn().mockResolvedValue(undefined),
      endpoints: ['https://a.example/api'],
      retries: 0,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OverpassError);
    expect((error as OverpassError).attempts[0]).toContain('runtime error: Out of memory');
  });

  it('keeps a response whose remark is not a runtime error', async () => {
    const body = { remark: 'something harmless', elements: [] };
    const fetchMock = vi.fn().mockResolvedValue(json(body));

    const result = await fetchOverpass('q', {
      fetch: fetchMock as unknown as typeof fetch,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    expect(result.elements).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats invalid JSON as failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"elements": [', { status: 200 }))
      .mockResolvedValueOnce(json(OK));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await fetchOverpass('q', {
      fetch: fetchMock as unknown as typeof fetch,
      sleep,
    });

    expect(result).toEqual(OK);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('treats a response without an elements array as failure', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(json({ version: 0.6 })));

    const error = await fetchOverpass('q', {
      fetch: fetchMock as unknown as typeof fetch,
      sleep: vi.fn().mockResolvedValue(undefined),
      endpoints: ['https://a.example/api'],
      retries: 0,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OverpassError);
    expect((error as OverpassError).attempts[0]).toContain('elements');
  });

  it('aborts a request after timeoutMs and counts it as a failed attempt', async () => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const signal = init.signal as AbortSignal;
        signals.push(signal);
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      });

      const pending = fetchOverpass('q', {
        fetch: fetchMock as unknown as typeof fetch,
        sleep: vi.fn().mockResolvedValue(undefined),
        endpoints: ['https://a.example/api'],
        retries: 0,
        timeoutMs: 5000,
      }).catch((e: unknown) => e);

      await vi.advanceTimersByTimeAsync(4999);
      expect(signals[0]?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signals[0]?.aborted).toBe(true);

      const error = await pending;
      expect(error).toBeInstanceOf(OverpassError);
      expect((error as OverpassError).attempts).toHaveLength(1);
      expect((error as OverpassError).attempts[0]).toContain('timed out after 5000 ms');
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults the request timeout to 120000 ms', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const signal = init.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      });

      let settled = false;
      const pending = fetchOverpass('q', {
        fetch: fetchMock as unknown as typeof fetch,
        sleep: vi.fn().mockResolvedValue(undefined),
        endpoints: ['https://a.example/api'],
        retries: 0,
      })
        .catch((e: unknown) => e)
        .finally(() => {
          settled = true;
        });

      await vi.advanceTimersByTimeAsync(119_999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(await pending).toBeInstanceOf(OverpassError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws OverpassError listing every attempt when all mirrors fail', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json({}, 504)));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const error = await fetchOverpass('q', {
      fetch: fetchMock as unknown as typeof fetch,
      sleep,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OverpassError);
    const attempts = (error as OverpassError).attempts;
    expect(attempts).toHaveLength(12); // 3 mirrors x (1 try + 3 retries)
    for (const endpoint of OVERPASS_ENDPOINTS) {
      expect(attempts.filter((a) => a.includes(endpoint))).toHaveLength(4);
    }
    expect(attempts[0]).toContain('504');
    expect(fetchMock).toHaveBeenCalledTimes(12);
    // 1s, 2s, 4s between attempts on the same mirror only; none between mirrors.
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([
      1000, 2000, 4000, 1000, 2000, 4000, 1000, 2000, 4000,
    ]);
  });

  it('honours custom endpoints and retries', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json({}, 500)));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const error = await fetchOverpass('q', {
      fetch: fetchMock as unknown as typeof fetch,
      sleep,
      endpoints: ['https://a.example/api'],
      retries: 1,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OverpassError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000]);
  });

  it('turns way elements with a center into nodes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({
        elements: [
          { type: 'node', id: 1, lat: 50, lon: 20 },
          {
            type: 'way',
            id: 2,
            center: { lat: 49.5, lon: 19.5 },
            tags: { amenity: 'parking' },
          },
        ],
      }),
    );

    const result = await fetchOverpass('q', {
      fetch: fetchMock as unknown as typeof fetch,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    expect(result.elements).toEqual([
      { type: 'node', id: 1, lat: 50, lon: 20 },
      { type: 'node', id: 2, lat: 49.5, lon: 19.5, tags: { amenity: 'parking' } },
    ]);
  });
});

describe('query builders', () => {
  it('hikingRelationsQuery asks for hiking relations with geometry', () => {
    expect(hikingRelationsQuery(49.18, 20.08, 8000)).toBe(
      '[out:json][timeout:90];rel(around:8000,49.18,20.08)[route=hiking];out geom;',
    );
  });

  it('trailheadCandidatesQuery covers parkings, stations, stops and places', () => {
    const q = trailheadCandidatesQuery(49.18, 20.08, 5000);
    expect(q).toContain('[out:json]');
    expect(q).toContain('node[amenity=parking](around:5000,49.18,20.08)');
    expect(q).toContain('way[amenity=parking](around:5000,49.18,20.08)');
    expect(q).toContain('node[railway~"^(station|halt)$"](around:5000,49.18,20.08)');
    expect(q).toContain('node[highway=bus_stop](around:5000,49.18,20.08)');
    expect(q).toContain('node[place~"^(village|town|hamlet)$"](around:5000,49.18,20.08)');
    expect(q.endsWith('out center;')).toBe(true);
  });

  it('peakNodesQuery selects nodes by id', () => {
    expect(peakNodesQuery([10, 20, 30])).toBe('[out:json][timeout:60];node(id:10,20,30);out;');
  });

  it('peaksByNameQuery searches named peaks within the Poland bbox', () => {
    const q = peaksByNameQuery(['Rysy', 'Śnieżka']);
    expect(q).toContain('node[natural=peak][name="Rysy"](49.0,14.0,51.1,24.2);');
    expect(q).toContain('node[natural=peak][name="Śnieżka"](49.0,14.0,51.1,24.2);');
    expect(q.endsWith('out;')).toBe(true);
  });

  it('peakNodesQuery throws on an empty list', () => {
    expect(() => peakNodesQuery([])).toThrow(Error);
  });

  it('peaksByNameQuery throws on an empty list', () => {
    expect(() => peaksByNameQuery([])).toThrow(Error);
  });

  it('peaksByNameQuery escapes quotes and backslashes in names', () => {
    const q = peaksByNameQuery(['A "B" \\C']);
    expect(q).toContain('[name="A \\"B\\" \\\\C"]');
  });
});
