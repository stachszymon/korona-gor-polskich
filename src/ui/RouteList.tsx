import type { Route } from '../data/schema';
import { gpxFilename, routeToGpx } from '../gpx/gpx';
import { downloadText } from '../lib/download';
import { PTTK_HEX } from '../map/config';
import { formatAscent, formatDistance, formatDuration } from './format';

export interface RouteListProps {
  routes: readonly Route[];
  selectedRouteId: string | null;
  onSelectRoute(id: string): void;
}

export function RouteList({ routes, selectedRouteId, onSelectRoute }: RouteListProps) {
  if (routes.length === 0) {
    return <p className="route-list__empty">Brak gotowych tras dla tego szczytu</p>;
  }

  return (
    <ul className="route-list">
      {routes.map((route) => {
        const selected = route.id === selectedRouteId;
        return (
          <li key={route.id} className="route-list__item">
            <button
              type="button"
              className="route-list__button"
              aria-pressed={selected}
              onClick={() => onSelectRoute(route.id)}
            >
              <span className="route-list__name">{route.name}</span>
              <span className="route-list__stripes" aria-hidden="true">
                {route.colors.map((color, i) => (
                  <span
                    key={`${color}-${i}`}
                    className="route-list__stripe"
                    style={{ backgroundColor: PTTK_HEX[color] }}
                  />
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
  );
}
