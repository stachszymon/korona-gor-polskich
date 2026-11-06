import type { MultiPolygon } from 'geojson';
import type { LayerSpecification } from 'maplibre-gl';
import type { PeakSummary, Route, TrailFeature } from '../data/schema';
import mountainAreaFixture from '../test/fixtures/mountain-area.json';
import { outsideMask } from './mask';
import {
  contourLayers,
  contourSourceSpec,
  MASK_SOURCE_ID,
  maskLayers,
  maskSource,
  maskToGeoJSON,
  OVERLAY_SOURCE_IDS,
  overlayLayers,
  overlaySources,
  peaksToGeoJSON,
  routeHoverFilter,
  routesToGeoJSON,
  routeToGeoJSON,
  trailsForDisplay,
  trailsOpacity,
} from './overlay';

const peak = (over: Partial<PeakSummary> = {}): PeakSummary => ({
  id: 'babia-gora',
  name: 'Babia Góra',
  range: 'Beskid Żywiecki',
  elevation: 1725,
  lat: 49.5732,
  lon: 19.5294,
  routeCount: 2,
  ...over,
});

const trail = (colors: TrailFeature['properties']['colors']): TrailFeature => ({
  type: 'Feature',
  properties: { colors, relations: colors.map((color, i) => ({ id: i + 1, color })) },
  geometry: {
    type: 'LineString',
    coordinates: [
      [19.5, 49.5],
      [19.51, 49.51],
    ],
  },
});

describe('peaksToGeoJSON', () => {
  it("maps progress to status and builds label 'Babia Góra\\n1725 m'", () => {
    const peaks = [
      peak(),
      peak({ id: 'rysy', name: 'Rysy', elevation: 2499, lat: 49.1795, lon: 20.0881 }),
      peak({ id: 'sniezka', name: 'Śnieżka', elevation: 1603, lat: 50.736, lon: 15.7397 }),
    ];
    const fc = peaksToGeoJSON(peaks, {
      peaks: { 'babia-gora': { status: 'done' }, rysy: { status: 'planned' } },
    });
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features.map((f) => f.properties)).toEqual([
      { id: 'babia-gora', name: 'Babia Góra', elevation: 1725, label: 'Babia Góra\n1725 m', status: 'done' },
      { id: 'rysy', name: 'Rysy', elevation: 2499, label: 'Rysy\n2499 m', status: 'planned' },
      { id: 'sniezka', name: 'Śnieżka', elevation: 1603, label: 'Śnieżka\n1603 m', status: 'todo' },
    ]);
    expect(fc.features[0]?.geometry).toEqual({ type: 'Point', coordinates: [19.5294, 49.5732] });
  });
});

describe('trailsForDisplay', () => {
  it('splits a red+yellow segment into two features with offsets -1.5 and 1.5', () => {
    const fc = trailsForDisplay([trail(['red', 'yellow'])]);
    expect(fc.features).toHaveLength(2);
    expect(fc.features.map((f) => f.properties)).toEqual([
      { color: '#d32f2f', offset: -1.5 },
      { color: '#f9a825', offset: 1.5 },
    ]);
    expect(fc.features[0]?.geometry).toEqual(fc.features[1]?.geometry);
  });

  it('keeps a single-colour segment centred and spreads three colours by 3 px', () => {
    expect(trailsForDisplay([trail(['blue'])]).features.map((f) => f.properties.offset)).toEqual([0]);
    expect(trailsForDisplay([trail(['red', 'green', 'black'])]).features.map((f) => f.properties.offset)).toEqual([-3, 0, 3]);
  });

  it('ignores repeated colours on one segment', () => {
    expect(trailsForDisplay([trail(['red', 'red'])]).features).toHaveLength(1);
  });
});

describe('routeToGeoJSON', () => {
  it('returns an empty collection for null', () => {
    expect(routeToGeoJSON(null)).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('wraps the route geometry in a single feature', () => {
    const route = {
      id: 'a--b',
      name: 'Test',
      geometry: {
        type: 'LineString',
        coordinates: [
          [19.5, 49.5, 800],
          [19.51, 49.51, 900],
        ],
      },
    } as Route;
    const fc = routeToGeoJSON(route);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]?.geometry).toEqual(route.geometry);
    expect(fc.features[0]?.properties).toEqual({ id: 'a--b' });
  });
});

