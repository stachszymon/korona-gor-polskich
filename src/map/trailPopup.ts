import { colorNamePl } from '../ui/format';
import { PTTK_HEX } from './config';
import type { RelationInfo } from './overlay';

/** The name of a relation, or "Szlak czerwony" when OSM has none. */
export function relationLabel(relation: RelationInfo): string {
  const name = relation.name?.trim();
  return name ? name : `Szlak ${colorNamePl(relation.color)}`;
}

/**
 * The body of the popup that opens on a trail click: one row per relation, a bar in its colour and its name.
 * Built from DOM nodes with `textContent`: names come from OpenStreetMap and must never be read as markup.
 */
export function trailPopupContent(relations: readonly RelationInfo[]): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'trail-popup__list';
  for (const relation of relations) {
    const item = document.createElement('li');
    item.className = 'trail-popup__item';
    const bar = document.createElement('span');
    bar.className = 'trail-popup__bar';
    bar.dataset['color'] = relation.color;
    bar.style.backgroundColor = PTTK_HEX[relation.color];
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', colorNamePl(relation.color));
    const label = document.createElement('span');
    label.textContent = relationLabel(relation);
    item.append(bar, label);
    list.append(item);
  }
  return list;
}
