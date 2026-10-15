import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type mlcontour from 'maplibre-contour';
import type { GeoJSONSourceSpecification, LayerSpecification, SourceSpecification } from 'maplibre-gl';
import type { PeakSummary, Route, TrailFeature } from '../data/schema';
import { CONTOUR_THRESHOLDS, PTTK_HEX, STATUS_HEX } from './config';

/** The part of the app's `Progress` the map needs; the real `Progress` is structurally compatible. */
export type ProgressLike = { peaks: Record<string, { status: 'done' | 'planned' }> };

export type PeakStatus = 'done' | 'planned' | 'todo';
export type PeakProperties = { id: string; label: string; status: PeakStatus };
export type TrailProperties = { color: string; offset: number };
export type RouteProperties = { id: string };

type DemSource = InstanceType<typeof mlcontour.DemSource>;

/** Pixels between neighbouring parallel trail lines drawn on one segment. */
const TRAIL_LINE_SPACING = 3;

export function peaksToGeoJSON(peaks: PeakSummary[], progress: ProgressLike): FeatureCollection<Point, PeakProperties> {
  return {
    type: 'FeatureCollection',
    features: peaks.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: {
        id: p.id,
        label: `${p.name}\n${p.elevation} m`,
        status: progress.peaks[p.id]?.status ?? 'todo',
      },
    })),
  };
}

/** One feature per colour of every segment, so a multi-trail segment becomes parallel offset lines. */
export function trailsForDisplay(trails: TrailFeature[]): FeatureCollection<LineString, TrailProperties> {
  const features: Feature<LineString, TrailProperties>[] = [];
  for (const trail of trails) {
    const colors = [...new Set(trail.properties.colors)];
    colors.forEach((color, index) => {
      features.push({
        type: 'Feature',
        geometry: trail.geometry,
        properties: { color: PTTK_HEX[color], offset: (index - (colors.length - 1) / 2) * TRAIL_LINE_SPACING },
      });
    });
  }
  return { type: 'FeatureCollection', features };
}

export function routeToGeoJSON(route: Route | null): FeatureCollection<LineString, RouteProperties> {
  if (!route) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: route.geometry, properties: { id: route.id } }],
  };
}

export const OVERLAY_SOURCE_IDS = ['trails', 'route', 'peaks', 'cursor'] as const;

/** Empty GeoJSON sources for the overlay layers; the map fills them with `setData`. */
export function overlaySources(): Record<(typeof OVERLAY_SOURCE_IDS)[number], GeoJSONSourceSpecification> {
  const empty = (): GeoJSONSourceSpecification => ({
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  return { trails: empty(), route: empty(), peaks: empty(), cursor: empty() };
}

export const ROUTE_HEX = '#6a1b9a';

export function overlayLayers(): LayerSpecification[] {
  return [
    {
      id: 'trails',
      type: 'line',
      source: 'trails',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 14, 3, 17, 5],
        'line-offset': ['get', 'offset'],
        'line-opacity': trailsOpacity(false),
      },
    },
    {
      id: 'route-selected-casing',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 9, 17, 12] },
    },
    {
      id: 'route-selected',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ROUTE_HEX, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 14, 5, 17, 7] },
    },
    {
      id: 'peaks',
      type: 'circle',
      source: 'peaks',
      paint: {
        'circle-radius': 8,
        'circle-color': ['match', ['get', 'status'], 'done', STATUS_HEX.done, 'planned', STATUS_HEX.planned, STATUS_HEX.todo],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
      },
    },
    {
      id: 'peak-labels',
      type: 'symbol',
      source: 'peaks',
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 15,
        'text-offset': [0, -2.2],
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#33261a', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
    },
    {
      id: 'profile-cursor',
      type: 'circle',
      source: 'cursor',
      paint: {
        'circle-radius': 7,
        'circle-color': '#ffffff',
        'circle-stroke-color': ROUTE_HEX,
        'circle-stroke-width': 3,
      },
    },
  ];
}

/** Opacity of the `trails` layer: dimmed while a route is highlighted. */
export function trailsOpacity(hasSelectedRoute: boolean): number {
  return hasSelectedRoute ? 0.35 : 1;
}

export function contourSourceSpec(demSource: Pick<DemSource, 'contourProtocolUrl'>): SourceSpecification {
  return {
    type: 'vector',
    maxzoom: 15,
    tiles: [
      demSource.contourProtocolUrl({
        multiplier: 1,
        thresholds: CONTOUR_THRESHOLDS,
        elevationKey: 'ele',
        levelKey: 'level',
        contourLayer: 'contours',
      }),
    ],
  };
}

/** Contour lines and elevation labels. The source is named `contours` (see `contourSourceSpec`). */
export function contourLayers(): LayerSpecification[] {
  return [
    {
      id: 'contour-lines',
      type: 'line',
      source: 'contours',
      'source-layer': 'contours',
      paint: {
        'line-color': 'rgba(120, 80, 40, 0.45)',
        'line-width': ['match', ['get', 'level'], 1, 1.2, 0.5],
      },
    },
    {
      id: 'contour-labels',
      type: 'symbol',
      source: 'contours',
      'source-layer': 'contours',
      filter: ['>', ['get', 'level'], 0],
      layout: {
        'symbol-placement': 'line',
        'text-size': 10,
        'text-field': ['concat', ['get', 'ele'], ' m'],
        'text-font': ['Noto Sans Regular'],
      },
      paint: { 'text-color': '#7a5230', 'text-halo-color': '#ffffff', 'text-halo-width': 1 },
    },
  ];
}
