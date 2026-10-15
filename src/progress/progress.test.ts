import {
  emptyProgress,
  getStorage,
  loadProgress,
  migrate,
  ProgressFormatError,
  ProgressSchema,
  saveProgress,
  setPeakStatus,
  STORAGE_KEY,
  type Progress,
} from './progress';

const NOW = new Date('2026-10-15T12:00:00.000Z');
const now = () => NOW;
const NOW_ISO = '2026-10-15T12:00:00.000Z';

const sample = (): Progress => ({
  version: 1,
  updatedAt: '2026-10-15T12:00:00Z',
  peaks: {
    'babia-gora': { status: 'done', date: '2026-08-14', note: 'Mgła' },
    rysy: { status: 'planned' },
  },
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadProgress', () => {
  it('loads empty progress when key missing', () => {
    const r = loadProgress(localStorage, now);
    expect(r).toEqual({
      progress: { version: 1, updatedAt: NOW_ISO, peaks: {} },
      persistent: true,
      recoveredCorrupt: false,
    });
  });

  it('round-trips save/load', () => {
    const p = sample();
    expect(saveProgress(localStorage, p)).toBe(true);
    const r = loadProgress(localStorage, now);
    expect(r.progress).toEqual(p);
    expect(r.persistent).toBe(true);
    expect(r.recoveredCorrupt).toBe(false);
  });

  it('corrupt JSON is copied to kgp.progress.corrupt-<ts> and progress starts empty with recoveredCorrupt=true', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const r = loadProgress(localStorage, now);
    expect(r.recoveredCorrupt).toBe(true);
    expect(r.persistent).toBe(true);
    expect(r.progress).toEqual(emptyProgress(NOW_ISO));
    expect(localStorage.getItem(`kgp.progress.corrupt-${NOW.getTime()}`)).toBe('{not json');
    // The original data is never deleted silently.
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{not json');
  });

  it('schema-invalid data is treated as corrupt and backed up', () => {
    const raw = JSON.stringify({ version: 1, updatedAt: 'x', peaks: { a: { status: 'nope' } } });
    localStorage.setItem(STORAGE_KEY, raw);
    const r = loadProgress(localStorage, now);
    expect(r.recoveredCorrupt).toBe(true);
    expect(r.progress.peaks).toEqual({});
    expect(localStorage.getItem(`kgp.progress.corrupt-${NOW.getTime()}`)).toBe(raw);
  });

  it('data from a newer version is treated as corrupt and backed up', () => {
    const raw = JSON.stringify({ version: 2, updatedAt: NOW_ISO, peaks: {} });
    localStorage.setItem(STORAGE_KEY, raw);
    const r = loadProgress(localStorage, now);
    expect(r.recoveredCorrupt).toBe(true);
    expect(localStorage.getItem(`kgp.progress.corrupt-${NOW.getTime()}`)).toBe(raw);
  });

  it('is not persistent when the corrupt backup cannot be written, so the original is never overwritten', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const r = loadProgress(localStorage, now);
    expect(r.recoveredCorrupt).toBe(true);
    expect(r.persistent).toBe(false);
  });

  it('null storage → persistent=false and saveProgress returns false', () => {
    const r = loadProgress(null, now);
    expect(r).toEqual({
      progress: emptyProgress(NOW_ISO),
      persistent: false,
      recoveredCorrupt: false,
    });
    expect(saveProgress(null, sample())).toBe(false);
  });

  it('is not persistent when reading throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const r = loadProgress(localStorage, now);
    expect(r.persistent).toBe(false);
    expect(r.recoveredCorrupt).toBe(false);
    expect(r.progress.peaks).toEqual({});
  });
});

describe('saveProgress', () => {
  it('returns false when setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(saveProgress(localStorage, sample())).toBe(false);
  });
});

