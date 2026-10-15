import { act, renderHook } from '@testing-library/react';
import { loadProgress, saveProgress, STORAGE_KEY, type Progress } from './progress';
import { useProgress } from './useProgress';

const stored = (): Progress => ({
  version: 1,
  updatedAt: '2026-10-15T12:00:00Z',
  peaks: { rysy: { status: 'planned' } },
});

const fireStorage = (key: string | null, newValue: string | null) => {
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue, storageArea: localStorage }));
  });
};

const reload = () => loadProgress(localStorage, () => new Date()).progress;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useProgress', () => {
  it('starts empty and persistent when nothing is stored', () => {
    const { result } = renderHook(() => useProgress());
    expect(result.current.progress.peaks).toEqual({});
    expect(result.current.persistent).toBe(true);
    expect(result.current.recoveredCorrupt).toBe(false);
  });

  it('loads stored progress', () => {
    saveProgress(localStorage, stored());
    const { result } = renderHook(() => useProgress());
    expect(result.current.progress).toEqual(stored());
  });

  it('reports recovered corrupt data', () => {
    localStorage.setItem(STORAGE_KEY, 'garbage');
    const { result } = renderHook(() => useProgress());
    expect(result.current.recoveredCorrupt).toBe(true);
    expect(result.current.progress.peaks).toEqual({});
  });

  it('setStatus persists to storage', () => {
    const { result } = renderHook(() => useProgress());
    act(() => {
      result.current.setStatus('babia-gora', { status: 'done', date: '2026-08-14' });
    });
    expect(result.current.progress.peaks['babia-gora']).toEqual({
      status: 'done',
      date: '2026-08-14',
    });
    expect(reload().peaks['babia-gora']).toEqual({ status: 'done', date: '2026-08-14' });
  });

  it('setStatus with null removes the entry', () => {
    saveProgress(localStorage, stored());
    const { result } = renderHook(() => useProgress());
    act(() => {
      result.current.setStatus('rysy', null);
    });
    expect(result.current.progress.peaks).toEqual({});
    expect(reload().peaks).toEqual({});
  });

  it('two setStatus calls in one tick both apply', () => {
    const { result } = renderHook(() => useProgress());
    act(() => {
      result.current.setStatus('a', { status: 'done' });
      result.current.setStatus('b', { status: 'planned' });
    });
    expect(Object.keys(result.current.progress.peaks).sort()).toEqual(['a', 'b']);
    expect(Object.keys(reload().peaks).sort()).toEqual(['a', 'b']);
  });

  it('replace swaps the whole progress and persists it', () => {
    const { result } = renderHook(() => useProgress());
    act(() => {
      result.current.setStatus('a', { status: 'done' });
    });
    act(() => {
      result.current.replace(stored());
    });
    expect(result.current.progress).toEqual(stored());
    expect(reload()).toEqual(stored());
  });

  it('storage event from another tab updates state', () => {
    const { result } = renderHook(() => useProgress());
    expect(result.current.progress.peaks).toEqual({});
    const next: Progress = {
      version: 1,
      updatedAt: '2026-10-16T08:00:00Z',
      peaks: { sniezka: { status: 'done' } },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    fireStorage(STORAGE_KEY, JSON.stringify(next));
    expect(result.current.progress).toEqual(next);
  });

  it('does not overwrite another tab\'s change after its storage event (A from tab 2, then B here)', () => {
    const { result } = renderHook(() => useProgress());
    const fromOtherTab: Progress = {
      version: 1,
      updatedAt: '2026-10-16T08:00:00Z',
      peaks: { a: { status: 'done' } },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fromOtherTab));
    fireStorage(STORAGE_KEY, JSON.stringify(fromOtherTab));
    act(() => {
      result.current.setStatus('b', { status: 'planned' });
    });
    expect(Object.keys(reload().peaks).sort()).toEqual(['a', 'b']);
    expect(Object.keys(result.current.progress.peaks).sort()).toEqual(['a', 'b']);
  });

  it('does not overwrite another tab\'s change even when its storage event has not arrived yet', () => {
    const { result } = renderHook(() => useProgress());
    const fromOtherTab: Progress = {
      version: 1,
      updatedAt: '2026-10-16T08:00:00Z',
      peaks: { a: { status: 'done' } },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fromOtherTab));
    act(() => {
      result.current.setStatus('b', { status: 'planned' });
    });
    expect(Object.keys(reload().peaks).sort()).toEqual(['a', 'b']);
  });

  it.each([
    ['corrupt JSON', 'garbage{'],
    ['newer version', JSON.stringify({ version: 2, updatedAt: '2026-10-16T08:00:00Z', peaks: {} })],
  ])('stops writing when a storage event brings %s and the backup fails', (_name, raw) => {
    saveProgress(localStorage, stored());
    const { result } = renderHook(() => useProgress());
    const realSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key.includes('.corrupt-')) throw new DOMException('full', 'QuotaExceededError');
      realSetItem.call(this, key, value);
    });
    localStorage.setItem(STORAGE_KEY, raw);
    fireStorage(STORAGE_KEY, raw);
    expect(result.current.recoveredCorrupt).toBe(true);
    expect(result.current.persistent).toBe(false);
    act(() => {
      result.current.setStatus('b', { status: 'done' });
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
    expect(result.current.progress.peaks['b']).toEqual({ status: 'done' });
    expect(result.current.persistent).toBe(false);
  });

  it('ignores storage events for other keys', () => {
    const { result } = renderHook(() => useProgress());
    act(() => {
      result.current.setStatus('a', { status: 'done' });
    });
    localStorage.setItem('other', 'x');
    fireStorage('other', 'x');
    expect(result.current.progress.peaks['a']).toEqual({ status: 'done' });
  });

  it('resets to empty when the key is removed in another tab', () => {
    saveProgress(localStorage, stored());
    const { result } = renderHook(() => useProgress());
    localStorage.removeItem(STORAGE_KEY);
    fireStorage(STORAGE_KEY, null);
    expect(result.current.progress.peaks).toEqual({});
  });

  it('removes its listener on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useProgress());
    unmount();
    expect(remove).toHaveBeenCalledWith('storage', expect.any(Function));
  });

  it('keeps state in memory when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const { result } = renderHook(() => useProgress());
    expect(result.current.persistent).toBe(false);
    act(() => {
      result.current.setStatus('a', { status: 'done' });
    });
    expect(result.current.progress.peaks['a']).toEqual({ status: 'done' });
    expect(result.current.persistent).toBe(false);
  });

  it('flips persistent to false when a save fails later', () => {
    const { result } = renderHook(() => useProgress());
    expect(result.current.persistent).toBe(true);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    act(() => {
      result.current.setStatus('a', { status: 'done' });
    });
    expect(result.current.persistent).toBe(false);
    expect(result.current.progress.peaks['a']).toEqual({ status: 'done' });
  });
});
