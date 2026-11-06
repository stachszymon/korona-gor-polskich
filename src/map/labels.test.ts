import { featureFilter, validateStyleMin, type ICanonicalTileID } from '@maplibre/maplibre-gl-style-spec';
import type { MultiPolygon } from 'geojson';
import type { FilterSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import libertyLayers from '../test/fixtures/liberty-layers.json';
import mountainAreaFixture from '../test/fixtures/mountain-area.json';
import { labelRestrictions } from './labels';
import { toMountainStyle } from './mountainStyle';
import { contourLayers, overlayLayers } from './overlay';

// `liberty-layers.json` is a subset of the layers of https://tiles.openfreemap.org/styles/liberty, copied
// unchanged (the label layers, plus the layers `mountainStyle.ts` hides or restyles).
const liberty = libertyLayers as unknown as StyleSpecification;

/** What MapView does on the live map, applied to a style: hide layers and set the new filters. */
function restrictLabelsToAreas(style: StyleSpecification, areas: MultiPolygon): StyleSpecification {
  const { hidden, filters } = labelRestrictions(style.layers, areas);
  const layers = structuredClone(style.layers).map((layer): LayerSpecification => {
    if (hidden.includes(layer.id)) return { ...layer, layout: { ...layer.layout, visibility: 'none' } } as LayerSpecification;
    const filter = filters[layer.id];
    return filter === undefined ? layer : ({ ...layer, filter } as LayerSpecification);
  });
  return { ...style, layers };
}
const areas = mountainAreaFixture.areas as MultiPolygon;

function layer(style: StyleSpecification, id: string) {
  const found = style.layers.find((l) => l.id === id);
  if (!found) throw new Error(`layer ${id} not found`);
  return found;
}
const filterOf = (style: StyleSpecification, id: string) => (layer(style, id) as { filter?: FilterSpecification }).filter;

const PLACE_LABELS = ['label_city', 'label_city_capital', 'label_town', 'label_village', 'label_other'];
const WATER_LABELS = ['water_name_point_label', 'water_name_line_label', 'waterway_line_label'];
const OTHER_LABELS = ['airport', 'highway-name-path'];
const HIDDEN_LABELS = ['label_country_1', 'label_country_2', 'label_country_3', 'label_state'];

describe('labelRestrictions applied to a style', () => {
  const restricted = restrictLabelsToAreas(liberty, areas);

  it('hides country and state labels', () => {
    for (const id of HIDDEN_LABELS) expect(layer(restricted, id).layout?.visibility, id).toBe('none');
  });

  it('adds a within filter to place and water name labels, keeping the existing filter', () => {
    for (const id of [...PLACE_LABELS, ...WATER_LABELS, ...OTHER_LABELS]) {
      const existing = filterOf(liberty, id);
      expect(existing, `fixture has a filter on ${id}`).toBeDefined();
      expect(filterOf(restricted, id), id).toEqual(['all', existing, ['within', areas]]);
    }
  });

  it('uses just the within expression for a label layer without a filter', () => {
    const style: StyleSpecification = {
      ...liberty,
      layers: [{ id: 'label_village', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place' }],
    };
    expect(filterOf(restrictLabelsToAreas(style, areas), 'label_village')).toEqual(['within', areas]);
  });

  it('leaves every other layer untouched', () => {
    const touched = new Set([...HIDDEN_LABELS, ...PLACE_LABELS, ...WATER_LABELS, ...OTHER_LABELS]);
    for (const original of liberty.layers.filter((l) => !touched.has(l.id))) {
      expect(layer(restricted, original.id)).toEqual(original);
    }
    expect(restricted.layers.map((l) => l.id)).toEqual(liberty.layers.map((l) => l.id));
  });

  it('does not mutate the input style', () => {
    const before = JSON.stringify(liberty);
    restrictLabelsToAreas(liberty, areas);
    expect(JSON.stringify(liberty)).toBe(before);
  });

  it('is idempotent: restricting again does not nest the within filter', () => {
    const areasAgain: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [19, 49],
            [20, 49],
            [20, 50],
            [19, 50],
            [19, 49],
          ],
        ],
      ],
    };
    const twice = restrictLabelsToAreas(restricted, areasAgain);
    for (const id of [...PLACE_LABELS, ...WATER_LABELS, ...OTHER_LABELS]) {
      expect(filterOf(twice, id), id).toEqual(['all', filterOf(liberty, id), ['within', areasAgain]]);
    }
  });

  it('produces a valid style that composes with the mountain style', () => {
    const style = restrictLabelsToAreas(toMountainStyle(liberty), areas);
    expect(validateStyleMin(style).filter((e) => /filter/i.test(e.message))).toEqual([]);
  });
});

