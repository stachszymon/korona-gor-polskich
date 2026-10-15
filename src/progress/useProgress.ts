import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getStorage,
  loadProgress,
  saveProgress,
  setPeakStatus,
  STORAGE_KEY,
  type PeakProgress,
  type Progress,
} from './progress';

interface State {
  progress: Progress;
  persistent: boolean;
  recoveredCorrupt: boolean;
}

interface Initial {
  /** Storage to write to; `null` keeps progress in session memory only. */
  storage: Storage | null;
  state: State;
}

const now = () => new Date();

function init(): Initial {
  const storage = getStorage();
  const loaded = loadProgress(storage, now);
  // When loading says "not persistent" (e.g. the corrupt backup failed), never write,
  // so the original data is not overwritten.
  return { storage: loaded.persistent ? storage : null, state: loaded };
}

export function useProgress(): {
  progress: Progress;
  persistent: boolean;
  recoveredCorrupt: boolean;
  setStatus(peakId: string, entry: PeakProgress | null): void;
  replace(p: Progress): void;
} {
  const [initial] = useState(init);
  const storage = initial.storage;
  const [state, setState] = useState<State>(initial.state);
  // Mirror of the latest state so that several calls within one tick compose correctly.
  const latest = useRef<State>(state);

  const commit = useCallback(
    (progress: Progress) => {
      const saved = saveProgress(storage, progress);
      const next: State = {
        progress,
        persistent: saved,
        recoveredCorrupt: latest.current.recoveredCorrupt,
      };
      latest.current = next;
      setState(next);
    },
    [storage],
  );

  const setStatus = useCallback(
    (peakId: string, entry: PeakProgress | null) => {
      commit(setPeakStatus(latest.current.progress, peakId, entry, now().toISOString()));
    },
    [commit],
  );

  const replace = useCallback((p: Progress) => commit(p), [commit]);

  useEffect(() => {
    if (!storage) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== STORAGE_KEY) return;
      if (e.storageArea && e.storageArea !== storage) return;
      const loaded = loadProgress(storage, now);
      const next: State = {
        progress: loaded.progress,
        persistent: loaded.persistent,
        recoveredCorrupt: latest.current.recoveredCorrupt || loaded.recoveredCorrupt,
      };
      latest.current = next;
      setState(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storage]);

  return {
    progress: state.progress,
    persistent: state.persistent,
    recoveredCorrupt: state.recoveredCorrupt,
    setStatus,
    replace,
  };
}
