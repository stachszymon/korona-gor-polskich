import type { LayerSpecification } from 'maplibre-gl';
import type { PeakSummary, Route, TrailFeature } from '../data/schema';
import {
  contourLayers,
  contourSourceSpec,
  OVERLAY_SOURCE_IDS,
  overlayLayers,
  overlaySources,
  peaksToGeoJSON,
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
  properties: { colors },
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
      { id: 'babia-gora', label: 'Babia Góra\n1725 m', status: 'done' },
      { id: 'rysy', label: 'Rysy\n2499 m', status: 'planned' },
      { id: 'sniezka', label: 'Śnieżka\n1603 m', status: 'todo' },
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

describe('overlayLayers', () => {
  it('overlayLayers ids are in the documented order', () => {
    const layers = overlayLayers();
    expect(layers.map((l) => l.id)).toEqual([
      'trails',
      'route-selected-casing',
      'route-selected',
      'peaks',
      'peak-labels',
      'profile-cursor',
    ]);
    expect(OVERLAY_SOURCE_IDS).toEqual(['trails', 'route', 'peaks', 'cursor']);
    expect(Object.keys(overlaySources())).toEqual(['trails', 'route', 'peaks', 'cursor']);
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
    expect(byId['peak-labels']?.layout).toMatchObject({ 'text-field': ['get', 'label'] });
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
