import fixture from '../test/fixtures/peaks.json';
import { PeaksIndexSchema } from '../data/schema';
import { emptyProgress, type Progress } from '../progress/progress';
import { DEFAULT_PEAK_FILTER, filterAndSortPeaks, peakStatus, type PeakFilter } from './peakFilter';

const peaks = PeaksIndexSchema.parse(fixture).peaks;
const NOW = '2026-10-15T12:00:00.000Z';

function progressWith(entries: Progress['peaks']): Progress {
  return { ...emptyProgress(NOW), peaks: entries };
}

const filter = (patch: Partial<PeakFilter>): PeakFilter => ({ ...DEFAULT_PEAK_FILTER, ...patch });

describe('filterAndSortPeaks', () => {
  it('default sort is elevation descending (Rysy first)', () => {
    const result = filterAndSortPeaks(peaks, emptyProgress(NOW), DEFAULT_PEAK_FILTER);
    expect(result).toHaveLength(28);
    expect(result[0]?.name).toBe('Rysy');
    const elevations = result.map((p) => p.elevation);
    expect(elevations).toEqual([...elevations].sort((a, b) => b - a));
  });

  it('name sort uses Polish collation (Łysica after Lubomir, before Mogielica)', () => {
    const names = filterAndSortPeaks(peaks, emptyProgress(NOW), filter({ sort: 'name' })).map((p) => p.name);
    const lysica = names.indexOf('Łysica');
    expect(names.indexOf('Lubomir')).toBe(lysica - 1);
    expect(names.indexOf('Mogielica')).toBe(lysica + 1);
    expect(names.indexOf('Śnieżka')).toBeGreaterThan(names.indexOf('Skrzyczne'));
  });

  it("status filter 'todo' excludes done and planned", () => {
    const progress = progressWith({ rysy: { status: 'done' }, tarnica: { status: 'planned' } });
    const result = filterAndSortPeaks(peaks, progress, filter({ status: 'todo' }));
    expect(result).toHaveLength(26);
    expect(result.map((p) => p.id)).not.toContain('rysy');
    expect(result.map((p) => p.id)).not.toContain('tarnica');
  });

  it('status filters done and planned select only matching peaks', () => {
    const progress = progressWith({ rysy: { status: 'done' }, tarnica: { status: 'planned' } });
    expect(filterAndSortPeaks(peaks, progress, filter({ status: 'done' })).map((p) => p.id)).toEqual(['rysy']);
    expect(filterAndSortPeaks(peaks, progress, filter({ status: 'planned' })).map((p) => p.id)).toEqual([
      'tarnica',
    ]);
  });

  it('range filter keeps only peaks of the chosen range', () => {
    const result = filterAndSortPeaks(peaks, emptyProgress(NOW), filter({ range: 'Tatry' }));
    expect(result.map((p) => p.id)).toEqual(['rysy']);
  });

  it('does not mutate the input array', () => {
    const copy = [...peaks];
    filterAndSortPeaks(peaks, emptyProgress(NOW), filter({ sort: 'name' }));
    expect(peaks).toEqual(copy);
  });
});

describe('peakStatus', () => {
  it("is 'todo' for a peak without a progress entry", () => {
    expect(peakStatus(emptyProgress(NOW), 'rysy')).toBe('todo');
  });
  it('returns the stored status otherwise', () => {
    expect(peakStatus(progressWith({ rysy: { status: 'done' } }), 'rysy')).toBe('done');
  });
});
