import { act, render, waitFor } from '@testing-library/react';
import type { StyleSpecification } from 'maplibre-gl';
import type { PeakDetail, PeakSummary, Route } from '../data/schema';
import { MapView } from './MapView';
import { OVERLAY_SOURCE_IDS } from './overlay';

type Handler = (event: Record<string, unknown>) => void;

const h = vi.hoisted(() => {
  class FakeMap {
    static instances: FakeMap[] = [];
    options: Record<string, unknown>;
    sources: Record<string, unknown> = {};
    layers: { spec: { id: string }; beforeId?: string }[] = [];
    handlers: { type: string; layer?: string; fn: Handler }[] = [];
    data: Record<string, unknown> = {};
    paint: Record<string, unknown> = {};
    removed = false;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      FakeMap.instances.push(this);
    }
    on(type: string, a: string | Handler, b?: Handler) {
      this.handlers.push(typeof a === 'string' ? { type, layer: a, fn: b as Handler } : { type, fn: a });
      return this;
    }
    emit(type: string, event: Record<string, unknown> = {}, layer?: string) {
      for (const hd of this.handlers) if (hd.type === type && hd.layer === layer) hd.fn(event);
    }
    addControl = vi.fn();
    addSource(id: string, spec: unknown) {
      this.sources[id] = spec;
    }
    getSource(id: string) {
      return id in this.sources ? { setData: (d: unknown) => (this.data[id] = d) } : undefined;
    }
    addLayer(spec: { id: string }, beforeId?: string) {
      this.layers.push({ spec, beforeId });
    }
    getStyle() {
      return {
        layers: [
          { id: 'water', type: 'fill' },
          { id: 'place', type: 'symbol' },
        ],
      };
    }
    getCanvas() {
      return { style: {} as Record<string, string> };
    }
    setPaintProperty(layer: string, prop: string, value: unknown) {
      this.paint[`${layer}.${prop}`] = value;
    }
    zoom = 5;
    getZoom() {
      return this.zoom;
    }
    setZoom(z: number) {
      this.zoom = z;
    }
    getContainer() {
      return { clientWidth: 800, clientHeight: 600 };
    }
    /** Corners land outside the 800x600 viewport until zoomed out below 4.5. */
    project() {
      return { x: this.zoom > 4.5 ? 900 : 100, y: 100 };
    }
    fitBounds = vi.fn();
    flyTo = vi.fn();
    remove() {
      this.removed = true;
    }
  }
  return { FakeMap, addProtocol: vi.fn(), setupMaplibre: vi.fn(), setWorkerUrl: vi.fn() };
});

vi.mock('maplibre-gl', () => ({
  Map: h.FakeMap,
  NavigationControl: class {},
  addProtocol: h.addProtocol,
  setWorkerUrl: h.setWorkerUrl,
}));
vi.mock('maplibre-contour', () => ({
  default: {
    DemSource: class {
      contourProtocolUrl = () => 'contour://{z}/{x}/{y}';
      setupMaplibre = h.setupMaplibre;
    },
  },
}));

const STYLE: StyleSpecification = {
  version: 8,
  sources: { openmaptiles: { type: 'vector', url: 'https://example.test/tiles.json' } },
  layers: [
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
    { id: 'place', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place' },
  ],
};

const peaks: PeakSummary[] = [
  { id: 'babia-gora', name: 'Babia Góra', range: 'Beskid Żywiecki', elevation: 1725, lat: 49.5732, lon: 19.5294, routeCount: 1 },
  { id: 'rysy', name: 'Rysy', range: 'Tatry', elevation: 2499, lat: 49.1795, lon: 20.088, routeCount: 0 },
];

const route: Route = {
  id: 'babia-gora--zawoja',
  name: 'Z Zawoi',
  trailhead: { name: 'Zawoja', lat: 49.6, lon: 19.5, kind: 'parking' },
  distanceKm: 10,
  ascentM: 900,
  descentM: 900,
  durationMin: 300,
  colors: ['red'],
  geometry: {
    type: 'LineString',
    coordinates: [
      [19.5, 49.6, 700],
      [19.52, 49.58, 1200],
      [19.5294, 49.5732, 1725],
    ],
  },
  profile: [
    [0, 700],
    [10000, 1725],
  ],
};

const detail: PeakDetail = {
  peakId: 'babia-gora',
  trails: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { colors: ['red', 'blue'] },
        geometry: {
          type: 'LineString',
          coordinates: [
            [19.5, 49.6],
            [19.52, 49.58],
          ],
        },
      },
    ],
  },
  routes: [route],
};

type Props = Parameters<typeof MapView>[0];
const baseProps = (over: Partial<Props> = {}): Props => ({
  peaks,
  progress: { peaks: { rysy: { status: 'done' } } },
  detail: null,
  selectedRouteId: null,
  cursor: null,
  onPeakClick: vi.fn(),
  onTileError: vi.fn(),
  ...over,
});

const currentMap = () => h.FakeMap.instances[h.FakeMap.instances.length - 1]!;

async function renderLoaded(props: Props) {
  const view = render(<MapView {...props} />);
  await waitFor(() => expect(h.FakeMap.instances).toHaveLength(1));
  act(() => currentMap().emit('load'));
  return { ...view, map: currentMap() };
}

