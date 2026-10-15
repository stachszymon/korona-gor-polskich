import type { PointerEvent } from 'react';

export interface ElevationProfileProps {
  /** `[distanceM, elevationM]` pairs. */
  profile: [number, number][];
  /** Index of the profile point under the pointer, or `null` when it leaves. */
  onHover(index: number | null): void;
}

const WIDTH = 400;
const HEIGHT = 120;
const PAD = { left: 48, right: 8, top: 8, bottom: 8 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

/** Index of the profile point whose distance is closest to `distance`. */
function nearestIndex(profile: readonly [number, number][], distance: number): number {
  let best = 0;
  let bestGap = Infinity;
  profile.forEach(([d], i) => {
    const gap = Math.abs(d - distance);
    if (gap < bestGap) {
      best = i;
      bestGap = gap;
    }
  });
  return best;
}

export function ElevationProfile({ profile, onHover }: ElevationProfileProps) {
  if (profile.length === 0) return null;

  const minD = profile.at(0)?.[0] ?? 0;
  const maxD = profile.at(-1)?.[0] ?? 0;
  const spanD = maxD - minD || 1;
  const elevations = profile.map(([, e]) => e);
  const minE = Math.min(...elevations);
  const maxE = Math.max(...elevations);
  const spanE = maxE - minE || 1;

  const x = (d: number) => PAD.left + ((d - minD) / spanD) * PLOT_W;
  const y = (e: number) => PAD.top + (1 - (e - minE) / spanE) * PLOT_H;

  const line = profile.map(([d, e]) => `${x(d).toFixed(1)},${y(e).toFixed(1)}`);
  const baseline = (PAD.top + PLOT_H).toFixed(1);
  const area = `M${x(minD).toFixed(1)},${baseline} L${line.join(' L')} L${x(maxD).toFixed(1)},${baseline} Z`;

  function handleMove(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    // Convert the pointer position to viewBox units, then to a distance along the route.
    const vbX = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const fraction = Math.min(1, Math.max(0, (vbX - PAD.left) / PLOT_W));
    onHover(nearestIndex(profile, minD + fraction * spanD));
  }

  const labelBox = { left: 0, width: `calc(${(PAD.left / WIDTH) * 100}% - 4px)` };

  // The SVG is stretched to the container (`preserveAspectRatio="none"`), which would distort
  // text, so the axis labels are plain HTML laid over it.
  return (
    <div className="elevation-profile">
      <svg
        className="elevation-profile__svg"
        role="img"
        aria-label="Profil wysokości trasy"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        onPointerMove={handleMove}
        onPointerDown={handleMove}
        onPointerLeave={() => onHover(null)}
        onPointerCancel={() => onHover(null)}
        style={{ touchAction: 'none' }}
      >
        <path className="elevation-profile__area" d={area} fill="currentColor" fillOpacity={0.25} />
        <polyline
          className="elevation-profile__line"
          points={line.join(' ')}
          fill="none"
          stroke="currentColor"
          vectorEffect="non-scaling-stroke"
        />
        <line
          className="elevation-profile__axis"
          x1={PAD.left}
          x2={PAD.left}
          y1={PAD.top}
          y2={PAD.top + PLOT_H}
          stroke="currentColor"
          strokeOpacity={0.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className="elevation-profile__label"
        style={{ ...labelBox, top: `${(PAD.top / HEIGHT) * 100}%` }}
      >{`${Math.round(maxE)} m`}</span>
      <span
        className="elevation-profile__label"
        style={{ ...labelBox, bottom: `${(PAD.bottom / HEIGHT) * 100}%` }}
      >{`${Math.round(minE)} m`}</span>
    </div>
  );
}
