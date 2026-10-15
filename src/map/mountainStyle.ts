import type { ExpressionSpecification, HillshadeLayerSpecification, LayerSpecification, RasterDEMSourceSpecification, StyleSpecification } from 'maplibre-gl';
import { DEM_URL, TERRAIN_EXAGGERATION } from './config';

const HIDDEN_LAYER_PATTERNS: RegExp[] = [
  /^(road|bridge|tunnel)_.*_casing$/,
  /^highway-shield/,
  /^road_shield/,
  /^highway-name-minor$/,
  /^highway-name-major$/,
  /^poi_/,
  /^road_one_way/,
  /^building-3d$/,
];

const ROAD_LINE = /^(road|bridge|tunnel)_(motorway|trunk|secondary|link|minor|street|service)/;

const ROAD_COLOR = '#a89f91';
const roadWidth = (): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], 10, 0.3, 13, 0.9, 16, 2.5];
const WOOD_FILL = 'rgba(120, 170, 90, 0.45)';

function demSource(): RasterDEMSourceSpecification {
  return { type: 'raster-dem', tiles: [DEM_URL], encoding: 'terrarium', tileSize: 256, maxzoom: 15 };
}

function hide(layer: LayerSpecification): LayerSpecification {
  return { ...layer, layout: { ...layer.layout, visibility: 'none' } } as LayerSpecification;
}

function restyle(layer: LayerSpecification): LayerSpecification {
  if (HIDDEN_LAYER_PATTERNS.some((re) => re.test(layer.id))) return hide(layer);
  if (layer.type === 'line' && ROAD_LINE.test(layer.id)) {
    return {
      ...layer,
      paint: { ...layer.paint, 'line-color': ROAD_COLOR, 'line-width': roadWidth() },
    };
  }
  if (layer.id === 'landcover_wood' && layer.type === 'fill') {
    return { ...layer, paint: { ...layer.paint, 'fill-color': WOOD_FILL } };
  }
  return layer;
}

/** Id of the first `symbol` layer, used as the anchor for layers that must sit below labels. */
export function firstSymbolLayerId(layers: readonly LayerSpecification[]): string | undefined {
  return layers.find((l) => l.type === 'symbol')?.id;
}

/**
 * Turns the OpenFreeMap "Liberty" style into the mountain style: muted roads, no POIs or shields,
 * stronger forest colour, DEM based hillshade, 3D terrain and a sky with fog.
 * Pure: the input style is never mutated.
 */
export function toMountainStyle(style: StyleSpecification): StyleSpecification {
  const layers = structuredClone(style.layers).map(restyle);

  const hillshade: HillshadeLayerSpecification = {
    id: 'hillshade',
    type: 'hillshade',
    source: 'hillshade-dem',
    paint: { 'hillshade-exaggeration': 0.5, 'hillshade-shadow-color': '#473B24' },
  };
  const anchor = firstSymbolLayerId(layers);
  const anchorIndex = anchor === undefined ? -1 : layers.findIndex((l) => l.id === anchor);
  if (anchorIndex === -1) layers.push(hillshade);
  else layers.splice(anchorIndex, 0, hillshade);

  return {
    ...structuredClone(style),
    sources: { ...structuredClone(style.sources), dem: demSource(), 'hillshade-dem': demSource() },
    layers,
    terrain: { source: 'dem', exaggeration: TERRAIN_EXAGGERATION },
    sky: {
      'sky-color': '#8fc1ee',
      'horizon-color': '#e6eef3',
      'fog-color': '#dde5ea',
      'fog-ground-blend': 0.5,
      'horizon-fog-blend': 0.6,
      'sky-horizon-blend': 0.5,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 12, 0],
    },
  };
}
