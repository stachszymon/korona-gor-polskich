import type { PeakSummary } from '../data/schema';
import type { Progress } from '../progress/progress';

export type PeakStatusKey = 'done' | 'planned' | 'todo';

export type PeakFilter = {
  range: string | 'all';
  status: 'all' | PeakStatusKey;
  sort: 'elevation-desc' | 'name';
};

export const DEFAULT_PEAK_FILTER: PeakFilter = { range: 'all', status: 'all', sort: 'elevation-desc' };

/** Status of a peak; a peak without a progress entry is still to be climbed. */
export function peakStatus(progress: Progress, peakId: string): PeakStatusKey {
  return progress.peaks[peakId]?.status ?? 'todo';
}

export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, 'pl');
}

/** Returns a new array; `peaks` is never mutated. */
export function filterAndSortPeaks(
  peaks: readonly PeakSummary[],
  progress: Progress,
  filter: PeakFilter,
): PeakSummary[] {
  const result = peaks.filter(
    (peak) =>
      (filter.range === 'all' || peak.range === filter.range) &&
      (filter.status === 'all' || peakStatus(progress, peak.id) === filter.status),
  );
  if (filter.sort === 'name') {
    result.sort((a, b) => compareNames(a.name, b.name));
  } else {
    result.sort((a, b) => b.elevation - a.elevation || compareNames(a.name, b.name));
  }
  return result;
}

/** Distinct mountain ranges, sorted with Polish collation. */
export function listRanges(peaks: readonly PeakSummary[]): string[] {
  return [...new Set(peaks.map((peak) => peak.range))].sort(compareNames);
}
