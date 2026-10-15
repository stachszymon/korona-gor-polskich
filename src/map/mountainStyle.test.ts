import type { StyleSpecification } from 'maplibre-gl';
import libertyLayers from '../test/fixtures/liberty-layers.json';
import { toMountainStyle } from './mountainStyle';

const liberty = libertyLayers as unknown as StyleSpecification;

function layer(style: StyleSpecification, id: string) {
  const found = style.layers.find((l) => l.id === id);
  if (!found) throw new Error(`layer ${id} not found`);
  return found;
}

describe('toMountainStyle', () => {
  it('hides casing, shields, POIs and 3D buildings', () => {
    const style = toMountainStyle(liberty);
    const hidden = [
      'road_minor_casing',
      'road_motorway_casing',
      'tunnel_street_casing',
      'bridge_street_casing',
      'bridge_path_pedestrian_casing',
      'highway-shield-non-us',
      'road_shield_us',
      'highway-name-minor',
      'highway-name-major',
      'poi_r20',
      'road_one_way_arrow',
      'building-3d',
    ];
    for (const id of hidden) {
      expect(layer(style, id).layout?.visibility, id).toBe('none');
    }
    // sanity: the fixture really contains every layer asserted above
    expect(hidden.every((id) => liberty.layers.some((l) => l.id === id))).toBe(true);
  });

  it('mutes road lines but leaves road_path_pedestrian unchanged', () => {
    const style = toMountainStyle(liberty);
    for (const id of ['road_minor', 'road_secondary_tertiary', 'road_motorway', 'road_service_track', 'bridge_street', 'tunnel_minor']) {
      const l = layer(style, id);
      expect(l.type).toBe('line');
      expect(l.paint, id).toMatchObject({
        'line-color': '#a89f91',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.3, 13, 0.9, 16, 2.5],
      });
      expect(l.layout?.visibility, id).toBeUndefined();
    }
    expect(layer(style, 'road_path_pedestrian')).toEqual(layer(liberty, 'road_path_pedestrian'));
    expect(layer(style, 'landcover_wood').paint).toMatchObject({ 'fill-color': 'rgba(120, 170, 90, 0.45)' });
  });

  it('does not mutate the input style', () => {
    const before = JSON.stringify(liberty);
    const style = toMountainStyle(liberty);
    expect(JSON.stringify(liberty)).toBe(before);
    expect(style).not.toBe(liberty);
    expect(liberty.terrain).toBeUndefined();
    expect(liberty.layers.some((l) => l.id === 'hillshade')).toBe(false);
  });

  it('inserts hillshade before the first symbol layer and sets terrain exaggeration 1.3', () => {
    const style = toMountainStyle(liberty);
    const ids = style.layers.map((l) => l.id);
    const firstSymbol = liberty.layers.find((l) => l.type === 'symbol');
    expect(firstSymbol).toBeDefined();
    expect(ids.indexOf('hillshade')).toBe(ids.indexOf(firstSymbol!.id) - 1);
    expect(layer(style, 'hillshade')).toMatchObject({
      type: 'hillshade',
      source: 'hillshade-dem',
      paint: { 'hillshade-exaggeration': 0.5, 'hillshade-shadow-color': '#473B24' },
    });
    const demSpec = {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15,
    };
    expect(style.sources['dem']).toEqual(demSpec);
    expect(style.sources['hillshade-dem']).toEqual(demSpec);
    expect(style.sources['openmaptiles']).toEqual(liberty.sources['openmaptiles']);
    expect(style.terrain).toEqual({ source: 'dem', exaggeration: 1.3 });
    expect(style.sky).toBeDefined();
    expect(style.sky?.['fog-color']).toBeDefined();
  });

  it('shows basemap labels in Polish, falling back to the local name', () => {
    const englishFirst = [
      'case',
      ['has', 'name:nonlatin'],
      ['concat', ['get', 'name:latin'], '\n', ['get', 'name:nonlatin']],
      ['coalesce', ['get', 'name_en'], ['get', 'name']],
    ];
    const input: StyleSpecification = {
      ...liberty,
      layers: [
        ...liberty.layers,
        {
          id: 'label_country_1',
          type: 'symbol',
          source: 'openmaptiles',
          'source-layer': 'place',
          layout: { 'text-field': englishFirst as never, 'text-font': ['Noto Sans Bold'] },
        },
      ],
    };
    const style = toMountainStyle(input);
    const polish = ['coalesce', ['get', 'name:pl'], ['get', 'name']];
    expect(layer(style, 'label_country_1').layout).toMatchObject({ 'text-field': polish, 'text-font': ['Noto Sans Bold'] });
    expect(layer(style, 'label_village').layout).toMatchObject({ 'text-field': polish });
    expect(JSON.stringify(style.layers)).not.toContain('name_en');
    // Road shields show refs, not names: untouched.
    expect(layer(style, 'road_shield_us').layout).toMatchObject({ 'text-field': ['to-string', ['get', 'ref']] });
  });
});