describe('routesToGeoJSON', () => {
  const route = (id: string, x: number) =>
    ({
      id,
      geometry: {
        type: 'LineString',
        coordinates: [
          [x, 49, 800],
          [x + 0.1, 49.1, 900],
        ],
      },
    }) as Route;

  it('is empty without routes', () => {
    expect(routesToGeoJSON([])).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('gives one feature per route, carrying only its id', () => {
    const routes = [route('a--1', 19), route('a--2', 20)];
    const fc = routesToGeoJSON(routes);
    expect(fc.features).toHaveLength(2);
    expect(fc.features.map((f) => f.properties)).toEqual([{ id: 'a--1' }, { id: 'a--2' }]);
    expect(fc.features.map((f) => f.geometry)).toEqual(routes.map((r) => r.geometry));
  });
});

describe('overlayLayers', () => {
  it('draws every route thin and purple under the trails, and the hovered one thick on top of them', () => {
    const byId = Object.fromEntries(overlayLayers().map((l) => [l.id, l]));
    expect(byId['routes-all']).toMatchObject({
      type: 'line',
      source: 'routes',
      paint: { 'line-color': '#6a1b9a', 'line-width': 2, 'line-opacity': 0.55 },
    });
    expect(byId['routes-hover']).toMatchObject({
      type: 'line',
      source: 'routes',
      filter: ['==', ['get', 'id'], ''],
      paint: { 'line-color': '#6a1b9a', 'line-width': 4, 'line-opacity': 1 },
    });
  });

  it('routeHoverFilter matches one route id', () => {
    expect(routeHoverFilter('a--1')).toEqual(['==', ['get', 'id'], 'a--1']);
    expect(routeHoverFilter(null)).toEqual(['==', ['get', 'id'], '']);
  });

  it('overlayLayers ids are in the documented order', () => {
    const layers = overlayLayers();
    expect(layers.map((l) => l.id)).toEqual([
      'routes-all',
      'trails',
      'routes-hover',
      'route-selected-casing',
      'route-selected',
      'peaks',
      'peak-labels',
      'profile-cursor',
    ]);
    expect(OVERLAY_SOURCE_IDS).toEqual(['trails', 'routes', 'route', 'peaks', 'cursor']);
    expect(Object.keys(overlaySources())).toEqual(['trails', 'routes', 'route', 'peaks', 'cursor']);
  });

  it('every layer references a declared overlay source', () => {
    const sources = Object.keys(overlaySources());
    for (const l of overlayLayers()) {
      expect(sources, l.id).toContain((l as Extract<LayerSpecification, { source: string }>).source);
    }
  });

  it('draws trails with per-feature colour and offset, and peaks by status', () => {
    const byId = Object.fromEntries(overlayLayers().map((l) => [l.id, l]));
    expect(byId['trails']?.paint).toMatchObject({
      'line-color': ['get', 'color'],
      'line-offset': ['get', 'offset'],
    });
    expect(JSON.stringify(byId['peaks']?.paint)).toContain('#2e7d32');
    expect(JSON.stringify(byId['peaks']?.paint)).toContain('#f9a825');
    expect(JSON.stringify(byId['peaks']?.paint)).toContain('#c62828');
  });

  it('keeps overview peak labels legible: no overlap, higher peaks first, elevation only when zoomed in', () => {
    const labels = overlayLayers().find((l) => l.id === 'peak-labels');
    expect(labels?.type).toBe('symbol');
    expect(labels?.layout).toMatchObject({
      'text-field': ['step', ['zoom'], ['get', 'name'], 9, ['get', 'label']],
      'text-allow-overlap': false,
      'text-optional': true,
      'symbol-sort-key': ['-', ['get', 'elevation']],
      'text-variable-anchor': ['bottom', 'top', 'left', 'right'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 10, 15],
    });
    expect(labels?.layout).toHaveProperty('text-radial-offset');
    expect(labels?.layout).not.toHaveProperty('text-offset');
  });
});

describe('trailsOpacity', () => {
  it('dims trails to 0.35 only while a route is selected', () => {
    expect(trailsOpacity(true)).toBe(0.35);
    expect(trailsOpacity(false)).toBe(1);
  });
});

describe('contours', () => {
  it('builds a vector source from the DemSource contour protocol URL', () => {
    const contourProtocolUrl = vi.fn(() => 'contour://{z}/{x}/{y}?x=1');
    const spec = contourSourceSpec({ contourProtocolUrl });
    expect(spec).toEqual({ type: 'vector', maxzoom: 15, tiles: ['contour://{z}/{x}/{y}?x=1'] });
    expect(contourProtocolUrl).toHaveBeenCalledWith({
      multiplier: 1,
      thresholds: { 11: [200, 1000], 12: [100, 500], 13: [50, 250], 14: [20, 100] },
      elevationKey: 'ele',
      levelKey: 'level',
      contourLayer: 'contours',
    });
  });

  it('defines contour lines and elevation labels on the contours layer', () => {
    const layers = contourLayers();
    expect(layers.map((l) => l.id)).toEqual(['contour-lines', 'contour-labels']);
    expect(layers.every((l) => 'source-layer' in l && l['source-layer'] === 'contours')).toBe(true);
    expect(layers[1]?.layout).toMatchObject({ 'text-field': ['concat', ['get', 'ele'], ' m'] });
  });
});

describe('mountain mask', () => {
  const areas = mountainAreaFixture.areas as MultiPolygon;

  it('puts the outside mask and the areas in one collection, told apart by `kind`', () => {
    const fc = maskToGeoJSON(areas);
    expect(fc.features.map((f) => f.properties)).toEqual([{ kind: 'outside' }, { kind: 'area' }, { kind: 'area' }]);
    expect(fc.features[0]?.geometry).toEqual(outsideMask(areas));
    expect(fc.features.slice(1).map((f) => f.geometry)).toEqual(areas.coordinates.map((coordinates) => ({ type: 'Polygon', coordinates })));
  });

  it('starts as an empty geojson source', () => {
    expect(MASK_SOURCE_ID).toBe('mountain-mask');
    expect(maskSource()).toEqual({ type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  });

  it('dims the outside with a fill and outlines the areas', () => {
    const layers = maskLayers();
    expect(layers.map((l) => l.id)).toEqual(['mountain-mask-fill', 'mountain-mask-outline']);
    const [fill, outline] = layers as [LayerSpecification, LayerSpecification];
    expect(fill).toMatchObject({
      type: 'fill',
      source: 'mountain-mask',
      filter: ['==', ['get', 'kind'], 'outside'],
      paint: { 'fill-color': '#f4f1ea', 'fill-opacity': 0.72 },
    });
    expect(outline).toMatchObject({
      type: 'line',
      source: 'mountain-mask',
      filter: ['==', ['get', 'kind'], 'area'],
      paint: { 'line-color': '#8a7a5a', 'line-width': 1.2, 'line-opacity': 0.55 },
    });
  });
});
