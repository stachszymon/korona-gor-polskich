import mlcontour from 'maplibre-contour';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { MapLayerMouseEvent, StyleSpecification } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import type { PeakDetail, PeakSummary } from '../data/schema';
import { frameRoute } from './camera';
import { DEM_URL, STYLE_URL } from './config';
import { firstSymbolLayerId, toMountainStyle } from './mountainStyle';
import {
  contourLayers,
  contourSourceSpec,
  overlayLayers,
  overlaySources,
  peaksToGeoJSON,
  routeToGeoJSON,
  trailsForDisplay,
  trailsOpacity,
  type ProgressLike,
} from './overlay';

import 'maplibre-gl/dist/maplibre-gl.css';

export type MapViewProps = {
  peaks: PeakSummary[];
  progress: ProgressLike;
  detail: PeakDetail | null;
  selectedRouteId: string | null;
  /** `[lon, lat]` of the point under the elevation profile cursor. */
  cursor: [number, number] | null;
  onPeakClick(id: string): void;
  onTileError(): void;
};

/** Used when the Liberty style cannot be fetched: terrain, hillshade and our overlays still work. */
const BARE_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef0e6' } }],
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
};

type Position = [number, number];

/** Rough view of southern Poland, so the first tiles are not the whole world. */
const START_CENTER: Position = [19, 50];
const START_ZOOM = 6.5;
/** Camera for a selected route: tilted enough for relief, flat enough to keep the whole route in view. */
const ROUTE_PITCH = 48;
const ROUTE_PADDING = 60;
const ROUTE_EASE_MS = 1200;
const ZOOM_OUT_STEP = 0.1;
const MAX_ZOOM_OUT_STEPS = 30;

let demSource: InstanceType<typeof mlcontour.DemSource> | undefined;

function getDemSource() {
  if (!demSource) {
    demSource = new mlcontour.DemSource({ url: DEM_URL, encoding: 'terrarium', maxzoom: 13, worker: true });
    demSource.setupMaplibre(maplibregl);
  }
  return demSource;
}

async function loadMountainStyle(): Promise<{ style: StyleSpecification; failed: boolean }> {
  try {
    const response = await fetch(STYLE_URL);
    if (!response.ok) throw new Error(`Style request failed: ${response.status}`);
    return { style: toMountainStyle((await response.json()) as StyleSpecification), failed: false };
  } catch {
    return { style: toMountainStyle(BARE_STYLE), failed: true };
  }
}

function boundsOf(positions: readonly (readonly number[])[]): [Position, Position] | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of positions) {
    if (lon === undefined || lat === undefined) continue;
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  return minLon > maxLon
    ? null
    : [
        [minLon, minLat],
        [maxLon, maxLat],
      ];
}

/**
 * `fitBounds` ignores the perspective of a pitched camera, so the near corners can end up outside
 * the viewport. Zoom out in small steps until every corner of `bounds` is visible again.
 */
function keepInView(map: maplibregl.Map, bounds: [Position, Position], padding: number) {
  const { clientWidth: width, clientHeight: height } = map.getContainer();
  const [[west, south], [east, north]] = bounds;
  const corners: Position[] = [[west, south], [west, north], [east, south], [east, north]];
  const visible = () =>
    corners.every((corner) => {
      const { x, y } = map.project(corner);
      return x >= padding && x <= width - padding && y >= padding && y <= height - padding;
    });
  for (let step = 0; step < MAX_ZOOM_OUT_STEPS && !visible(); step++) map.setZoom(map.getZoom() - ZOOM_OUT_STEP);
}

export function MapView({ peaks, progress, detail, selectedRouteId, cursor, onPeakClick, onTileError }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);

  // Latest values for the long-lived map event handlers and the one-off camera moves.
  const latest = useRef({ peaks, onPeakClick, onTileError });
  useEffect(() => {
    latest.current = { peaks, onPeakClick, onTileError };
  });
  const tileErrorReported = useRef(false);
  const initialViewDone = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let map: maplibregl.Map | null = null;

    void loadMountainStyle().then(({ style, failed }) => {
      if (cancelled) return;
      if (failed) reportTileError();

      // The bundler inlines maplibre-gl, so its default worker location (next to the module) does not exist.
      maplibregl.setWorkerUrl(workerUrl);
      map = new maplibregl.Map({ container, style, center: START_CENTER, zoom: START_ZOOM, pitch: 50, maxPitch: 80, canvasContextAttributes: { antialias: true } });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

      map.on('error', (event) => {
        const { sourceId, tile } = event as unknown as { sourceId?: string; tile?: unknown };
        if (sourceId !== undefined || tile !== undefined) reportTileError();
      });
      map.on('click', 'peaks', (event: MapLayerMouseEvent) => {
        const id: unknown = event.features?.[0]?.properties?.['id'];
        if (typeof id === 'string') latest.current.onPeakClick(id);
      });
      map.on('mouseenter', 'peaks', () => {
        if (map) map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'peaks', () => {
        if (map) map.getCanvas().style.cursor = '';
      });
      map.on('load', () => {
        if (!map) return;
        map.addSource('contours', contourSourceSpec(getDemSource()));
        const anchor = firstSymbolLayerId(map.getStyle().layers);
        for (const layer of contourLayers()) map.addLayer(layer, anchor);
        for (const [id, spec] of Object.entries(overlaySources())) map.addSource(id, spec);
        for (const layer of overlayLayers()) map.addLayer(layer);
        setReady(true);
      });
    });

    function reportTileError() {
      if (tileErrorReported.current) return;
      tileErrorReported.current = true;
      latest.current.onTileError();
    }

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('peaks') as maplibregl.GeoJSONSource | undefined)?.setData(peaksToGeoJSON(peaks, progress));
  }, [ready, peaks, progress]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || initialViewDone.current) return;
    const bounds = boundsOf(peaks.map((p) => [p.lon, p.lat]));
    if (!bounds) return;
    initialViewDone.current = true;
    map.fitBounds(bounds, { padding: 40, pitch: 50, duration: 0 });
    keepInView(map, bounds, 40);
  }, [ready, peaks]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const features = detail?.trails.features ?? [];
    (map.getSource('trails') as maplibregl.GeoJSONSource | undefined)?.setData(trailsForDisplay(features));
  }, [ready, detail]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !detail) return;
    const peak = latest.current.peaks.find((p) => p.id === detail.peakId);
    if (peak) map.flyTo({ center: [peak.lon, peak.lat], zoom: 12.5, pitch: 65, duration: 3000 });
  }, [ready, detail]);

  const route = detail?.routes.find((r) => r.id === selectedRouteId) ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('route') as maplibregl.GeoJSONSource | undefined)?.setData(routeToGeoJSON(route));
    map.setPaintProperty('trails', 'line-opacity', trailsOpacity(route !== null));
    if (route) frameRoute(map, route.geometry.coordinates, { padding: ROUTE_PADDING, pitch: ROUTE_PITCH, duration: ROUTE_EASE_MS });
  }, [ready, route]);

  const cursorLon = cursor?.[0];
  const cursorLat = cursor?.[1];
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const position: Position | null = cursorLon !== undefined && cursorLat !== undefined ? [cursorLon, cursorLat] : null;
    (map.getSource('cursor') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: position ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: position }, properties: {} }] : [],
    });
  }, [ready, cursorLon, cursorLat]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} data-testid="map" />;
}
