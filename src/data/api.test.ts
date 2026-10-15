import indexFixture from '../test/fixtures/peaks.json';
import babiaFixture from '../test/fixtures/peaks/babia-gora.json';
import { DataLoadError, loadPeakDetail, loadPeaksIndex } from './api';

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

describe('loadPeaksIndex', () => {
  it('loads and validates fixture index', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json(indexFixture));
    const index = await loadPeaksIndex(fetchFn, '/base/');
    expect(index.peaks).toHaveLength(28);
    expect(fetchFn).toHaveBeenCalledWith('/base/data/peaks.json');
  });

  it("non-200 response → DataLoadError kind 'network'", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('nope', { status: 404 }));
    await expect(loadPeaksIndex(fetchFn, '/')).rejects.toMatchObject({
      name: 'DataLoadError',
      kind: 'network',
    });
  });

  it("rejected fetch → DataLoadError kind 'network'", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    const err = await loadPeaksIndex(fetchFn, '/').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataLoadError);
    expect(err).toMatchObject({ kind: 'network' });
  });

  it("schema mismatch → DataLoadError kind 'invalid'", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ generatedAt: 'x', peaks: [] }));
    await expect(loadPeaksIndex(fetchFn, '/')).rejects.toMatchObject({ kind: 'invalid' });
  });

  it("malformed JSON → DataLoadError kind 'invalid'", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<html>', { status: 200 }));
    await expect(loadPeaksIndex(fetchFn, '/')).rejects.toMatchObject({ kind: 'invalid' });
  });
});

describe('loadPeakDetail', () => {
  it('loads and validates a peak file', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json(babiaFixture));
    const detail = await loadPeakDetail('babia-gora', fetchFn, '/base/');
    expect(detail.routes).toHaveLength(3);
    expect(fetchFn).toHaveBeenCalledWith('/base/data/peaks/babia-gora.json');
  });

  it("non-200 response → DataLoadError kind 'network'", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 500 }));
    await expect(loadPeakDetail('rysy', fetchFn, '/')).rejects.toMatchObject({ kind: 'network' });
  });

  it("schema mismatch → DataLoadError kind 'invalid'", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ peakId: 'rysy' }));
    await expect(loadPeakDetail('rysy', fetchFn, '/')).rejects.toMatchObject({ kind: 'invalid' });
  });
});
