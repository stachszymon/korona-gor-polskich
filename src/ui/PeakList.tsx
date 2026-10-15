import { useId, useMemo, useState } from 'react';
import type { PeakSummary } from '../data/schema';
import { STATUS_HEX } from '../map/config';
import type { Progress } from '../progress/progress';
import {
  DEFAULT_PEAK_FILTER,
  filterAndSortPeaks,
  listRanges,
  peakStatus,
  type PeakFilter,
} from './peakFilter';

export interface PeakListProps {
  peaks: readonly PeakSummary[];
  progress: Progress;
  selectedId: string | null;
  onSelect(id: string): void;
}

const STATUS_LABELS: Record<PeakFilter['status'], string> = {
  all: 'Wszystkie',
  done: 'Zdobyte',
  planned: 'Planowane',
  todo: 'Do zdobycia',
};

const SORT_LABELS: Record<PeakFilter['sort'], string> = {
  'elevation-desc': 'Wysokość (malejąco)',
  name: 'Nazwa',
};

export function PeakList({ peaks, progress, selectedId, onSelect }: PeakListProps) {
  const [filter, setFilter] = useState<PeakFilter>(DEFAULT_PEAK_FILTER);
  const ids = useId();
  const ranges = useMemo(() => listRanges(peaks), [peaks]);
  const visible = useMemo(() => filterAndSortPeaks(peaks, progress, filter), [peaks, progress, filter]);

  return (
    <section className="peak-list" aria-label="Lista szczytów">
      <div className="peak-list__filters">
        <label htmlFor={`${ids}-range`}>Pasmo</label>
        <select
          id={`${ids}-range`}
          value={filter.range}
          onChange={(e) => setFilter({ ...filter, range: e.target.value })}
        >
          <option value="all">Wszystkie</option>
          {ranges.map((range) => (
            <option key={range} value={range}>
              {range}
            </option>
          ))}
        </select>

        <label htmlFor={`${ids}-status`}>Status</label>
        <select
          id={`${ids}-status`}
          value={filter.status}
          onChange={(e) => setFilter({ ...filter, status: e.target.value as PeakFilter['status'] })}
        >
          {(Object.keys(STATUS_LABELS) as PeakFilter['status'][]).map((key) => (
            <option key={key} value={key}>
              {STATUS_LABELS[key]}
            </option>
          ))}
        </select>

        <label htmlFor={`${ids}-sort`}>Sortuj</label>
        <select
          id={`${ids}-sort`}
          value={filter.sort}
          onChange={(e) => setFilter({ ...filter, sort: e.target.value as PeakFilter['sort'] })}
        >
          {(Object.keys(SORT_LABELS) as PeakFilter['sort'][]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
      </div>

      {visible.length === 0 ? (
        <p className="peak-list__empty">Brak szczytów spełniających filtry</p>
      ) : (
        <ul className="peak-list__items">
          {visible.map((peak) => {
            const status = peakStatus(progress, peak.id);
            return (
              <li key={peak.id}>
                <button
                  type="button"
                  className="peak-list__item"
                  aria-current={peak.id === selectedId ? 'true' : undefined}
                  onClick={() => onSelect(peak.id)}
                >
                  <span
                    className="peak-list__dot"
                    data-status={status}
                    style={{ backgroundColor: STATUS_HEX[status] }}
                    aria-hidden="true"
                  />
                  <span className="peak-list__name">{peak.name}</span>
                  <span className="peak-list__elevation">{peak.elevation} m</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
