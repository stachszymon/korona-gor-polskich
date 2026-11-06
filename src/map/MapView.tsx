import mlcontour from 'maplibre-contour';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { MapLayerMouseEvent, MapMouseEvent, MapTouchEvent, StyleSpecification } from 'maplibre-gl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MountainArea, PeakDetail, PeakSummary, Route } from '../data/schema';
import { formatDistance, formatDuration } from '../ui/format';
import { coverBounds, frameRoute, MAX_PITCH, maxPitchForZoom, minZoomForBounds, padBounds } from './camera';
import { DEM_URL, STYLE_URL } from './config';
import { labelRestrictions } from './labels';
import { firstSymbolLayerId, toMountainStyle } from './mountainStyle';
import {
  contourLayers,
  contourSourceSpec,
  MASK_SOURCE_ID,
  maskLayers,
  maskSource,
  maskToGeoJSON,
  overlayLayers,
  overlaySources,
  peaksToGeoJSON,
  relationIdsOf,
  relationKeyOf,
  relationsAt,
  routeHoverFilter,
  routesToGeoJSON,
  routeToGeoJSON,
  trailHighlightFilter,
  trailsForDisplay,
  trailsOpacity,
  type ProgressLike,
} from './overlay';
import { trailPopupContent } from './trailPopup';

import 'maplibre-gl/dist/maplibre-gl.css';

export type MapViewProps = {
  peaks: PeakSummary[];
  /** The mountains: masks everything else and bounds the camera. `null` when it could not be loaded (no mask, no bounds). */
  area: MountainArea | null;
  progress: ProgressLike;
  detail: PeakDetail | null;
  selectedRouteId: string | null;
  /** The route whose row is hovered in the list: highlighted on the map. */
  hoveredRouteId: string | null;
  /** `[lon, lat]` of the point under the elevation profile cursor. */
  cursor: [number, number] | null;
  onPeakClick(id: string): void;
  /** A route was clicked (or tapped) on the map. */
  onRouteSelect(id: string): void;
  onTileError(): void;
  /** The map could not be created (e.g. the WebGL context failed despite the probe). */
  onMapError(): void;
};

/** Used when the Liberty style cannot be fetched: terrain, hillshade and our overlays still work. */
const BARE_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef0e6' } }],
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
};

type Position = [number, number];

/** Routes are thin lines: look this many pixels around the pointer (more for a finger) for one. */
const ROUTE_HIT_PX = 6;
const ROUTE_TOUCH_HIT_PX = 14;
/** Trails are drawn a few pixels wide and side by side (3 px apart) where several share a segment. */
const TRAIL_HIT_PX = 4;
const TRAIL_TOUCH_HIT_PX = 12;

