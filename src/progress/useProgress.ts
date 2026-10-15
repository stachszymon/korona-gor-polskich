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
  const [state, setState] = useState<State>(initial.state);
  // Mirror of the latest state so that several calls within one tick compose correctly.
  const latest = useRef<State>(initial.state);
  // Becomes null once writing must stop (see `syncFromStorage`).
  const storageRef = useRef<Storage | null>(initial.storage);

  const publish = useCallback((next: State) => {
    latest.current = next;
    setState(next);
  }, []);

  /**
   * Re-reads storage so that a write never builds on stale state from before another tab's
   * change. If the stored data is unreadable and its backup cannot be written, writing stops
   * for good so the original is never overwritten.
   */
  const syncFromStorage = useCallback(() => {
    const storage = storageRef.current;
    if (!storage) return;
    const loaded = loadProgress(storage, now);
    if (!loaded.persistent) storageRef.current = null;
    // A failed read (not corrupt data) says nothing about the stored progress: keep ours.
    const keepCurrent = !loaded.persistent && !loaded.recoveredCorrupt;
    publish({
      progress: keepCurrent ? latest.current.progress : loaded.progress,
      persistent: loaded.persistent,
      recoveredCorrupt: latest.current.recoveredCorrupt || loaded.recoveredCorrupt,
    });
  }, [publish]);

  const commit = useCallback(
    (progress: Progress) => {
      const saved = saveProgress(storageRef.current, progress);
      publish({ progress, persistent: saved, recoveredCorrupt: latest.current.recoveredCorrupt });
    },
    [publish],
  );

  const setStatus = useCallback(
    (peakId: string, entry: PeakProgress | null) => {
      syncFromStorage();
      commit(setPeakStatus(latest.current.progress, peakId, entry, now().toISOString()));
    },
    [syncFromStorage, commit],
  );

  const replace = useCallback((p: Progress) => commit(p), [commit]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== STORAGE_KEY) return;
      if (e.storageArea && e.storageArea !== storageRef.current) return;
      syncFromStorage();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [syncFromStorage]);

  return {
    progress: state.progress,
    persistent: state.persistent,
    recoveredCorrupt: state.recoveredCorrupt,
    setStatus,
    replace,
  };
}
