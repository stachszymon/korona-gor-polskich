import type { MultiPolygon } from 'geojson';
import type { FilterSpecification, LayerSpecification } from 'maplibre-gl';

/** Country and state names make no sense once only the mountains are in focus. */
const HIDDEN_LABEL_ID = /^label_(country_\d+|state)$/;

/**
 * Place, water, river, airport and path names that are kept only where they fall inside the mountain areas
 * (MapLibre's `within` expression works for point and line features).
 */
const RESTRICTED_LABEL_IDS = new Set([
  'label_city',
  'label_city_capital',
  'label_town',
  'label_village',
  'label_other',
  'water_name_point_label',
  'water_name_line_label',
  'waterway_line_label',
  'airport',
  'highway-name-path',
]);

type Within = ['within', MultiPolygon];

const isWithin = (filter: unknown): filter is Within => Array.isArray(filter) && filter[0] === 'within';

/** The filter as it was before `withinAreas` was applied, so applying new areas never nests filters. */
function withoutWithin(filter: FilterSpecification | undefined): FilterSpecification | undefined {
  if (isWithin(filter)) return undefined;
  if (Array.isArray(filter) && filter[0] === 'all' && filter.length === 3 && isWithin(filter[2])) return filter[1] as FilterSpecification;
  return filter;
}

function withinAreas(filter: FilterSpecification | undefined, areas: MultiPolygon): FilterSpecification {
  const within: Within = ['within', areas];
  const base = withoutWithin(filter);
  return (base === undefined ? within : ['all', base, within]) as FilterSpecification;
}

export type LabelRestrictions = {
  /** Layers to hide (`visibility: none`). */
  hidden: string[];
  /** New filters, by layer id, for the layers that only show labels inside the areas. */
  filters: Record<string, FilterSpecification>;
};

/** What has to change on `layers` so that place labels show only inside `areas`. */
export function labelRestrictions(layers: readonly LayerSpecification[], areas: MultiPolygon): LabelRestrictions {
  const hidden: string[] = [];
  const filters: Record<string, FilterSpecification> = {};
  for (const layer of layers) {
    if (layer.type !== 'symbol') continue;
    if (HIDDEN_LABEL_ID.test(layer.id)) hidden.push(layer.id);
    else if (RESTRICTED_LABEL_IDS.has(layer.id)) filters[layer.id] = withinAreas(layer.filter, areas);
  }
  return { hidden, filters };
}
