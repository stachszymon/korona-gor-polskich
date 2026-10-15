import { z } from 'zod';

export const STORAGE_KEY = 'kgp.progress';

export type PeakStatus = 'done' | 'planned';

export interface PeakProgress {
  status: PeakStatus;
  /** ISO calendar date, `RRRR-MM-DD`. */
  date?: string;
  /** At most 500 characters. */
  note?: string;
}

export interface Progress {
  version: 1;
  updatedAt: string;
  peaks: Record<string, PeakProgress>;
}

export class ProgressFormatError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProgressFormatError';
  }
}

export const INVALID_FILE_MESSAGE = 'To nie jest poprawny plik postępu';
export const NEWER_VERSION_MESSAGE = 'Plik pochodzi z nowszej wersji aplikacji';

const isoCalendarDate = z.string().refine((value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}, 'Expected a valid RRRR-MM-DD date');

export const PeakProgressSchema = z.object({
  status: z.enum(['done', 'planned']),
  date: isoCalendarDate.optional(),
  note: z.string().max(500).optional(),
});

export const ProgressSchema = z.object({
  version: z.literal(1),
  updatedAt: z.iso.datetime({ offset: true }),
  peaks: z.record(z.string(), PeakProgressSchema),
});

export function emptyProgress(nowIso: string): Progress {
  return { version: 1, updatedAt: nowIso, peaks: {} };
}

/** Validates `raw` and upgrades it to the current format (only version 1 exists today). */
export function migrate(raw: unknown): Progress {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ProgressFormatError(INVALID_FILE_MESSAGE);
  }
  const version = (raw as { version?: unknown }).version;
  if (typeof version !== 'number') throw new ProgressFormatError(INVALID_FILE_MESSAGE);
  if (version > 1) throw new ProgressFormatError(NEWER_VERSION_MESSAGE);
  if (version !== 1) throw new ProgressFormatError(INVALID_FILE_MESSAGE);
  const parsed = ProgressSchema.safeParse(raw);
  if (!parsed.success) throw new ProgressFormatError(INVALID_FILE_MESSAGE, { cause: parsed.error });
  return parsed.data;
}

/** Returns `localStorage` when it is usable, otherwise `null`. */
export function getStorage(): Storage | null {
  try {
    const storage = window.localStorage;
    const probe = '__kgp.probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export interface LoadResult {
  progress: Progress;
  persistent: boolean;
  recoveredCorrupt: boolean;
}

/**
 * Reads progress from `storage`. Corrupt data is copied to `kgp.progress.corrupt-<ts>` and
 * progress starts empty; the original entry is never deleted. If the backup copy cannot be
 * written, `persistent` is false so that callers never overwrite the corrupt original.
 */
export function loadProgress(storage: Storage | null, now: () => Date): LoadResult {
  const empty = () => emptyProgress(now().toISOString());
  if (!storage) return { progress: empty(), persistent: false, recoveredCorrupt: false };

  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { progress: empty(), persistent: false, recoveredCorrupt: false };
  }
  if (raw === null) return { progress: empty(), persistent: true, recoveredCorrupt: false };

  try {
    return { progress: migrate(JSON.parse(raw)), persistent: true, recoveredCorrupt: false };
  } catch {
    let backedUp = true;
    try {
      storage.setItem(`${STORAGE_KEY}.corrupt-${now().getTime()}`, raw);
    } catch {
      backedUp = false;
    }
    return { progress: empty(), persistent: backedUp, recoveredCorrupt: true };
  }
}

/** Returns true when the data was written. */
export function saveProgress(storage: Storage | null, p: Progress): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure update: sets (or, with `null`, removes) the entry for `peakId`. Throws
 * `ProgressFormatError` for an entry that would fail validation on the next load.
 */
export function setPeakStatus(
  p: Progress,
  peakId: string,
  entry: PeakProgress | null,
  nowIso: string,
): Progress {
  const peaks = { ...p.peaks };
  if (entry === null) {
    delete peaks[peakId];
  } else {
    const parsed = PeakProgressSchema.safeParse(entry);
    if (!parsed.success) throw new ProgressFormatError(INVALID_FILE_MESSAGE, { cause: parsed.error });
    peaks[peakId] = parsed.data;
  }
  return { ...p, updatedAt: nowIso, peaks };
}
