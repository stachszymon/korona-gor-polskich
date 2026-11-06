import { act, render, waitFor } from '@testing-library/react';
import type { StyleSpecification } from 'maplibre-gl';
import type { MountainArea, PeakDetail, PeakSummary, Route } from '../data/schema';
import areaFixture from '../test/fixtures/mountain-area.json';
import { constrainCenter, maxPitchForZoom, minZoomForBounds, padBounds } from './camera';
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
    /** Takes the constrain function (`null` clears it). */
    setTransformConstrain = vi.fn();
    minZoom = 0;
    setMinZoom = vi.fn((zoom: number) => {
      this.minZoom = zoom;
    });
    getMinZoom() {
      return this.minZoom;
    }
    getMaxZoom() {
      return 22;
    }
    /** Like MapLibre, a camera move is clamped to the max pitch and lowering the max pitch lowers the camera. */
    maxPitch = 80;
    setMaxPitch = vi.fn((pitch: number) => {
      this.maxPitch = pitch;
      this.pitch = Math.min(this.pitch, pitch);
    });
    getMaxPitch() {
      return this.maxPitch;
    }
    /** Corners land outside the 800x600 viewport until zoomed out below 4.5. */
    project() {
      return { x: this.zoom > 4.5 ? 900 : 100, y: 100 };
    }
    /** Like MapLibre, `resize()` fires a `resize` event. */
    resize = vi.fn(() => {
      this.calls.push('resize');
      this.emit('resize');
    });
    fitBounds = vi.fn((_bounds: unknown, options?: { pitch?: number }) => {
      this.calls.push('fitBounds');
      if (options?.pitch !== undefined) this.pitch = Math.min(options.pitch, this.maxPitch);
    });
    jumpTo = vi.fn((camera: { zoom: number; pitch: number }) => {
      this.calls.push('jumpTo');
      this.zoom = camera.zoom;
      this.pitch = Math.min(camera.pitch, this.maxPitch);
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
    /** What `setDOMContent` was given. */
    content: HTMLElement | null = null;
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
    setDOMContent(content: HTMLElement) {
      this.content = content;
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
  LngLat: class {
    constructor(
      public lng: number,
      public lat: number,
    ) {}
  },
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
/** The camera limits: the area plus 8% slack on every side. */
const limits = (bounds: MountainArea['bounds']) => padBounds(bounds, 0.08);
type Constrain = (lngLat: { lng: number; lat: number }, zoom: number) => { center: { lng: number; lat: number }; zoom: number };
/** The constrain function the map was given last. */
const constrainOf = (map: { setTransformConstrain: { mock: { calls: unknown[][] } } }) => map.setTransformConstrain.mock.calls.at(-1)![0] as Constrain;
const gdansk = { lng: 18.65, lat: 54.35 };

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
    expect(map.options.locale).toMatchObject({
      'Popup.Close': 'Zamknij',
      'NavigationControl.ZoomIn': 'Przybliż',
      'NavigationControl.ZoomOut': 'Oddal',
      'NavigationControl.ResetBearing': expect.stringMatching(/północ/),
    });
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
      'trails-highlight-casing',
      'trails-highlight',
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

  it('keeps the camera inside the area: a constrain function on the padded bounds and a minZoom that fits the container', async () => {
    const { map } = await renderLoaded(baseProps());
    expect(map.setMinZoom).toHaveBeenLastCalledWith(minZoomForBounds(limits(area.bounds), 800, 600));
    const constrain = constrainOf(map);
    expect(constrain).toEqual(expect.any(Function));
    // Panning: the centre is kept so that the 800x600 view stays inside the padded bounds.
    const { center, zoom } = constrain(gdansk, 10);
    expect(zoom).toBe(10);
    const expected = constrainCenter(gdansk, 10, 800, 600, limits(area.bounds));
    expect(center.lng).toBeCloseTo(expected.lng, 9);
    expect(center.lat).toBeCloseTo(expected.lat, 9);
    expect(center.lat).toBeLessThan(gdansk.lat);
  });

  it('clamps the zoom to the minimum and maximum zoom in the constrain function', async () => {
    const { map } = await renderLoaded(baseProps());
    const constrain = constrainOf(map);
    expect(constrain(gdansk, 1).zoom).toBe(map.getMinZoom());
    expect(constrain(gdansk, 30).zoom).toBe(22);
  });

  it('does not use maxBounds (it zooms in to fill the window, so the limits had to be stretched to its shape)', async () => {
    const { map } = await renderLoaded(baseProps());
    // The fake has no `setMaxBounds`: calling it would throw. The constructor gets no bounds either.
    expect(map.options).not.toHaveProperty('maxBounds');
  });

  it('recomputes minZoom when the container is resized and constrains to the new size', async () => {
    const { map } = await renderLoaded(baseProps());
    const wide = minZoomForBounds(limits(area.bounds), 800, 600);

    map.size = { clientWidth: 360, clientHeight: 640 };
    act(() => map.emit('resize'));
    const narrow = minZoomForBounds(limits(area.bounds), 360, 640);
    expect(narrow).toBeLessThan(wide);
    expect(map.setMinZoom).toHaveBeenLastCalledWith(narrow);
    const expected = constrainCenter(gdansk, 10, 360, 640, limits(area.bounds));
    expect(constrainOf(map)(gdansk, 10).center.lat).toBeCloseTo(expected.lat, 9);

    map.size = { clientWidth: 1280, clientHeight: 800 };
    act(() => map.emit('resize'));
    expect(map.setMinZoom).toHaveBeenLastCalledWith(minZoomForBounds(limits(area.bounds), 1280, 800));
  });

  it('on a phone, the whole padded area fits at minZoom and the camera is pinned to its middle there', async () => {
    const { map } = await renderLoaded(baseProps());
    map.size = { clientWidth: 360, clientHeight: 560 };
    act(() => map.emit('resize'));
    const constrain = constrainOf(map);
    const fromNorth = constrain(gdansk, map.getMinZoom());
    const fromSouth = constrain({ lng: 20.46, lat: 44.8 }, map.getMinZoom());
    expect(fromNorth.center.lat).toBeCloseTo(fromSouth.center.lat, 9);
    const [, south, , north] = limits(area.bounds);
    expect(fromNorth.center.lat).toBeGreaterThan(south);
    expect(fromNorth.center.lat).toBeLessThan(north);
  });

  it('opens on a flat overview and ramps the pitch limit up with the zoom', async () => {
    const { map } = await renderLoaded(baseProps());
    expect(map.fitBounds).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ pitch: 0 }));
    expect(map.setMaxPitch).toHaveBeenLastCalledWith(maxPitchForZoom(map.zoom, map.getMinZoom()));

    // The user zooms: the limit follows the ramp, 15 degrees at minZoom to 80 three levels above.
    const userZoom = (zoom: number) => {
      map.zoom = zoom;
      act(() => map.emit('zoom', { originalEvent: {} }));
    };
    userZoom(map.getMinZoom() + 1.5);
    expect(map.setMaxPitch).toHaveBeenLastCalledWith(47.5);
    userZoom(map.getMinZoom() + 3);
    expect(map.setMaxPitch).toHaveBeenLastCalledWith(80);
    userZoom(map.getMinZoom());
    expect(map.setMaxPitch).toHaveBeenLastCalledWith(15);
  });

  it('does not limit the pitch without an area', async () => {
    const { map } = await renderLoaded(baseProps({ area: null }));
    act(() => map.emit('zoom', { originalEvent: {} }));
    expect(map.setMaxPitch).not.toHaveBeenCalled();
  });

  it('stops listening for resize and zoom when unmounted', async () => {
    const { map, unmount } = await renderLoaded(baseProps());
    expect(map.handlers.some((hd) => hd.type === 'resize')).toBe(true);
    expect(map.handlers.some((hd) => hd.type === 'zoom')).toBe(true);
    unmount();
    expect(map.handlers.some((hd) => hd.type === 'resize' || hd.type === 'zoom')).toBe(false);
  });

  it('drops the constrain function when the area goes away', async () => {
    const { map, rerender } = await renderLoaded(baseProps());
    rerender(<MapView {...baseProps({ area: null })} />);
    expect(map.setTransformConstrain).toHaveBeenLastCalledWith(null);
  });

  it('does not restrict the camera without an area (the file could not be loaded)', async () => {
    const { map } = await renderLoaded(baseProps({ area: null }));
    act(() => map.emit('resize'));
    expect(map.setTransformConstrain).not.toHaveBeenCalled();
    expect(map.setMinZoom).not.toHaveBeenCalled();
    expect(map.options).not.toHaveProperty('transformConstrain');
  });

  it('applies the area when it arrives after the map has loaded', async () => {
    const { map, rerender } = await renderLoaded(baseProps({ area: null }));
    expect(map.data['mountain-mask']).toBeUndefined();

    rerender(<MapView {...baseProps()} />);
    expect(constrainOf(map)).toEqual(expect.any(Function));
    expect(map.setMinZoom).toHaveBeenLastCalledWith(minZoomForBounds(limits(area.bounds), 800, 600));
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
    expect(map.setTransformConstrain).toHaveBeenCalledTimes(1);

    rerender(<MapView {...baseProps({ progress: { peaks: { rysy: { status: 'planned' } } }, peaks: [...peaks] })} />);
    expect(map.data['mountain-mask']).toBe(first);
    expect(map.setTransformConstrain).toHaveBeenCalledTimes(1);

    const other: MountainArea = {
      areas: { type: 'MultiPolygon', coordinates: [[[[19, 49], [20, 49], [20, 50], [19, 50], [19, 49]]]] },
      bounds: [18.5, 48.5, 20.5, 50.5],
    };
    rerender(<MapView {...baseProps({ area: other })} />);
    expect(map.data['mountain-mask']).not.toBe(first);
    expect((map.data['mountain-mask'] as { features: unknown[] }).features).toHaveLength(2);
    expect(map.setMinZoom).toHaveBeenLastCalledWith(minZoomForBounds(limits(other.bounds), 800, 600));
    const expected = constrainCenter(gdansk, 10, 800, 600, limits(other.bounds));
    expect(constrainOf(map)(gdansk, 10).center.lat).toBeCloseTo(expected.lat, 9);
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
    // Not capped by the low-zoom pitch limit: the limit is lifted to 80 right before the flight.
    expect(map.setMaxPitch).toHaveBeenLastCalledWith(80);
    expect(map.setMaxPitch.mock.invocationCallOrder.at(-1)).toBeLessThan(map.flyTo.mock.invocationCallOrder.at(-1)!);
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

  it('frames a route selected from the overview (minimum zoom) tilted at pitch 48, not at the low-zoom limit', async () => {
    const { map, rerender } = await renderLoaded(baseProps({ detail }));
    // Back at the overview: the pitch limit is at its lowest.
    map.zoom = map.getMinZoom();
    act(() => map.emit('zoom', { originalEvent: {} }));
    expect(map.maxPitch).toBe(15);

    rerender(<MapView {...baseProps({ detail, selectedRouteId: route.id })} />);
    const target = map.easeTo.mock.calls.at(-1) as unknown as [{ pitch: number }];
    expect(target[0].pitch).toBe(48);
    expect(map.maxPitch).toBe(80);
    // Programmatic zoom events during the animation do not bring the limit back down.
    act(() => map.emit('zoom'));
    expect(map.maxPitch).toBe(80);
    // The user zooming does.
    act(() => map.emit('zoom', { originalEvent: {} }));
    expect(map.maxPitch).toBe(maxPitchForZoom(map.zoom, map.getMinZoom()));
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
      expect(popup.options).toEqual({ closeButton: false, closeOnClick: false, className: 'route-tooltip', offset: 12, maxWidth: '320px' });
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

  describe('trails on the map', () => {
    // Red 1 and blue 2 (both named) run on the segment in `detail`; red 3 has no name in OSM and runs elsewhere.
    const trailsDetail: PeakDetail = {
      ...detail,
      trails: {
        type: 'FeatureCollection',
        features: [
          detail.trails.features[0]!,
          {
            type: 'Feature',
            properties: { colors: ['red'], relations: [{ id: 3, color: 'red' }] },
            geometry: {
              type: 'LineString',
              coordinates: [
                [19.6, 49.7],
                [19.61, 49.71],
              ],
            },
          },
        ],
      },
    };
    const lngLat = { lng: 19.51, lat: 49.59 };
    const popups = () => h.FakePopup.instances;
    const trailPopups = () => popups().filter((p) => p.content !== null);
    const highlight = (map: ReturnType<typeof currentMap>) => map.filters['trails-highlight'];
    const casing = (map: ReturnType<typeof currentMap>) => map.filters['trails-highlight-casing'];
    const none = ['==', ['get', 'relationKey'], ''];
    const rel = (id: number) => ['in', `,${id},`, ['get', 'relationKey']];
    /** The trail features under the pointer, as the map reports them: one per colour of the segment. */
    const overTrail = (map: ReturnType<typeof currentMap>, ...keys: string[]) => {
      map.queryResults['trails'] = keys.map((relationKey) => ({ properties: { relationKey } }));
    };
    const move = (map: ReturnType<typeof currentMap>, point = { x: 100, y: 80 }) =>
      act(() => map.emit('mousemove', { point, lngLat }));
    const click = (map: ReturnType<typeof currentMap>, extra: Record<string, unknown> = {}) =>
      act(() => map.emit('click', { point: { x: 100, y: 80 }, lngLat, ...extra }));

    it('hovering a trail highlights its relation along the whole trail, with the pointer cursor', async () => {
      const { map } = await renderLoaded(baseProps({ detail: trailsDetail }));
      overTrail(map, ',3,');
      move(map);
      expect(highlight(map)).toEqual(['any', rel(3)]);
      expect(casing(map)).toEqual(['any', rel(3)]);
      expect(map.canvas.style['cursor']).toBe('pointer');
      expect(popups().some((p) => p.isOpen())).toBe(false);
    });

    it('a segment shared by red and yellow highlights both relations', async () => {
      const { map } = await renderLoaded(baseProps({ detail: trailsDetail }));
      overTrail(map, ',1,', ',2,');
      move(map);
      expect(highlight(map)).toEqual(['any', rel(1), rel(2)]);
    });

    it('looks for trails in a few pixels around the pointer, more for a finger', async () => {
      const { map } = await renderLoaded(baseProps({ detail: trailsDetail }));
      move(map);
      expect(map.queryRenderedFeatures).toHaveBeenCalledWith(
        [
          [100 - 4, 80 - 4],
          [100 + 4, 80 + 4],
        ],
        { layers: ['trails'] },
      );
      const tap = Object.assign(new MouseEvent('click'), { pointerType: 'touch' });
      click(map, { originalEvent: tap });
      expect(map.queryRenderedFeatures).toHaveBeenCalledWith(
        [
          [100 - 12, 80 - 12],
          [100 + 12, 80 + 12],
        ],
        { layers: ['trails'] },
      );
    });

    it('sets the filter only when the relations change', async () => {
      const { map } = await renderLoaded(baseProps({ detail: trailsDetail }));
      overTrail(map, ',3,');
      move(map);
      const setFilter = vi.spyOn(map, 'setFilter');
      move(map, { x: 101, y: 80 });
      move(map, { x: 102, y: 80 });
      expect(setFilter).not.toHaveBeenCalled();
      overTrail(map, ',1,');
      move(map);
      expect(setFilter).toHaveBeenCalledTimes(2);
    });

    it('moving off the trail clears the highlight and the cursor', async () => {
      const { map } = await renderLoaded(baseProps({ detail: trailsDetail }));
      overTrail(map, ',3,');
      move(map);
      overTrail(map);
      move(map);
      expect(highlight(map)).toEqual(none);
      expect(casing(map)).toEqual(none);
      expect(map.canvas.style['cursor']).toBe('');
    });

    it('leaving the map or starting to move the camera clears the highlight', async () => {
      const { map } = await renderLoaded(baseProps({ detail: trailsDetail }));
      overTrail(map, ',3,');
      move(map);
      act(() => map.emit('mouseout'));
      expect(highlight(map)).toEqual(none);
      move(map);
      expect(highlight(map)).toEqual(['any', rel(3)]);
      act(() => map.emit('movestart'));
      expect(highlight(map)).toEqual(none);
    });

    it('a route under the pointer wins: the trail below it is not highlighted', async () => {
      const { map } = await renderLoaded(baseProps({ detail: trailsDetail }));
      overTrail(map, ',3,');
      map.queryResults['routes-all'] = [{ properties: { id: route.id } }];
      move(map);
      expect(highlight(map) ?? none).toEqual(none);
      expect(map.filters['routes-hover']).toEqual(['==', ['get', 'id'], route.id]);
      expect(map.queryRenderedFeatures).not.toHaveBeenCalledWith(expect.anything(), { layers: ['trails'] });
    });

    it('sliding from a trail onto a route drops the trail highlight', async () => {
      const { map } = await renderLoaded(baseProps({ detail: trailsDetail }));
      overTrail(map, ',3,');
      move(map);
      map.queryResults['routes-all'] = [{ properties: { id: route.id } }];
      move(map);
      expect(highlight(map)).toEqual(none);
    });

    it('a peak under the pointer wins over a trail', async () => {
      const { map } = await renderLoaded(baseProps({ detail: trailsDetail }));
      overTrail(map, ',3,');
      map.queryResults['peaks'] = [{ properties: { id: 'babia-gora' } }];
      move(map);
      expect(highlight(map) ?? none).toEqual(none);
      expect(map.canvas.style['cursor']).toBe('pointer');
    });

    it('does not highlight while the map is moving', async () => {
      const { map } = await renderLoaded(baseProps({ detail: trailsDetail }));
      overTrail(map, ',3,');
      map.moving = true;
      move(map);
      expect(highlight(map) ?? none).toEqual(none);
    });

    it('clicking a trail opens a popup with a closing button and a bar and name for every relation', async () => {
      const { map } = await renderLoaded(baseProps({ detail: trailsDetail }));
      overTrail(map, ',1,', ',2,');
      click(map);
      const [popup] = trailPopups();
      expect(popup).toBeDefined();
      expect(popup!.isOpen()).toBe(true);
      expect(popup!.options).toMatchObject({ closeButton: true });
      expect(popup!.options['closeOnClick']).not.toBe(false);
      expect(popup!.lngLat).toEqual(lngLat);
      const items = [...popup!.content!.querySelectorAll('li')];
      expect(items.map((li) => li.textContent)).toEqual(['Szlak czerwony', 'Szlak niebieski']);
      expect(items.map((li) => li.querySelector('[data-color]')?.getAttribute('data-color'))).toEqual(['red', 'blue']);
      expect((items[0]!.querySelector('[data-color]') as HTMLElement).style.backgroundColor).not.toBe('');
    });

    it('names an unnamed relation after its colour', async () => {
      const { map } = await renderLoaded(baseProps({ detail: trailsDetail }));
      overTrail(map, ',3,');
      click(map);
      expect(trailPopups()[0]!.content!.textContent).toBe('Szlak czerwony');
    });

    it('shows a name from OSM as plain text, never as markup', async () => {
      const markup: PeakDetail = {
        ...detail,
        trails: {
          ...detail.trails,
          features: [
            {
              ...detail.trails.features[0]!,
              properties: { colors: ['red'], relations: [{ id: 7, name: '<img src=x onerror=alert(1)>', color: 'red' }] },
            },
          ],
        },
      };
      const { map } = await renderLoaded(baseProps({ detail: markup }));
      overTrail(map, ',7,');
      click(map);
      const content = trailPopups()[0]!.content!;
      expect(content.querySelector('img')).toBeNull();
      expect(content.textContent).toBe('<img src=x onerror=alert(1)>');
    });

    it('a click on another trail replaces the popup', async () => {
      const { map } = await renderLoaded(baseProps({ detail: trailsDetail }));
      overTrail(map, ',1,');
      click(map);
      overTrail(map, ',3,');
      click(map);
      expect(trailPopups().filter((p) => p.isOpen())).toHaveLength(1);
      expect(trailPopups().at(-1)!.content!.textContent).toBe('Szlak czerwony');
    });

    it('a click on a route selects it and opens no trail popup', async () => {
      const props = baseProps({ detail: trailsDetail });
      const { map } = await renderLoaded(props);
      overTrail(map, ',3,');
      map.queryResults['routes-all'] = [{ properties: { id: route.id } }];
      click(map);
      expect(props.onRouteSelect).toHaveBeenCalledExactlyOnceWith(route.id);
      expect(trailPopups()).toHaveLength(0);
    });

    it('a click on a peak opens no trail popup', async () => {
      const { map } = await renderLoaded(baseProps({ detail: trailsDetail }));
      overTrail(map, ',3,');
      map.queryResults['peaks'] = [{ properties: { id: 'babia-gora' } }];
      click(map);
      expect(trailPopups()).toHaveLength(0);
    });

    it('a click on empty map opens nothing and clears a highlight left by a tap', async () => {
      const { map } = await renderLoaded(baseProps({ detail: trailsDetail }));
      overTrail(map, ',3,');
      click(map);
      expect(highlight(map)).toEqual(['any', rel(3)]);
      overTrail(map);
      click(map);
      expect(trailPopups()).toHaveLength(1);
      expect(highlight(map)).toEqual(none);
    });

    it('the highlight of a tap stays until the next tap', async () => {
      const { map } = await renderLoaded(baseProps({ detail: trailsDetail }));
      overTrail(map, ',1,');
      click(map);
      expect(highlight(map)).toEqual(['any', rel(1)]);
      overTrail(map, ',3,');
      click(map);
      expect(highlight(map)).toEqual(['any', rel(3)]);
    });

    it('closes the popup when another peak is loaded and when the map goes away', async () => {
      const { map, rerender, unmount } = await renderLoaded(baseProps({ detail: trailsDetail }));
      overTrail(map, ',1,');
      click(map);
      rerender(<MapView {...baseProps({ detail: null })} />);
      expect(trailPopups().some((p) => p.isOpen())).toBe(false);
      rerender(<MapView {...baseProps({ detail: trailsDetail })} />);
      click(map);
      expect(trailPopups().some((p) => p.isOpen())).toBe(true);
      unmount();
      expect(trailPopups().some((p) => p.isOpen())).toBe(false);
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
