import { act, render, waitFor } from '@testing-library/react';
import type { StyleSpecification } from 'maplibre-gl';
import type { MountainArea, PeakDetail, PeakSummary, Route } from '../data/schema';
import areaFixture from '../test/fixtures/mountain-area.json';
import { minZoomForBounds } from './camera';
import { MapView } from './MapView';
import { OVERLAY_SOURCE_IDS } from './overlay';

type Handler = (event: Record<string, unknown>) => void;

const h = vi.hoisted(() => {
  class FakeMap {
    static instances: FakeMap[] = [];
    /** When set, the constructor throws like a failed WebGL context creation. */
    static failNext = false;
    options: Record<string, unknown>;
    sources: Record<string, unknown> = {};
    layers: { spec: { id: string }; beforeId?: string }[] = [];
    /** Filters set with `setFilter`, by layer id. */
    filters: Record<string, unknown> = {};
    /** Layout properties set with `setLayoutProperty`, as `layer.property`. */
    layout: Record<string, unknown> = {};
    handlers: { type: string; layer?: string; fn: Handler }[] = [];
    data: Record<string, unknown> = {};
    paint: Record<string, unknown> = {};
    removed = false;
    constructor(options: Record<string, unknown>) {
      if (FakeMap.failNext) {
        FakeMap.failNext = false;
        throw new Error('Failed to initialize WebGL');
      }
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
    off(type: string, fn: Handler) {
      this.handlers = this.handlers.filter((hd) => !(hd.type === type && hd.fn === fn));
      return this;
    }
    addSource(id: string, spec: unknown) {
      this.sources[id] = spec;
    }
    getSource(id: string) {
      return id in this.sources ? { setData: (d: unknown) => (this.data[id] = d) } : undefined;
    }
    addLayer(spec: { id: string }, beforeId?: string) {
      this.layers.push({ spec, beforeId });
    }
    /** The style as the map would report it: the original layers with `setFilter` / `setLayoutProperty` applied. */
    getStyle() {
      const base: { id: string; type: string; filter?: unknown; layout?: Record<string, unknown> }[] = [
        { id: 'water', type: 'fill' },
        { id: 'place', type: 'symbol' },
        { id: 'label_city', type: 'symbol', filter: ['==', ['get', 'class'], 'city'] },
        { id: 'label_village', type: 'symbol' },
        { id: 'label_country_1', type: 'symbol', filter: ['==', ['get', 'class'], 'country'] },
      ];
      return {
        layers: base.map((layer) => {
          const visibility = this.layout[`${layer.id}.visibility`];
          return {
            ...layer,
            ...(layer.id in this.filters ? { filter: this.filters[layer.id] } : {}),
            ...(visibility === undefined ? {} : { layout: { ...layer.layout, visibility } }),
          };
        }),
      };
    }
    setFilter(layer: string, filter: unknown) {
      this.filters[layer] = filter;
    }
    setLayoutProperty(layer: string, prop: string, value: unknown) {
      this.layout[`${layer}.${prop}`] = value;
    }
    getCanvas() {
      return { style: {} as Record<string, string> };
    }
    setPaintProperty(layer: string, prop: string, value: unknown) {
      this.paint[`${layer}.${prop}`] = value;
    }
    zoom = 5;
    pitch = 50;
    /** Camera calls in order, for the route framing sequence. */
    calls: string[] = [];
    getCenter() {
      return { lng: 19, lat: 50 };
    }
    getPitch() {
      return this.pitch;
    }
    getBearing() {
      return 0;
    }
    getZoom() {
      return this.zoom;
    }
    setZoom(z: number) {
      this.zoom = z;
    }
    /** Container size; change it and emit `resize` to simulate a window or panel resize. */
    size = { clientWidth: 800, clientHeight: 600 };
    getContainer() {
      return this.size;
    }
    setMaxBounds = vi.fn();
    setMinZoom = vi.fn();
    /** Corners land outside the 800x600 viewport until zoomed out below 4.5. */
    project() {
      return { x: this.zoom > 4.5 ? 900 : 100, y: 100 };
    }
    resize = vi.fn(() => {
      this.calls.push('resize');
    });
    fitBounds = vi.fn((_bounds: unknown, options?: { pitch?: number }) => {
      this.calls.push('fitBounds');
      if (options?.pitch !== undefined) this.pitch = options.pitch;
    });
    jumpTo = vi.fn((camera: { zoom: number; pitch: number }) => {
      this.calls.push('jumpTo');
      this.zoom = camera.zoom;
      this.pitch = camera.pitch;
    });
    easeTo = vi.fn(() => {
      this.calls.push('easeTo');
    });
    panBy = vi.fn();
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

const area = areaFixture as MountainArea;

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
  legs: [{ color: 'red', lengthM: 10000 }],
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
        properties: {
          colors: ['red', 'blue'],
          relations: [
            { id: 1, name: 'Szlak czerwony', color: 'red' },
            { id: 2, name: 'Szlak niebieski', color: 'blue' },
          ],
        },
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
  area,
  progress: { peaks: { rysy: { status: 'done' } } },
  detail: null,
  selectedRouteId: null,
  cursor: null,
  onPeakClick: vi.fn(),
  onTileError: vi.fn(),
  onMapError: vi.fn(),
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
    expect(style.terrain).toEqual({ source: 'dem', exaggeration: 1.8 });
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
      'mountain-mask-fill',
      'mountain-mask-outline',
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

  it('dims everything outside the mountains: the mask source gets the outside polygon and the areas', async () => {
    const { map } = await renderLoaded(baseProps());

    expect(map.sources['mountain-mask']).toMatchObject({ type: 'geojson' });
    const data = map.data['mountain-mask'] as { features: { properties: { kind: string }; geometry: { type: string; coordinates: unknown[] } }[] };
    expect(data.features.map((f) => f.properties.kind)).toEqual(['outside', 'area', 'area']);
    // The fixture has two areas: the mask has the world ring and two holes.
    expect(data.features[0]?.geometry.type).toBe('Polygon');
    expect(data.features[0]?.geometry.coordinates).toHaveLength(3);
  });

  it('keeps the mask below the overlay layers', async () => {
    const { map } = await renderLoaded(baseProps());
    const ids = map.layers.map((l) => l.spec.id);
    expect(ids.indexOf('mountain-mask-fill')).toBeGreaterThan(ids.indexOf('contour-labels'));
    expect(ids.indexOf('mountain-mask-outline')).toBeLessThan(ids.indexOf('trails'));
  });

  it('keeps the camera inside the area: maxBounds from the file and a minZoom that fits the container', async () => {
    const { map } = await renderLoaded(baseProps());
    expect(map.setMaxBounds).toHaveBeenCalledWith(area.bounds);
    expect(map.setMinZoom).toHaveBeenLastCalledWith(minZoomForBounds(area.bounds, 800, 600));
  });

  it('recomputes minZoom when the container is resized', async () => {
    const { map } = await renderLoaded(baseProps());
    const wide = minZoomForBounds(area.bounds, 800, 600);

    map.size = { clientWidth: 360, clientHeight: 640 };
    act(() => map.emit('resize'));
    const narrow = minZoomForBounds(area.bounds, 360, 640);
    expect(narrow).toBeLessThan(wide);
    expect(map.setMinZoom).toHaveBeenLastCalledWith(narrow);

    map.size = { clientWidth: 1280, clientHeight: 800 };
    act(() => map.emit('resize'));
    expect(map.setMinZoom).toHaveBeenLastCalledWith(minZoomForBounds(area.bounds, 1280, 800));
  });

  it('does not restrict the camera without an area (the file could not be loaded)', async () => {
    const { map } = await renderLoaded(baseProps({ area: null }));
    act(() => map.emit('resize'));
    expect(map.setMaxBounds).not.toHaveBeenCalled();
    expect(map.setMinZoom).not.toHaveBeenCalled();
    expect(map.options).not.toHaveProperty('maxBounds');
  });

  it('applies the area when it arrives after the map has loaded', async () => {
    const { map, rerender } = await renderLoaded(baseProps({ area: null }));
    expect(map.data['mountain-mask']).toBeUndefined();

    rerender(<MapView {...baseProps()} />);
    expect(map.setMaxBounds).toHaveBeenCalledWith(area.bounds);
    expect((map.data['mountain-mask'] as { features: unknown[] }).features).toHaveLength(3);
  });

  it('hides country labels and limits city labels to the mountain areas on the live map', async () => {
    const { map } = await renderLoaded(baseProps());

    expect(map.layout['label_country_1.visibility']).toBe('none');
    expect(map.layout).not.toHaveProperty(['label_city.visibility']);
    const cityFilter = map.filters['label_city'] as unknown[];
    expect(cityFilter[0]).toBe('all');
    expect(cityFilter[1]).toEqual(['==', ['get', 'class'], 'city']);
    expect(cityFilter[2]).toMatchObject(['within', { type: 'MultiPolygon' }]);
    expect(map.filters['label_village']).toMatchObject(['within', { type: 'MultiPolygon' }]);
    // The basemap is not reloaded for this.
    expect(h.FakeMap.instances).toHaveLength(1);
  });

  it('recomputes the mask only when the area changes', async () => {
    const { map, rerender } = await renderLoaded(baseProps());
    const first = map.data['mountain-mask'];
    expect(map.setMaxBounds).toHaveBeenCalledTimes(1);

    rerender(<MapView {...baseProps({ progress: { peaks: { rysy: { status: 'planned' } } }, peaks: [...peaks] })} />);
    expect(map.data['mountain-mask']).toBe(first);
    expect(map.setMaxBounds).toHaveBeenCalledTimes(1);

    const other: MountainArea = {
      areas: { type: 'MultiPolygon', coordinates: [[[[19, 49], [20, 49], [20, 50], [19, 50], [19, 49]]]] },
      bounds: [18.5, 48.5, 20.5, 50.5],
    };
    rerender(<MapView {...baseProps({ area: other })} />);
    expect(map.data['mountain-mask']).not.toBe(first);
    expect((map.data['mountain-mask'] as { features: unknown[] }).features).toHaveLength(2);
    expect(map.setMaxBounds).toHaveBeenLastCalledWith(other.bounds);
    // Applying again must not nest the within filter.
    const cityFilter = map.filters['label_city'] as unknown[];
    expect(cityFilter).toHaveLength(3);
    expect(cityFilter[1]).toEqual(['==', ['get', 'class'], 'city']);
  });

  it('leaves the map unmasked while there is no area', async () => {
    const { map } = await renderLoaded(baseProps({ area: null }));
    expect(map.data['mountain-mask']).toBeUndefined();
    expect(map.layout).not.toHaveProperty(['label_country_1.visibility']);
    expect(map.filters).toEqual({});
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

  it('frames the selected route: resizes, fits off-screen at pitch 48, jumps back and eases', async () => {
    const { map, rerender } = await renderLoaded(baseProps({ detail }));
    map.zoom = 6;
    map.calls.length = 0;
    rerender(<MapView {...baseProps({ detail, selectedRouteId: route.id })} />);

    expect(map.calls).toEqual(['resize', 'fitBounds', 'jumpTo', 'easeTo']);
    expect(map.fitBounds).toHaveBeenLastCalledWith(
      [
        [19.5, 49.5732],
        [19.5294, 49.6],
      ],
      { padding: 60, pitch: 48, bearing: 0, duration: 0 },
    );
    // Jumped back to the camera from before the off-screen computation.
    expect(map.jumpTo).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 6, pitch: 50 }));
    // The fake projects everything off-screen above zoom 4.5, so the eased target is zoomed out.
    const target = map.easeTo.mock.calls.at(-1) as unknown as [{ zoom: number; pitch: number; duration: number }];
    expect(target[0].pitch).toBe(48);
    expect(target[0].zoom).toBeLessThanOrEqual(4.5);
    expect(target[0].duration).toBeGreaterThan(0);
  });

  it('dims trails while a route is selected', async () => {
    const { map, rerender } = await renderLoaded(baseProps({ detail }));
    rerender(<MapView {...baseProps({ detail, selectedRouteId: route.id })} />);
    expect(map.paint['trails.line-opacity']).toBe(0.35);
    expect((map.data['route'] as { features: unknown[] }).features).toHaveLength(1);

    map.calls.length = 0;
    rerender(<MapView {...baseProps({ detail, selectedRouteId: null })} />);
    expect(map.paint['trails.line-opacity']).toBe(1);
    expect((map.data['route'] as { features: unknown[] }).features).toHaveLength(0);
    expect(map.calls).toEqual([]);
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

  it('reports a map that cannot be created instead of throwing', async () => {
    h.FakeMap.failNext = true;
    const props = baseProps();
    render(<MapView {...props} />);
    await waitFor(() => expect(props.onMapError).toHaveBeenCalledTimes(1));
    expect(h.FakeMap.instances).toHaveLength(0);
    expect(props.onTileError).not.toHaveBeenCalled();
  });

  it('removes the map on unmount', async () => {
    const { map, unmount } = await renderLoaded(baseProps());
    unmount();
    expect(map.removed).toBe(true);
  });
});