describe('getStorage', () => {
  it('returns localStorage when it works', () => {
    expect(getStorage()).toBe(localStorage);
    expect(localStorage.length).toBe(0);
  });

  it('returns null when setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(getStorage()).toBeNull();
  });
});

describe('migrate / schema', () => {
  it('accepts version 1', () => {
    expect(migrate(sample())).toEqual(sample());
  });

  it('rejects a missing version', () => {
    expect(() => migrate({ updatedAt: NOW_ISO, peaks: {} })).toThrow(ProgressFormatError);
  });

  it('rejects a version above 1', () => {
    expect(() => migrate({ version: 2, updatedAt: NOW_ISO, peaks: {} })).toThrow(
      'Plik pochodzi z nowszej wersji aplikacji',
    );
  });

  it('rejects non-objects', () => {
    expect(() => migrate(null)).toThrow(ProgressFormatError);
    expect(() => migrate('x')).toThrow(ProgressFormatError);
    expect(() => migrate([])).toThrow(ProgressFormatError);
  });

  it('rejects note longer than 500 chars', () => {
    const p = sample();
    p.peaks['rysy'] = { status: 'done', note: 'x'.repeat(501) };
    expect(ProgressSchema.safeParse(p).success).toBe(false);
    expect(() => migrate(p)).toThrow(ProgressFormatError);
  });

  it('accepts a note of exactly 500 chars', () => {
    const p = sample();
    p.peaks['rysy'] = { status: 'done', note: 'x'.repeat(500) };
    expect(ProgressSchema.safeParse(p).success).toBe(true);
  });

  it("rejects date '2026-13-01'", () => {
    const p = sample();
    p.peaks['rysy'] = { status: 'done', date: '2026-13-01' };
    expect(ProgressSchema.safeParse(p).success).toBe(false);
    expect(() => migrate(p)).toThrow(ProgressFormatError);
  });

  it('rejects impossible calendar dates and wrong formats', () => {
    for (const date of ['2026-02-30', '2026-2-3', '14.08.2026', '2026-08-14T10:00:00Z']) {
      const p = sample();
      p.peaks['rysy'] = { status: 'done', date };
      expect(ProgressSchema.safeParse(p).success, date).toBe(false);
    }
  });

  it('accepts a leap day', () => {
    const p = sample();
    p.peaks['rysy'] = { status: 'done', date: '2028-02-29' };
    expect(ProgressSchema.safeParse(p).success).toBe(true);
  });

  it('rejects an unknown status', () => {
    const p = { ...sample(), peaks: { rysy: { status: 'todo' } } };
    expect(() => migrate(p)).toThrow(ProgressFormatError);
  });
});

describe('setPeakStatus', () => {
  it('adds an entry and bumps updatedAt without mutating the input', () => {
    const p = sample();
    const before = structuredClone(p);
    const next = setPeakStatus(p, 'sniezka', { status: 'done', date: '2026-09-01' }, NOW_ISO);
    expect(next.updatedAt).toBe(NOW_ISO);
    expect(next.peaks['sniezka']).toEqual({ status: 'done', date: '2026-09-01' });
    expect(next.peaks['rysy']).toEqual({ status: 'planned' });
    expect(p).toEqual(before);
  });

  it('replaces an existing entry', () => {
    const next = setPeakStatus(sample(), 'rysy', { status: 'done' }, NOW_ISO);
    expect(next.peaks['rysy']).toEqual({ status: 'done' });
  });

  it('removes the entry when given null', () => {
    const next = setPeakStatus(sample(), 'rysy', null, NOW_ISO);
    expect('rysy' in next.peaks).toBe(false);
    expect(next.peaks['babia-gora']).toBeDefined();
    expect(next.updatedAt).toBe(NOW_ISO);
  });

  it('refuses an entry that would not survive a reload', () => {
    expect(() =>
      setPeakStatus(sample(), 'rysy', { status: 'done', note: 'x'.repeat(501) }, NOW_ISO),
    ).toThrow(ProgressFormatError);
  });
});
