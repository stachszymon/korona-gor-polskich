import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { downloadText } from '../lib/download';
import { exportProgress, importSummaryText, parseImport, type ImportSummary } from '../progress/importExport';
import type { Progress } from '../progress/progress';

export interface ProgressMenuProps {
  progress: Progress;
  /** Ids of the peaks in the app; entries for other ids are dropped on import. */
  knownPeakIds: Set<string>;
  onReplace(progress: Progress): void;
  now?(): Date;
}

type Pending = { progress: Progress; summary: ImportSummary };

export function ProgressMenu({ progress, knownPeakIds, onReplace, now = () => new Date() }: ProgressMenuProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function close() {
    setOpen(false);
    setPending(null);
    setError(null);
  }

  function handleExport() {
    const { filename, content } = exportProgress(progress, now());
    downloadText(filename, content, 'application/json');
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      setPending(null);
      setError('Nie udało się odczytać pliku');
      return;
    } finally {
      // Allow choosing the same file again.
      input.value = '';
    }
    const result = parseImport(text, knownPeakIds);
    if (result.ok) {
      setError(null);
      setPending({ progress: result.progress, summary: result.summary });
    } else {
      setPending(null);
      setError(result.error);
    }
  }

  function replace() {
    if (!pending) return;
    onReplace(pending.progress);
    close();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && open) close();
  }

  return (
    <div className="progress-menu" onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="progress-menu__toggle"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        Mój postęp
      </button>
      {open && (
        <div className="progress-menu__panel">
          <button type="button" onClick={handleExport}>
            Eksportuj
          </button>
          <button type="button" disabled={knownPeakIds.size === 0} onClick={() => inputRef.current?.click()}>
            Importuj
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            aria-label="Plik postępu"
            className="visually-hidden"
            tabIndex={-1}
            onChange={(e) => void handleFile(e)}
          />
          {error && (
            <p className="progress-menu__error" role="alert">
              {error}
            </p>
          )}
          {pending && (
            <div className="progress-menu__confirm">
              <p role="status">{importSummaryText(pending.summary)}</p>
              <button type="button" onClick={replace}>
                Zastąp
              </button>
              <button type="button" onClick={() => setPending(null)}>
                Anuluj
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