beforeEach(() => {
  h.FakeMap.instances.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => STYLE })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('MapView', () => {
  it('creates map with mountain style and adds overlay layers on load', async () => {
    const { map } = await renderLoaded(baseProps());

    const style = map.options.style as StyleSpecification;
    expect(style.terrain).toEqual({ source: 'dem', exaggeration: 1.3 });
    expect(style.layers.some((l) => l.id === 'hillshade')).toBe(true);
    expect(map.options.pitch).toBe(50);
    expect(h.setupMaplibre).toHaveBeenCalledOnce();
    expect(h.setWorkerUrl).toHaveBeenCalledWith(expect.stringContaining('maplibre-gl-worker'));

    expect(map.sources['contours']).toMatchObject({ type: 'vector', tiles: ['contour://{z}/{x}/{y}'] });
    for (const id of OVERLAY_SOURCE_IDS) expect(map.sources[id]).toMatchObject({ type: 'geojson' });

    const ids = map.layers.map((l) => l.spec.id);
    expect(ids).toEqual([
      'contour-lines',
      'contour-labels',
      'trails',
      'route-selected-casing',
      'route-selected',
      'peaks',
      'peak-labels',
      'profile-cursor',
    ]);
    expect(map.layers.filter((l) => l.spec.id.startsWith('contour')).map((l) => l.beforeId)).toEqual(['place', 'place']);
    expect(map.layers.find((l) => l.spec.id === 'peaks')?.beforeId).toBeUndefined();

    const peaksData = map.data['peaks'] as { features: { properties: { id: string; status: string } }[] };
    expect(peaksData.features.map((f) => [f.properties.id, f.properties.status])).toEqual([
      ['babia-gora', 'todo'],
      ['rysy', 'done'],
    ]);
    expect(map.fitBounds).toHaveBeenCalledWith(
      [
        [19.5294, 49.1795],
        [20.088, 49.5732],
      ],
      expect.objectContaining({ pitch: 50, duration: 0 }),
    );
  });

  it('zooms out after fitting when the pitched view still clips the bounds', async () => {
    const { map } = await renderLoaded(baseProps());
    expect(map.zoom).toBeLessThanOrEqual(4.5);
    expect(map.zoom).toBeGreaterThan(4.3);
  });

  it('flies to the peak when detail changes', async () => {
    const { map, rerender } = await renderLoaded(baseProps());
    rerender(<MapView {...baseProps({ detail })} />);

    expect(map.flyTo).toHaveBeenCalledWith({ center: [19.5294, 49.5732], zoom: 12.5, pitch: 65, duration: 3000 });
    const trails = map.data['trails'] as { features: unknown[] };
    expect(trails.features).toHaveLength(2);
  });

  it('fits bounds and dims trails when a route is selected', async () => {
    const { map, rerender } = await renderLoaded(baseProps({ detail }));
    rerender(<MapView {...baseProps({ detail, selectedRouteId: route.id })} />);

    expect(map.fitBounds).toHaveBeenLastCalledWith(
      [
        [19.5, 49.5732],
        [19.5294, 49.6],
      ],
      { padding: 60, pitch: 60 },
    );
    expect(map.paint['trails.line-opacity']).toBe(0.35);
    expect((map.data['route'] as { features: unknown[] }).features).toHaveLength(1);

    rerender(<MapView {...baseProps({ detail, selectedRouteId: null })} />);
    expect(map.paint['trails.line-opacity']).toBe(1);
    expect((map.data['route'] as { features: unknown[] }).features).toHaveLength(0);
  });

  it('moves the profile cursor point', async () => {
    const { map, rerender } = await renderLoaded(baseProps());
    rerender(<MapView {...baseProps({ cursor: [19.51, 49.59] })} />);
    const cursor = map.data['cursor'] as { features: { geometry: unknown }[] };
    expect(cursor.features[0]?.geometry).toEqual({ type: 'Point', coordinates: [19.51, 49.59] });
  });

  it('calls onPeakClick with feature id', async () => {
    const props = baseProps();
    const { map } = await renderLoaded(props);
    map.emit('click', { features: [{ properties: { id: 'rysy' } }] }, 'peaks');
    expect(props.onPeakClick).toHaveBeenCalledWith('rysy');
  });

  it('calls onTileError once for repeated tile errors', async () => {
    const props = baseProps();
    const { map } = await renderLoaded(props);
    map.emit('error', { sourceId: 'openmaptiles', error: { message: 'x' } });
    map.emit('error', { sourceId: 'dem', tile: {}, error: { message: 'y' } });
    expect(props.onTileError).toHaveBeenCalledTimes(1);
  });

  it('ignores errors that are not about tiles', async () => {
    const props = baseProps();
    const { map } = await renderLoaded(props);
    map.emit('error', { error: { message: 'style problem' } });
    expect(props.onTileError).not.toHaveBeenCalled();
  });

  it('falls back to a bare mountain style and reports when the base style cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503 })),
    );
    const props = baseProps();
    render(<MapView {...props} />);
    await waitFor(() => expect(h.FakeMap.instances).toHaveLength(1));

    const style = currentMap().options.style as StyleSpecification;
    expect(style.terrain).toBeDefined();
    expect(props.onTileError).toHaveBeenCalledTimes(1);
  });

  it('removes the map on unmount', async () => {
    const { map, unmount } = await renderLoaded(baseProps());
    unmount();
    expect(map.removed).toBe(true);
  });
});
