import { plural } from '../lib/plural';
import {
  INVALID_FILE_MESSAGE,
  migrate,
  ProgressFormatError,
  type PeakProgress,
  type Progress,
} from './progress';

export function exportProgress(p: Progress, today: Date): { filename: string; content: string } {
  const yyyy = String(today.getFullYear()).padStart(4, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return {
    filename: `kgp-postep-${yyyy}-${mm}-${dd}.json`,
    content: JSON.stringify(p, null, 2),
  };
}

export interface ImportSummary {
  done: number;
  planned: number;
  droppedUnknown: number;
}

export type ImportResult =
  | { ok: true; progress: Progress; summary: ImportSummary }
  | { ok: false; error: string };

export function parseImport(text: string, knownPeakIds: Set<string>): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: INVALID_FILE_MESSAGE };
  }

  let parsed: Progress;
  try {
    parsed = migrate(raw);
  } catch (e) {
    return { ok: false, error: e instanceof ProgressFormatError ? e.message : INVALID_FILE_MESSAGE };
  }

  const peaks: Record<string, PeakProgress> = {};
  const summary: ImportSummary = { done: 0, planned: 0, droppedUnknown: 0 };
  for (const [id, entry] of Object.entries(parsed.peaks)) {
    if (!knownPeakIds.has(id)) {
      summary.droppedUnknown += 1;
      continue;
    }
    peaks[id] = entry;
    if (entry.status === 'done') summary.done += 1;
    else summary.planned += 1;
  }
  return { ok: true, progress: { ...parsed, peaks }, summary };
}

export function importSummaryText(s: ImportSummary): string {
  const parts = [
    `${s.done} ${plural(s.done, 'zdobyty', 'zdobyte', 'zdobytych')}`,
    `${s.planned} ${plural(s.planned, 'planowany', 'planowane', 'planowanych')}`,
    'nadpisze obecny postęp',
  ];
  if (s.droppedUnknown > 0) {
    const n = s.droppedUnknown;
    parts.push(`pominięto ${n} ${plural(n, 'nieznany szczyt', 'nieznane szczyty', 'nieznanych szczytów')}`);
  }
  return parts.join(', ');
}
