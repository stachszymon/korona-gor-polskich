import { act, render, waitFor } from '@testing-library/react';
import type { StyleSpecification } from 'maplibre-gl';
import type { MountainArea, PeakDetail, PeakSummary, Route } from '../data/schema';
import areaFixture from '../test/fixtures/mountain-area.json';
import { coverBounds, minZoomForBounds, padBounds } from './camera';
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
    canvas = { style: {} as Record<string, string> };
    getCanvas() {
      return this.canvas;
    }
    /** What `queryRenderedFeatures` returns, by the (first) layer asked for. */
    queryResults: Record<string, { properties: Record<string, unknown> }[]> = {};
    moving = false;
    isMoving() {
      return this.moving;
    }
    queryRenderedFeatures = vi.fn((_geometry: unknown, options?: { layers?: string[] }) => this.queryResults[options?.layers?.[0] ?? ''] ?? []);
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
    minZoom = 0;
    setMinZoom = vi.fn((zoom: number) => {
      this.minZoom = zoom;
    });
    getMinZoom() {
      return this.minZoom;
    }
    setMaxPitch = vi.fn();
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
  class FakePopup {
    static instances: FakePopup[] = [];
    options: Record<string, unknown>;
    text = '';
    lngLat: unknown = null;
    added = false;
    removed = false;
    addCount = 0;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      FakePopup.instances.push(this);
    }
    setLngLat(lngLat: unknown) {
      this.lngLat = lngLat;
      return this;
    }
    setText(text: string) {
      this.text = text;
      return this;
    }
    addTo() {
      this.addCount += 1;
      this.added = true;
      this.removed = false;
      return this;
    }
    remove() {
      this.removed = true;
      return this;
    }
    isOpen() {
      return this.added && !this.removed;
    }
  }
  return { FakeMap, FakePopup, addProtocol: vi.fn(), setupMaplibre: vi.fn(), setWorkerUrl: vi.fn() };
});

