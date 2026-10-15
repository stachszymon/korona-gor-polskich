import { useId, useState } from 'react';
import type { PeakProgress } from '../progress/progress';

export interface StatusControlsProps {
  entry: PeakProgress | null;
  onChange(entry: PeakProgress | null): void;
}

const MAX_NOTE_LENGTH = 500;

/** Drops empty optional fields so the entry always passes progress validation. */
function toEntry(status: PeakProgress['status'], date: string, note: string): PeakProgress {
  const entry: PeakProgress = { status };
  if (date !== '') entry.date = date;
  if (status === 'done' && note !== '') entry.note = note;
  return entry;
}

export function StatusControls({ entry, onChange }: StatusControlsProps) {
  const ids = useId();
  const [status, setStatus] = useState<PeakProgress['status'] | null>(entry?.status ?? null);
  const [date, setDate] = useState(entry?.date ?? '');
  const [note, setNote] = useState(entry?.note ?? '');
  const [syncedEntry, setSyncedEntry] = useState(entry);

  // Follow the stored entry when it changes from outside (e.g. an import).
  if (entry !== syncedEntry) {
    setSyncedEntry(entry);
    setStatus(entry?.status ?? null);
    setDate(entry?.date ?? '');
    setNote(entry?.note ?? '');
  }

  function choose(next: PeakProgress['status']) {
    setStatus(next);
    const nextNote = next === 'done' ? note : '';
    onChange(toEntry(next, date, nextNote));
  }

  function clear() {
    setStatus(null);
    setDate('');
    setNote('');
    onChange(null);
  }

  function changeDate(value: string) {
    setDate(value);
    if (status) onChange(toEntry(status, value, note));
  }

  function changeNote(value: string) {
    setNote(value);
    if (status === 'done') onChange(toEntry('done', date, value));
  }

  return (
    <div className="peak-card__status status-controls">
      <div className="status-controls__buttons">
        <button type="button" aria-pressed={status === 'done'} onClick={() => choose('done')}>
          Zdobyty
        </button>
        <button type="button" aria-pressed={status === 'planned'} onClick={() => choose('planned')}>
          Planuję
        </button>
        <button type="button" onClick={clear}>
          Wyczyść
        </button>
      </div>
      {status === 'done' && (
        <div className="status-controls__fields">
          <label htmlFor={`${ids}-date`}>Data</label>
          <input id={`${ids}-date`} type="date" value={date} onChange={(e) => changeDate(e.target.value)} />
          <label htmlFor={`${ids}-note`}>Notatka</label>
          <textarea
            id={`${ids}-note`}
            maxLength={MAX_NOTE_LENGTH}
            value={note}
            onChange={(e) => changeNote(e.target.value)}
          />
        </div>
      )}
      {status === 'planned' && (
        <div className="status-controls__fields">
          <label htmlFor={`${ids}-planned`}>Planowana data</label>
          <input id={`${ids}-planned`} type="date" value={date} onChange={(e) => changeDate(e.target.value)} />
        </div>
      )}
    </div>
  );
}
