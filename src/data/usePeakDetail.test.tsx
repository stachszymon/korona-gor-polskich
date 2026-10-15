import { act, renderHook, waitFor } from '@testing-library/react';
import indexFixture from '../test/fixtures/peaks.json';
import babiaFixture from '../test/fixtures/peaks/babia-gora.json';
import rysyFixture from '../test/fixtures/peaks/rysy.json';
import { usePeakDetail, usePeaksIndex } from './usePeakDetail';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** A fetch whose responses are resolved manually, keyed by file name. */
function controlledFetch() {
  const pending = new Map<string, (r: Response) => void>();
  const fetchFn = vi.fn<typeof fetch>((input) => {
    const url = String(input);
    return new Promise<Response>((resolve) => {
      pending.set(url.slice(url.lastIndexOf('/') + 1), resolve);
    });
  });
  return { fetchFn, pending };
}

describe('usePeakDetail', () => {
  it('is idle without a peak id', () => {
    const fetchFn = vi.fn<typeof fetch>();
    const { result } = renderHook(() => usePeakDetail(null, fetchFn));
    expect(result.current.status).toBe('idle');
    expect(result.current.detail).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('loads detail for a peak', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json(babiaFixture));
    const { result } = renderHook(() => usePeakDetail('babia-gora', fetchFn));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.detail?.peakId).toBe('babia-gora');
  });

  it('usePeakDetail ignores a late response for a previously selected peak', async () => {
    const { fetchFn, pending } = controlledFetch();
    const { result, rerender } = renderHook(({ id }) => usePeakDetail(id, fetchFn), {
      initialProps: { id: 'babia-gora' as string | null },
    });
    rerender({ id: 'rysy' });

    // B (rysy) answers first, then the late A (babia-gora) response arrives.
    await act(async () => {
      pending.get('rysy.json')!(json(rysyFixture));
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      pending.get('babia-gora.json')!(json(babiaFixture));
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.detail?.peakId).toBe('rysy');
  });

  it('ignores a late response that arrives while the newer peak is still loading', async () => {
    const { fetchFn, pending } = controlledFetch();
    const { result, rerender } = renderHook(({ id }) => usePeakDetail(id, fetchFn), {
      initialProps: { id: 'babia-gora' as string | null },
    });
    rerender({ id: 'rysy' });
    await act(async () => {
      pending.get('babia-gora.json')!(json(babiaFixture));
    });
    expect(result.current.status).toBe('loading');
    expect(result.current.detail).toBeNull();
    await act(async () => {
      pending.get('rysy.json')!(json(rysyFixture));
    });
    expect(result.current.detail?.peakId).toBe('rysy');
  });

  it('returns to idle when the selection is cleared', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json(rysyFixture));
    const { result, rerender } = renderHook(({ id }) => usePeakDetail(id, fetchFn), {
      initialProps: { id: 'rysy' as string | null },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ id: null });
    expect(result.current.status).toBe('idle');
    expect(result.current.detail).toBeNull();
  });

  it('retry() refetches after error', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(json(rysyFixture));
    const { result } = renderHook(() => usePeakDetail('rysy', fetchFn));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.detail).toBeNull();

    act(() => result.current.retry());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.detail?.peakId).toBe('rysy');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('usePeaksIndex', () => {
  it('loads the index', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json(indexFixture));
    const { result } = renderHook(() => usePeaksIndex(fetchFn));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.index?.peaks).toHaveLength(28);
  });

  it('retry() refetches after error', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(json(indexFixture));
    const { result } = renderHook(() => usePeaksIndex(fetchFn));
    await waitFor(() => expect(result.current.status).toBe('error'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });
});