vi.mock('maplibre-gl', () => ({
  Map: h.FakeMap,
  NavigationControl: class {},
  Popup: h.FakePopup,
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
/** The camera limits: the area plus a little slack, grown to the shape of the window so that it can show all of it. */
const limits = (bounds: MountainArea['bounds'], width: number, height: number) => coverBounds(padBounds(bounds, 0.08), width, height);

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
  hoveredRouteId: null,
  cursor: null,
  onPeakClick: vi.fn(),
  onRouteSelect: vi.fn(),
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
  h.FakePopup.instances.length = 0;
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
    expect(map.options.pitch).toBe(0);
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
      'routes-all',
      'trails',
      'routes-hover',
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
      expect.objectContaining({ pitch: 0, duration: 0 }),
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
    expect(map.setMaxBounds).toHaveBeenLastCalledWith(limits(area.bounds, 800, 600));
    expect(map.setMinZoom).toHaveBeenLastCalledWith(minZoomForBounds(limits(area.bounds, 800, 600), 800, 600));
  });

  it('recomputes minZoom when the container is resized', async () => {
    const { map } = await renderLoaded(baseProps());
    const wide = minZoomForBounds(limits(area.bounds, 800, 600), 800, 600);

    map.size = { clientWidth: 360, clientHeight: 640 };
    act(() => map.emit('resize'));
    const narrow = minZoomForBounds(limits(area.bounds, 360, 640), 360, 640);
    expect(narrow).toBeLessThan(wide);
    expect(map.setMinZoom).toHaveBeenLastCalledWith(narrow);

    map.size = { clientWidth: 1280, clientHeight: 800 };
    act(() => map.emit('resize'));
    expect(map.setMinZoom).toHaveBeenLastCalledWith(minZoomForBounds(limits(area.bounds, 1280, 800), 1280, 800));
  });

  it('pads the area by 8% of its span, then grows the limits to the shape of the window', async () => {
    const { map } = await renderLoaded(baseProps());
    const [west, south, east, north] = map.setMaxBounds.mock.calls[0]![0] as number[];
    // The fixture is wider than the 800x600 window, so only north and south grow beyond the padding.
    expect(west).toBeCloseTo(15 - 0.08 * 5.9, 9);
    expect(east).toBeCloseTo(20.9 + 0.08 * 5.9, 9);
    expect(south).toBeLessThan(48.6 - 0.08 * 2.7);
    expect(north).toBeGreaterThan(51.3 + 0.08 * 2.7);
  });

  it('recomputes the limits for the new window shape on resize', async () => {
    const { map } = await renderLoaded(baseProps());
    map.size = { clientWidth: 360, clientHeight: 640 };
    act(() => map.emit('resize'));
    expect(map.setMaxBounds).toHaveBeenLastCalledWith(limits(area.bounds, 360, 640));
  });

  it('opens on a flat overview and keeps the pitch low near the minimum zoom', async () => {
    const { map } = await renderLoaded(baseProps());
    expect(map.fitBounds).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ pitch: 0 }));
    expect(map.setMaxPitch).toHaveBeenLastCalledWith(15);

    // Zooming in far enough frees the pitch up to the normal maximum, zooming out clamps it again.
    map.zoom = map.getMinZoom() + 2;
    act(() => map.emit('zoom'));
    expect(map.setMaxPitch).toHaveBeenLastCalledWith(80);
    map.zoom = map.getMinZoom() + 0.5;
    act(() => map.emit('zoom'));
    expect(map.setMaxPitch).toHaveBeenLastCalledWith(15);
  });

  it('does not limit the pitch without an area', async () => {
    const { map } = await renderLoaded(baseProps({ area: null }));
    act(() => map.emit('zoom'));
    expect(map.setMaxPitch).not.toHaveBeenCalled();
  });

  it('stops listening for resize and zoom when unmounted', async () => {
    const { map, unmount } = await renderLoaded(baseProps());
    expect(map.handlers.some((hd) => hd.type === 'resize')).toBe(true);
    expect(map.handlers.some((hd) => hd.type === 'zoom')).toBe(true);
    unmount();
    expect(map.handlers.some((hd) => hd.type === 'resize' || hd.type === 'zoom')).toBe(false);
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
    expect(map.setMaxBounds).toHaveBeenLastCalledWith(limits(area.bounds, 800, 600));
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
    expect(map.setMaxBounds).toHaveBeenLastCalledWith(limits(other.bounds, 800, 600));
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
    expect(map.jumpTo).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 6, pitch: 0 }));
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

  describe('routes on the map', () => {
    const second: Route = { ...route, id: 'babia-gora--korbielow', name: 'Z Korbielowa', distanceKm: 9.25, durationMin: 215 };
    const twoRoutes: PeakDetail = { ...detail, routes: [route, second] };
    const lngLat = { lng: 19.51, lat: 49.59 };
    const popups = () => h.FakePopup.instances;
    const hoverFilter = (map: ReturnType<typeof currentMap>) => map.filters['routes-hover'];
    const over = (map: ReturnType<typeof currentMap>, ...ids: string[]) => {
      map.queryResults['routes-all'] = ids.map((id) => ({ properties: { id } }));
    };
    const move = (map: ReturnType<typeof currentMap>) => act(() => map.emit('mousemove', { point: { x: 100, y: 80 }, lngLat }));

    it('draws every route of the peak, thin', async () => {
      const { map, rerender } = await renderLoaded(baseProps());
      expect((map.data['routes'] as { features: unknown[] }).features).toHaveLength(0);
      rerender(<MapView {...baseProps({ detail: twoRoutes })} />);
      const fc = map.data['routes'] as { features: { properties: unknown }[] };
      expect(fc.features.map((f) => f.properties)).toEqual([{ id: route.id }, { id: second.id }]);
      rerender(<MapView {...baseProps({ detail: null })} />);
      expect((map.data['routes'] as { features: unknown[] }).features).toHaveLength(0);
    });

    it('hovering a route highlights it and shows a tooltip with name, distance and time', async () => {
      const { map } = await renderLoaded(baseProps({ detail: twoRoutes }));
      over(map, second.id);
      move(map);
      expect(hoverFilter(map)).toEqual(['==', ['get', 'id'], second.id]);
      expect(map.canvas.style['cursor']).toBe('pointer');
      expect(popups().filter((p) => p.isOpen())).toHaveLength(1);
      const popup = popups()[0]!;
      expect(popup.options).toMatchObject({ closeButton: false, closeOnClick: false });
      expect(popup.text).toBe('Z Korbielowa · 9,3 km na szczyt · ok. 3 h 35 min');
      expect(popup.lngLat).toEqual(lngLat);
      expect(popup.isOpen()).toBe(true);
    });

    it('looks for routes in a few pixels around the pointer, so a thin line is easy to hit', async () => {
      const { map } = await renderLoaded(baseProps({ detail: twoRoutes }));
      over(map, route.id);
      move(map);
      expect(map.queryRenderedFeatures).toHaveBeenCalledWith(
        [
          [100 - 6, 80 - 6],
          [100 + 6, 80 + 6],
        ],
        { layers: ['routes-all'] },
      );
    });

    it('follows the pointer along the route and switches between routes', async () => {
      const { map } = await renderLoaded(baseProps({ detail: twoRoutes }));
      over(map, route.id);
      move(map);
      over(map, second.id);
      act(() => map.emit('mousemove', { point: { x: 120, y: 90 }, lngLat: { lng: 19.6, lat: 49.7 } }));
      expect(hoverFilter(map)).toEqual(['==', ['get', 'id'], second.id]);
      expect(popups().filter((p) => p.isOpen())).toHaveLength(1);
      expect(popups().at(-1)?.text).toContain('Z Korbielowa');
    });

    it('moving off the route clears the highlight, the tooltip and the cursor', async () => {
      const { map } = await renderLoaded(baseProps({ detail: twoRoutes }));
      over(map, route.id);
      move(map);
      over(map);
      move(map);
      expect(hoverFilter(map)).toEqual(['==', ['get', 'id'], '']);
      expect(map.canvas.style['cursor']).toBe('');
      expect(popups().some((p) => p.isOpen())).toBe(false);
    });

    it('leaving the map clears the hover state', async () => {
      const { map } = await renderLoaded(baseProps({ detail: twoRoutes }));
      over(map, route.id);
      move(map);
      act(() => map.emit('mouseout'));
      expect(hoverFilter(map)).toEqual(['==', ['get', 'id'], '']);
      expect(map.canvas.style['cursor']).toBe('');
      expect(popups().some((p) => p.isOpen())).toBe(false);
    });

    it('clears the hover state when the camera starts moving', async () => {
      const { map } = await renderLoaded(baseProps({ detail: twoRoutes }));
      over(map, route.id);
      move(map);
      act(() => map.emit('movestart'));
      expect(hoverFilter(map)).toEqual(['==', ['get', 'id'], '']);
      expect(popups().some((p) => p.isOpen())).toBe(false);
    });

    it('a peak on the route has no tooltip, and keeps the pointer cursor when the pointer slides onto it', async () => {
      const { map } = await renderLoaded(baseProps({ detail: twoRoutes }));
      over(map, route.id);
      move(map);
      expect(map.canvas.style['cursor']).toBe('pointer');
      map.queryResults['peaks'] = [{ properties: { id: 'babia-gora' } }];
      move(map);
      expect(map.canvas.style['cursor']).toBe('pointer');
      expect(popups().some((p) => p.isOpen())).toBe(false);
      expect(hoverFilter(map)).toEqual(['==', ['get', 'id'], '']);
      map.queryResults['peaks'] = [];
      over(map);
      move(map);
      expect(map.canvas.style['cursor']).toBe('');
    });

    it('a peak alone gets the pointer cursor, and only while the pointer is on it', async () => {
      const { map } = await renderLoaded(baseProps());
      map.queryResults['peaks'] = [{ properties: { id: 'babia-gora' } }];
      move(map);
      expect(map.canvas.style['cursor']).toBe('pointer');
      map.queryResults['peaks'] = [];
      move(map);
      expect(map.canvas.style['cursor']).toBe('');
    });

    it('prefers the selected route, then the hovered one, then the first, when routes overlap', async () => {
      const third: Route = { ...route, id: 'babia-gora--third', name: 'Z Trzeciej' };
      const all: PeakDetail = { ...detail, routes: [route, second, third] };
      const { map, rerender } = await renderLoaded(baseProps({ detail: all }));
      over(map, route.id, second.id, third.id);
      move(map);
      expect(hoverFilter(map)).toEqual(['==', ['get', 'id'], route.id]);
      // The pointer slides to a spot where the order differs: the route already hovered stays.
      over(map, third.id, second.id, route.id);
      move(map);
      expect(hoverFilter(map)).toEqual(['==', ['get', 'id'], route.id]);
      // The selected route beats the hovered one, for hover and for click.
      rerender(<MapView {...baseProps({ detail: all, selectedRouteId: third.id })} />);
      over(map, route.id, second.id, third.id);
      move(map);
      expect(hoverFilter(map)).toEqual(['==', ['get', 'id'], third.id]);
      const props = baseProps({ detail: all, selectedRouteId: second.id });
      rerender(<MapView {...props} />);
      act(() => map.emit('click', { point: { x: 100, y: 80 }, lngLat }));
      expect(props.onRouteSelect).toHaveBeenCalledExactlyOnceWith(second.id);
    });

    it('opens the tooltip once and only moves it while the pointer travels along the route', async () => {
      const { map } = await renderLoaded(baseProps({ detail: twoRoutes }));
      over(map, route.id);
      move(map);
      act(() => map.emit('mousemove', { point: { x: 110, y: 85 }, lngLat: { lng: 19.6, lat: 49.7 } }));
      act(() => map.emit('mousemove', { point: { x: 120, y: 90 }, lngLat: { lng: 19.7, lat: 49.8 } }));
      const popup = popups().find((p) => p.isOpen())!;
      expect(popup.addCount).toBe(1);
      expect(popup.lngLat).toEqual({ lng: 19.7, lat: 49.8 });
    });

    it('does not query for routes while the map is moving', async () => {
      const { map } = await renderLoaded(baseProps({ detail: twoRoutes }));
      over(map, route.id);
      map.moving = true;
      map.queryRenderedFeatures.mockClear();
      move(map);
      expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
      expect(popups().some((p) => p.isOpen())).toBe(false);
    });

    it('clicking a route calls onRouteSelect with its id', async () => {
      const props = baseProps({ detail: twoRoutes });
      const { map } = await renderLoaded(props);
      over(map, second.id);
      act(() => map.emit('click', { point: { x: 100, y: 80 }, lngLat }));
      expect(props.onRouteSelect).toHaveBeenCalledExactlyOnceWith(second.id);
    });

    it('a tap lands on the route within a bigger touch area', async () => {
      const props = baseProps({ detail: twoRoutes });
      const { map } = await renderLoaded(props);
      over(map, route.id);
      // What the browser hands maplibre for a tap: a click that is a pointer event of type touch.
      const tap = Object.assign(new MouseEvent('click'), { pointerType: 'touch' });
      act(() => map.emit('click', { point: { x: 100, y: 80 }, lngLat, originalEvent: tap }));
      expect(props.onRouteSelect).toHaveBeenCalledWith(route.id);
      expect(map.queryRenderedFeatures).toHaveBeenCalledWith(
        [
          [100 - 14, 80 - 14],
          [100 + 14, 80 + 14],
        ],
        { layers: ['routes-all'] },
      );
    });

    it('a click from a mouse keeps the small hit area', async () => {
      const { map } = await renderLoaded(baseProps({ detail: twoRoutes }));
      over(map, route.id);
      const click = Object.assign(new MouseEvent('click'), { pointerType: 'mouse' });
      act(() => map.emit('click', { point: { x: 100, y: 80 }, lngLat, originalEvent: click }));
      expect(map.queryRenderedFeatures).toHaveBeenCalledWith(
        [
          [100 - 6, 80 - 6],
          [100 + 6, 80 + 6],
        ],
        { layers: ['routes-all'] },
      );
    });

    it('a click without a pointer type uses the big hit area on a coarse (touch) pointer', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)' }));
      const { map } = await renderLoaded(baseProps({ detail: twoRoutes }));
      over(map, route.id);
      act(() => map.emit('click', { point: { x: 100, y: 80 }, lngLat, originalEvent: new MouseEvent('click') }));
      expect(map.queryRenderedFeatures).toHaveBeenCalledWith(
        [
          [100 - 14, 80 - 14],
          [100 + 14, 80 + 14],
        ],
        { layers: ['routes-all'] },
      );
    });

    it('a click on empty map or on a peak does not select a route', async () => {
      const props = baseProps({ detail: twoRoutes });
      const { map } = await renderLoaded(props);
      act(() => map.emit('click', { point: { x: 1, y: 1 }, lngLat }));
      over(map, route.id);
      map.queryResults['peaks'] = [{ properties: { id: 'babia-gora' } }];
      act(() => map.emit('click', { point: { x: 100, y: 80 }, lngLat }));
      expect(props.onRouteSelect).not.toHaveBeenCalled();
    });

    it('highlights the route whose row is hovered in the list', async () => {
      const { map, rerender } = await renderLoaded(baseProps({ detail: twoRoutes }));
      rerender(<MapView {...baseProps({ detail: twoRoutes, hoveredRouteId: second.id })} />);
      expect(hoverFilter(map)).toEqual(['==', ['get', 'id'], second.id]);
      rerender(<MapView {...baseProps({ detail: twoRoutes, hoveredRouteId: null })} />);
      expect(hoverFilter(map)).toEqual(['==', ['get', 'id'], '']);
    });

    it('a route hovered on the map wins over the list hover until the pointer leaves it', async () => {
      const { map } = await renderLoaded(baseProps({ detail: twoRoutes, hoveredRouteId: second.id }));
      over(map, route.id);
      move(map);
      expect(hoverFilter(map)).toEqual(['==', ['get', 'id'], route.id]);
      over(map);
      move(map);
      expect(hoverFilter(map)).toEqual(['==', ['get', 'id'], second.id]);
    });

    it('closes the tooltip when another peak is loaded', async () => {
      const { map, rerender } = await renderLoaded(baseProps({ detail: twoRoutes }));
      over(map, route.id);
      move(map);
      rerender(<MapView {...baseProps({ detail: null })} />);
      expect(popups().some((p) => p.isOpen())).toBe(false);
    });
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
