import { Fragment, useEffect, useMemo, useRef } from 'react';
import type { Route } from '../data/schema';
import { gpxFilename, routeToGpx } from '../gpx/gpx';
import { downloadText } from '../lib/download';
import { plural } from '../lib/plural';
import { PTTK_HEX, PTTK_NAME_PL } from '../map/config';
import { formatAscent, formatDistance, formatDuration } from './format';

export interface RouteListProps {
  routes: readonly Route[];
  selectedRouteId: string | null;
  onSelectRoute(id: string): void;
  /** The route whose row the pointer or keyboard focus is on; `null` when it leaves. */
  onHoverRoute(id: string | null): void;
}

export function RouteList({ routes, selectedRouteId, onSelectRoute, onHoverRoute }: RouteListProps) {
  const selectedRef = useRef<HTMLLIElement>(null);
  // A route picked on the map may sit outside the scrolled part of the list.
  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedRouteId]);
  const sorted = useMemo(() => [...routes].sort((a, b) => a.durationMin - b.durationMin), [routes]);

  if (routes.length === 0) {
    return <p className="route-list__empty">Brak gotowych tras dla tego szczytu</p>;
  }

  return (
    <>
      <p className="route-list__count">{`${sorted.length} ${plural(sorted.length, 'trasa', 'trasy', 'tras')}`}</p>
      <ul className="route-list">
      {sorted.map((route) => {
        const selected = route.id === selectedRouteId;
        return (
          <li key={route.id} ref={selected ? selectedRef : undefined} className="route-list__item">
            <button
              type="button"
              className="route-list__button"
              aria-pressed={selected}
              onClick={() => onSelectRoute(route.id)}
              onMouseEnter={() => onHoverRoute(route.id)}
              onMouseLeave={() => onHoverRoute(null)}
              onFocus={() => onHoverRoute(route.id)}
              onBlur={() => onHoverRoute(null)}
            >
              <span className="route-list__name">{route.name}</span>
              <span
                className="route-list__stripes"
                role="img"
                aria-label={route.colors.map((color) => PTTK_NAME_PL[color]).join(', potem ')}
              >
                {route.colors.map((color, i) => (
                  <Fragment key={`${color}-${i}`}>
                    {i > 0 && <span className="route-list__arrow">→</span>}
                    <span className="route-list__stripe" style={{ backgroundColor: PTTK_HEX[color] }} />
                  </Fragment>
                ))}
              </span>
              <span className="route-list__trailhead">{`Start: ${route.trailhead.name}`}</span>
              <span className="route-list__distance">{`${formatDistance(route.distanceKm)} na szczyt`}</span>
              <span className="route-list__ascent">{formatAscent(route.ascentM)}</span>
              <span className="route-list__duration">{`${formatDuration(route.durationMin)} na szczyt (szacunkowo)`}</span>
            </button>
            {selected && (
              <button
                type="button"
                className="route-list__gpx"
                onClick={() => downloadText(gpxFilename(route), routeToGpx(route), 'application/gpx+xml')}
              >
                Pobierz GPX
              </button>
            )}
          </li>
        );
      })}
      </ul>
    </>
  );
}
