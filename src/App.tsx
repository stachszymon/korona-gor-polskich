import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePeakDetail, usePeaksIndex } from './data/usePeakDetail';
import { MapView } from './map/MapView';
import { pointAtDistance } from './map/routeCursor';
import { supportsWebGL as detectWebGL } from './map/webgl';
import type { PeakProgress } from './progress/progress';
import { useProgress } from './progress/useProgress';
import { Banner } from './ui/Banner';
import { ElevationProfile } from './ui/ElevationProfile';
import { Footer } from './ui/Footer';
import { PeakCard } from './ui/PeakCard';
import { PeakList } from './ui/PeakList';
import { ProgressCounter } from './ui/ProgressCounter';
import { ProgressMenu } from './ui/ProgressMenu';

import './ui/layout.css';

export interface AppDeps {
  /** Must be referentially stable: the data hooks reload when it changes. */
  fetchFn?: typeof fetch;
  supportsWebGL?: () => boolean;
}

/** Text and date edits are saved this long after the last keystroke. */
const EDIT_DEBOUNCE_MS = 400;

export function App({ deps = {} }: { deps?: AppDeps }) {
  const { fetchFn, supportsWebGL = detectWebGL } = deps;
  const [webglSupported] = useState(supportsWebGL);
  // The map can still fail to start after the probe; then the app behaves as without WebGL.
  const [mapFailed, setMapFailed] = useState(false);
  const webgl = webglSupported && !mapFailed;

  const { status: indexStatus, index, retry: retryIndex } = usePeaksIndex(fetchFn);
  const { progress, persistent, recoveredCorrupt, setStatus, replace } = useProgress();

  const [selectedPeakId, setSelectedPeakId] = useState<string | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [cursorIndex, setCursorIndex] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [tileError, setTileError] = useState(false);
  const [corruptDismissed, setCorruptDismissed] = useState(false);

  const { status: detailStatus, detail, retry: retryDetail } = usePeakDetail(selectedPeakId, fetchFn);

  const peaks = useMemo(() => index?.peaks ?? [], [index]);
  const knownPeakIds = useMemo(() => new Set(peaks.map((p) => p.id)), [peaks]);
  const selectedPeak = peaks.find((p) => p.id === selectedPeakId) ?? null;
  const route = detail?.routes.find((r) => r.id === selectedRouteId) ?? null;

  const cursor = useMemo<[number, number] | null>(() => {
    if (!route || cursorIndex === null) return null;
    // The geometry is simplified and the profile is sampled evenly, so match them by distance.
    const sample = route.profile[cursorIndex];
    const total = route.profile.at(-1)?.[0];
    if (!sample || total === undefined) return null;
    return pointAtDistance(route.geometry.coordinates, sample[0], total);
  }, [route, cursorIndex]);

  // Debounced saving of date/note edits; a status change saves immediately.
  const pendingSave = useRef<{ peakId: string; entry: PeakProgress | null } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressRef = useRef(progress);
  useEffect(() => {
    progressRef.current = progress;
  });

  const flushSave = useCallback(() => {
    if (saveTimer.current !== null) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const pending = pendingSave.current;
    pendingSave.current = null;
    if (pending) setStatus(pending.peakId, pending.entry);
  }, [setStatus]);

  useEffect(() => flushSave, [flushSave]);

  function changeStatus(peakId: string, entry: PeakProgress | null) {
    const statusChanged = (progressRef.current.peaks[peakId]?.status ?? null) !== (entry?.status ?? null);
    pendingSave.current = { peakId, entry };
    if (statusChanged) {
      flushSave();
      return;
    }
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, EDIT_DEBOUNCE_MS);
  }

  function selectPeak(id: string) {
    flushSave();
    setSelectedPeakId(id);
    setSelectedRouteId(null);
    setCursorIndex(null);
    setPanelOpen(true);
  }

  function closeCard() {
    flushSave();
    setSelectedPeakId(null);
    setSelectedRouteId(null);
    setCursorIndex(null);
  }

  function selectRoute(id: string) {
    setSelectedRouteId(id);
    setCursorIndex(null);
  }

  const done = Object.values(progress.peaks).filter((p) => p.status === 'done').length;
  const showCorruptBanner = recoveredCorrupt && !corruptDismissed;

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Korona Gór Polskich</h1>
        {index && <ProgressCounter done={done} total={peaks.length} />}
        <ProgressMenu progress={progress} knownPeakIds={knownPeakIds} onReplace={replace} />
      </header>

      <div className="app__banners">
        {!persistent && <Banner kind="warning">Postęp nie zostanie zapisany w tej przeglądarce</Banner>}
        {showCorruptBanner && (
          <Banner kind="warning" onDismiss={() => setCorruptDismissed(true)}>
            Zapisany postęp był uszkodzony. Zachowaliśmy jego kopię i zaczynamy od nowa.
          </Banner>
        )}
        {webgl && tileError && (
          <Banner kind="info" onDismiss={() => setTileError(false)}>
            Część mapy nie wczytała się
          </Banner>
        )}
        {indexStatus === 'error' && (
          <Banner kind="error" action={{ label: 'Spróbuj ponownie', onClick: retryIndex }}>
            Nie udało się wczytać listy szczytów.
          </Banner>
        )}
      </div>

      <div className="app__body" data-panel={panelOpen ? 'open' : 'closed'}>
        <div className="app__map">
          {webgl ? (
            <div className="app__map-canvas">
              <MapView
                peaks={peaks}
                progress={progress}
                detail={detail}
                selectedRouteId={selectedRouteId}
                cursor={cursor}
                onPeakClick={selectPeak}
                onTileError={() => setTileError(true)}
                onMapError={() => setMapFailed(true)}
              />
            </div>
          ) : (
            <p className="app__no-webgl">Twoja przeglądarka nie obsługuje mapy 3D</p>
          )}
          {webgl && route && (
            <div className="app__profile">
              <ElevationProfile profile={route.profile} onHover={setCursorIndex} />
            </div>
          )}
        </div>

        <aside className="app__panel">
          <button
            type="button"
            className="app__panel-toggle"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((open) => !open)}
          >
            {panelOpen ? 'Ukryj panel' : 'Pokaż panel'}
          </button>
          <div className="app__panel-content">
            {index && (
              <div hidden={selectedPeak !== null}>
                <PeakList peaks={peaks} progress={progress} selectedId={selectedPeakId} onSelect={selectPeak} />
              </div>
            )}
            {selectedPeak && (
              <PeakCard
                peak={selectedPeak}
                detailStatus={detailStatus === 'ready' || detailStatus === 'error' ? detailStatus : 'loading'}
                detail={detail}
                entry={progress.peaks[selectedPeak.id] ?? null}
                selectedRouteId={selectedRouteId}
                onSelectRoute={selectRoute}
                onStatusChange={(entry) => changeStatus(selectedPeak.id, entry)}
                onRetry={retryDetail}
                onClose={closeCard}
              />
            )}
          </div>
        </aside>
      </div>

      <Footer />
    </div>
  );
}
