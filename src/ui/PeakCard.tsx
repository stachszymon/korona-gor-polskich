import type { PeakDetail, PeakSummary } from '../data/schema';
import type { PeakProgress } from '../progress/progress';
import { RouteList } from './RouteList';
import { StatusControls } from './StatusControls';

export interface PeakCardProps {
  peak: PeakSummary;
  detailStatus: 'loading' | 'ready' | 'error';
  detail: PeakDetail | null;
  entry: PeakProgress | null;
  selectedRouteId: string | null;
  onSelectRoute(id: string): void;
  onStatusChange(entry: PeakProgress | null): void;
  onRetry(): void;
  onClose(): void;
}

export function PeakCard({
  peak,
  detailStatus,
  detail,
  entry,
  selectedRouteId,
  onSelectRoute,
  onStatusChange,
  onRetry,
  onClose,
}: PeakCardProps) {
  return (
    <article className="peak-card" aria-label={peak.name}>
      <header className="peak-card__header">
        <h2 className="peak-card__title">{peak.name}</h2>
        <button type="button" className="peak-card__close" onClick={onClose}>
          Zamknij
        </button>
      </header>
      <p className="peak-card__meta">{`${peak.elevation} m n.p.m. · ${peak.range}`}</p>

      <StatusControls key={peak.id} entry={entry} onChange={onStatusChange} />

      <section className="peak-card__routes" aria-label="Trasy">
        {detailStatus === 'loading' && <p className="peak-card__loading">Wczytywanie tras…</p>}
        {detailStatus === 'error' && (
          <div className="peak-card__error" role="alert">
            <p>Nie udało się wczytać tras.</p>
            <button type="button" onClick={onRetry}>
              Spróbuj ponownie
            </button>
          </div>
        )}
        {detailStatus === 'ready' && detail && (
          <RouteList routes={detail.routes} selectedRouteId={selectedRouteId} onSelectRoute={onSelectRoute} />
        )}
      </section>
    </article>
  );
}
