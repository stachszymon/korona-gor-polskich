import { useCallback, useEffect, useState } from 'react';
import { loadPeakDetail, loadPeaksIndex } from './api';
import type { PeakDetail, PeaksIndex } from './schema';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

type Settled<T> = { key: string; data: T } | { key: string; data: null };

interface Resource<T> {
  status: LoadStatus;
  data: T | null;
  retry(): void;
}

const defaultFetch: typeof fetch = (...args) => fetch(...args);

/**
 * Loads one resource at a time. Every request is tagged with a key (resource id plus
 * retry attempt); a result is used only while its key is still the current one, so a
 * late response for a previously selected resource is dropped.
 */
function useResource<T>(id: string | null, load: (id: string) => Promise<T>): Resource<T> {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const key = id === null ? null : `${id}#${attempt}`;

  useEffect(() => {
    if (id === null || key === null) return;
    let current = true;
    load(id).then(
      (data) => {
        if (current) setSettled({ key, data });
      },
      () => {
        if (current) setSettled({ key, data: null });
      },
    );
    return () => {
      current = false;
    };
  }, [id, key, load]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (key === null) return { status: 'idle', data: null, retry };
  if (settled === null || settled.key !== key) return { status: 'loading', data: null, retry };
  if (settled.data === null) return { status: 'error', data: null, retry };
  return { status: 'ready', data: settled.data, retry };
}

export function usePeakDetail(
  peakId: string | null,
  fetchFn: typeof fetch = defaultFetch,
): { status: LoadStatus; detail: PeakDetail | null; retry(): void } {
  const load = useCallback((id: string) => loadPeakDetail(id, fetchFn), [fetchFn]);
  const { status, data, retry } = useResource(peakId, load);
  return { status, detail: data, retry };
}

const INDEX_ID = 'index';

export function usePeaksIndex(
  fetchFn: typeof fetch = defaultFetch,
): { status: LoadStatus; index: PeaksIndex | null; retry(): void } {
  const load = useCallback(() => loadPeaksIndex(fetchFn), [fetchFn]);
  const { status, data, retry } = useResource(INDEX_ID, load);
  return { status, index: data, retry };
}