describe('labelRestrictions', () => {
  it('lists the layers to hide and the new filters', () => {
    const { hidden, filters } = labelRestrictions(liberty.layers, areas);
    expect(hidden.sort()).toEqual([...HIDDEN_LABELS].sort());
    expect(Object.keys(filters).sort()).toEqual([...PLACE_LABELS, ...WATER_LABELS, ...OTHER_LABELS].sort());
  });
});

/**
 * Guard against upstream layers we do not know about: after the mountain style and the restrictions,
 * every visible symbol layer must be restricted to the areas or be listed here with a reason.
 */
describe('visible symbol layers', () => {
  const ALLOWED_UNRESTRICTED: Record<string, string> = {
    'contour-labels': 'elevation labels of our own contour source, which is only meaningful in the mountains anyway',
    'peak-labels': 'our own peak labels',
  };

  it('are hidden, restricted with `within`, or explicitly allowed', () => {
    const style = restrictLabelsToAreas(toMountainStyle(liberty), areas);
    const symbols = [...style.layers, ...contourLayers(), ...overlayLayers()].filter((l) => l.type === 'symbol');
    const unguarded = symbols
      .filter((l) => l.layout?.visibility !== 'none')
      .filter((l) => !JSON.stringify((l as { filter?: unknown }).filter ?? null).includes('"within"'))
      .map((l) => l.id)
      .filter((id) => !(id in ALLOWED_UNRESTRICTED));
    expect(unguarded).toEqual([]);
  });

  it('the allow-list only names layers that exist', () => {
    const ids = new Set([...liberty.layers, ...contourLayers(), ...overlayLayers()].map((l) => l.id));
    for (const id of Object.keys(ALLOWED_UNRESTRICTED)) expect(ids.has(id), id).toBe(true);
  });
});

/** Evaluates a filter like MapLibre does for a feature of the tile that contains it. */
describe('the within filter on real features', () => {
  const ZOOM = 8;

  function tileFeature(coordinates: [number, number][], type: 1 | 2, properties: Record<string, unknown>) {
    const n = 2 ** ZOOM;
    const toWorld = ([lon, lat]: [number, number]) => {
      const rad = (lat * Math.PI) / 180;
      return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n };
    };
    const first = toWorld(coordinates[0]!);
    // Only z/x/y are read by `within`; the full tile id class is not needed.
    const canonical = { z: ZOOM, x: Math.floor(first.x), y: Math.floor(first.y) } as unknown as ICanonicalTileID;
    const geometry = coordinates.map((c) => {
      const w = toWorld(c);
      return { x: Math.round((w.x - canonical.x) * 8192), y: Math.round((w.y - canonical.y) * 8192) };
    });
    return { feature: { type, properties, geometry: [geometry] }, canonical };
  }

  const passes = (id: string, feature: ReturnType<typeof tileFeature>) => {
    const filter = filterOf(restrictLabelsToAreas(liberty, areas), id)!;
    return featureFilter(filter, 'filter').filter({ zoom: ZOOM }, feature.feature, feature.canonical);
  };

  it('keeps a town inside the mountains and drops one outside', () => {
    expect(passes('label_town', tileFeature([[20.0, 49.3]], 1, { class: 'town' }))).toBe(true);
    expect(passes('label_town', tileFeature([[20.5, 51.5]], 1, { class: 'town' }))).toBe(false);
  });

  it('drops a big city outside the mountains', () => {
    expect(passes('label_city', tileFeature([[21.01, 52.23]], 1, { class: 'city' }))).toBe(false);
  });

  it('keeps a river or lake name line inside the mountains and drops one outside', () => {
    const inside = tileFeature(
      [
        [20.0, 49.2],
        [20.1, 49.25],
      ],
      2,
      {},
    );
    const outside = tileFeature(
      [
        [19.0, 52.0],
        [19.2, 52.1],
      ],
      2,
      {},
    );
    expect(passes('water_name_line_label', inside)).toBe(true);
    expect(passes('water_name_line_label', outside)).toBe(false);
  });
});