/** A tap reaches maplibre as a `click` whose pointer event says `touch`; Safari sends a plain mouse event, so ask the device. */
function isTouch(event: Event | undefined): boolean {
  const type = (event as PointerEvent | undefined)?.pointerType;
  if (type) return type === 'touch';
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

/**
 * What is under the pointer: whether a peak is (it wins over routes, which end at peaks), the route, if any,
 * and, only when neither is there, the OSM relations of the marked trail (every relation of the segment).
 * Several routes can overlap; prefer the selected one, then the one already hovered, then the first found.
 */
function targetAt(
  map: maplibregl.Map,
  event: MapMouseEvent | MapTouchEvent,
  preferred: readonly (string | null | undefined)[],
): { peak: boolean; routeId: string | null; trailIds: number[] } {
  if (map.queryRenderedFeatures(event.point, { layers: ['peaks'] }).length > 0) return { peak: true, routeId: null, trailIds: [] };
  const touch = isTouch(event.originalEvent);
  const { x, y } = event.point;
  const around = (r: number): [[number, number], [number, number]] => [
    [x - r, y - r],
    [x + r, y + r],
  ];
  const hits = map.queryRenderedFeatures(around(touch ? ROUTE_TOUCH_HIT_PX : ROUTE_HIT_PX), { layers: ['routes-all'] });
  const ids = hits.map((hit) => hit.properties?.['id']).filter((id): id is string => typeof id === 'string');
  const routeId = preferred.find((id) => id != null && ids.includes(id)) ?? ids[0] ?? null;
  if (routeId !== null) return { peak: false, routeId, trailIds: [] };
  const trailHits = map.queryRenderedFeatures(around(touch ? TRAIL_TOUCH_HIT_PX : TRAIL_HIT_PX), { layers: ['trails'] });
  const trailIds = trailHits.flatMap((hit) => {
    const key: unknown = hit.properties?.['relationKey'];
    return typeof key === 'string' ? relationIdsOf(key) : [];
  });
  return { peak: false, routeId: null, trailIds: [...new Set(trailIds)] };
}

function routeTooltip(route: Route): string {
  return `${route.name} · ${formatDistance(route.distanceKm)} na szczyt · ${formatDuration(route.durationMin)}`;
}

/** Rough view of southern Poland, so the first tiles are not the whole world. */
const START_CENTER: Position = [19, 50];
const START_ZOOM = 6.5;
/** Camera for a selected route: tilted enough for relief, flat enough to keep the whole route in view. */
const ROUTE_PITCH = 48;
const ROUTE_PADDING = 60;
const ROUTE_EASE_MS = 1200;
/** Share of the area's span added on each side of the camera limits, so the edge of the area is not hard against the screen edge. */
const BOUNDS_PADDING = 0.08;
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

export function MapView({
  peaks,
  area,
  progress,
  detail,
  selectedRouteId,
  hoveredRouteId,
  cursor,
  onPeakClick,
  onRouteSelect,
  onTileError,
  onMapError,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);

  // Latest values for the long-lived map event handlers and the one-off camera moves.
  const routes = detail?.routes;
  const trails = detail?.trails.features;
  const latest = useRef({ peaks, routes, trails, selectedRouteId, hoveredRouteId, onPeakClick, onRouteSelect, onTileError, onMapError });
  useEffect(() => {
    latest.current = { peaks, routes, trails, selectedRouteId, hoveredRouteId, onPeakClick, onRouteSelect, onTileError, onMapError };
  });
  /** The route under the mouse pointer; it wins over the one hovered in the list. */
  const mapHoveredRoute = useRef<string | null>(null);
  const clearMapHover = useRef<() => void>(() => {});
  const closeTrailPopup = useRef<() => void>(() => {});
  const appliedHover = useRef<string | null>(null);
  /** Points the `routes-hover` layer at the hovered route; a pointer on the map wins over a hovered list row. */
  const syncRouteHover = useCallback((map: maplibregl.Map) => {
    const id = mapHoveredRoute.current ?? latest.current.hoveredRouteId;
    if (id === appliedHover.current) return;
    appliedHover.current = id;
    map.setFilter('routes-hover', routeHoverFilter(id));
  }, []);
  const tileErrorReported = useRef(false);
  const initialViewDone = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let map: maplibregl.Map | null = null;
    let loaded = false;
    let tooltip: maplibregl.Popup | null = null;
    let trailPopup: maplibregl.Popup | null = null;
    let appliedHighlight = '';

    void loadMountainStyle().then(({ style, failed }) => {
      if (cancelled) return;
      if (failed) reportTileError();

      try {
        // The bundler inlines maplibre-gl, so its default worker location (next to the module) does not exist.
        maplibregl.setWorkerUrl(workerUrl);
        map = new maplibregl.Map({ container, style, center: START_CENTER, zoom: START_ZOOM, pitch: 0, maxPitch: MAX_PITCH, canvasContextAttributes: { antialias: true } });
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
        const hoverMap = map;
        tooltip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'route-tooltip', offset: 12 });
        /** Highlights these OSM relations along their whole length (on the casing and the coloured line). */
        const setHighlight = (ids: readonly number[]) => {
          if (!loaded) return;
          const key = relationKeyOf(ids);
          if (key === appliedHighlight) return;
          appliedHighlight = key;
          const filter = trailHighlightFilter(ids);
          hoverMap.setFilter('trails-highlight-casing', filter);
          hoverMap.setFilter('trails-highlight', filter);
        };
        const clearRouteHover = () => {
          mapHoveredRoute.current = null;
          tooltip?.remove();
          if (loaded) syncRouteHover(hoverMap);
        };
        const clearHover = () => {
          clearRouteHover();
          setHighlight([]);
          hoverMap.getCanvas().style.cursor = '';
        };
        clearMapHover.current = clearHover;
        closeTrailPopup.current = () => {
          trailPopup?.remove();
          trailPopup = null;
        };
        // The one place that decides the cursor and the hover state: a peak, a route or a marked trail under the
        // pointer gives `pointer`, anything else clears it. Priority: peak > route > trail (a trail is only
        // looked up when neither is under the pointer).
        const mapPreferences = () => [latest.current.selectedRouteId, mapHoveredRoute.current, latest.current.hoveredRouteId];
        map.on('mousemove', (event: MapMouseEvent) => {
          if (!loaded || hoverMap.isMoving()) return;
          const { peak, routeId, trailIds } = targetAt(hoverMap, event, mapPreferences());
          const route = routeId === null ? undefined : latest.current.routes?.find((r) => r.id === routeId);
          if (!route) {
            clearRouteHover();
            setHighlight(trailIds);
            hoverMap.getCanvas().style.cursor = peak || trailIds.length > 0 ? 'pointer' : '';
            return;
          }
          setHighlight([]);
          mapHoveredRoute.current = route.id;
          hoverMap.getCanvas().style.cursor = 'pointer';
          syncRouteHover(hoverMap);
          tooltip?.setLngLat(event.lngLat).setText(routeTooltip(route));
          if (tooltip && !tooltip.isOpen()) tooltip.addTo(hoverMap);
        });
        map.on('mouseout', clearHover);
        // The camera moved (a click framed the route, a drag started): the route is no longer under the pointer.
        map.on('movestart', clearHover);
        map.on('click', (event: MapMouseEvent) => {
          if (!loaded) return;
          closeTrailPopup.current();
          const { peak, routeId, trailIds } = targetAt(hoverMap, event, mapPreferences());
          if (routeId !== null) latest.current.onRouteSelect(routeId);
          // A tap sets the highlight too (there is no hover on a touch screen) and keeps it until the next tap.
          setHighlight(trailIds);
          if (peak || routeId !== null || trailIds.length === 0) return;
          const relations = relationsAt(relationKeyOf(trailIds), latest.current.trails ?? []);
          if (relations.length === 0) return;
          trailPopup = new maplibregl.Popup({ closeButton: true, className: 'trail-popup', maxWidth: '280px', offset: 8 })
            .setLngLat(event.lngLat)
            .setDOMContent(trailPopupContent(relations))
            .addTo(hoverMap);
        });
        map.on('load', () => {
          if (!map) return;
          loaded = true;
          map.addSource('contours', contourSourceSpec(getDemSource()));
          const anchor = firstSymbolLayerId(map.getStyle().layers);
          for (const layer of contourLayers()) map.addLayer(layer, anchor);
          map.addSource(MASK_SOURCE_ID, maskSource());
          for (const layer of maskLayers()) map.addLayer(layer);
          for (const [id, spec] of Object.entries(overlaySources())) map.addSource(id, spec);
          for (const layer of overlayLayers()) map.addLayer(layer);
          setReady(true);
        });
      } catch {
        // Map construction can still fail after the WebGL probe (context limits, driver issues).
        try {
          map?.remove();
        } catch {
          // The half-built map is discarded either way.
        }
        map = null;
        mapRef.current = null;
        latest.current.onMapError();
      }
    });

    function reportTileError() {
      if (tileErrorReported.current) return;
      tileErrorReported.current = true;
      latest.current.onTileError();
    }

    return () => {
      cancelled = true;
      tooltip?.remove();
      trailPopup?.remove();
      clearMapHover.current = () => {};
      closeTrailPopup.current = () => {};
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [syncRouteHover]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('peaks') as maplibregl.GeoJSONSource | undefined)?.setData(peaksToGeoJSON(peaks, progress));
  }, [ready, peaks, progress]);

  // The mask and the label restrictions come from the area file; progress and selection do not touch them.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !area) return;
    (map.getSource(MASK_SOURCE_ID) as maplibregl.GeoJSONSource | undefined)?.setData(maskToGeoJSON(area.areas));
    const { hidden, filters } = labelRestrictions(map.getStyle().layers, area.areas);
    for (const id of hidden) map.setLayoutProperty(id, 'visibility', 'none');
    for (const [id, filter] of Object.entries(filters)) map.setFilter(id, filter);
  }, [ready, area]);

  // The camera stays inside the area: panning stops at its bounds and zooming out stops when they fill the
  // map container (which changes with the window size and the side panel, hence the `resize` listener).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !area) return;
    const padded = padBounds(area.bounds, BOUNDS_PADDING);
    // Close to minZoom the camera stays almost top-down: a tilted view of this wide area would clip its corners.
    let pitchLimit: number | null = null;
    const limitPitch = () => {
      const limit = maxPitchForZoom(map.getZoom(), map.getMinZoom());
      if (limit === pitchLimit) return;
      pitchLimit = limit;
      map.setMaxPitch(limit);
    };
    const fitMinZoom = () => {
      const { clientWidth, clientHeight } = map.getContainer();
      // MapLibre never shows anything outside the limits, so for a window of another shape it would zoom in and crop
      // the area. Limits of the window's shape let `minZoom` show the whole area.
      const limits = coverBounds(padded, clientWidth, clientHeight);
      map.setMaxBounds(limits);
      map.setMinZoom(minZoomForBounds(limits, clientWidth, clientHeight));
      limitPitch();
    };
    fitMinZoom();
    map.on('resize', fitMinZoom);
    map.on('zoom', limitPitch);
    return () => {
      map.off('resize', fitMinZoom);
      map.off('zoom', limitPitch);
    };
  }, [ready, area]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || initialViewDone.current) return;
    const bounds = boundsOf(peaks.map((p) => [p.lon, p.lat]));
    if (!bounds) return;
    initialViewDone.current = true;
    map.fitBounds(bounds, { padding: 40, pitch: 0, duration: 0 });
    keepInView(map, bounds, 40);
  }, [ready, peaks]);

  // The list hover shows on the map, unless the pointer is on a route of its own.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    syncRouteHover(map);
  }, [ready, hoveredRouteId, syncRouteHover]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    clearMapHover.current();
    (map.getSource('routes') as maplibregl.GeoJSONSource | undefined)?.setData(routesToGeoJSON(routes ?? []));
  }, [ready, routes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const features = detail?.trails.features ?? [];
    closeTrailPopup.current();
    clearMapHover.current();
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
