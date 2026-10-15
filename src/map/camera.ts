type LngLat = [number, number];
type ScreenPoint = { x: number; y: number };
export type ScreenBox = { minX: number; minY: number; maxX: number; maxY: number };
export type Viewport = { width: number; height: number };

type Camera = { center: { lng: number; lat: number }; zoom: number; pitch: number; bearing: number };

/** The camera methods `frameRoute` needs; `maplibregl.Map` satisfies it. */
export interface FramingMap {
  resize(): unknown;
  getContainer(): { clientWidth: number; clientHeight: number };
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  getPitch(): number;
  getBearing(): number;
  /** Terrain-aware in MapLibre: the point is placed on the (exaggerated) terrain surface. */
  project(lngLat: LngLat): ScreenPoint;
  fitBounds(bounds: [LngLat, LngLat], options: { padding: number; pitch: number; bearing: number; duration: number }): unknown;
  setZoom(zoom: number): unknown;
  panBy(offset: [number, number], options: { duration: number }): unknown;
  jumpTo(camera: Camera): unknown;
  easeTo(camera: Camera & { duration: number }): unknown;
}

/** Centre-and-zoom rounds before falling back to small zoom-out steps. */
const MAX_FIT_ITERATIONS = 8;
/** Extra zoom-out per round, so the nonlinear perspective converges instead of landing just outside. */
const FIT_MARGIN_ZOOM = 0.05;
/** A fit is good enough once the route spans this share of the padded width or height. */
const MIN_FILL = 0.85;
const ZOOM_OUT_STEP = 0.1;
const MAX_ZOOM_OUT_STEPS = 30;

export function projectedBox(points: readonly ScreenPoint[]): ScreenBox | null {
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function fitsInViewport(box: ScreenBox, { width, height }: Viewport, padding: number): boolean {
  return box.minX >= padding && box.minY >= padding && box.maxX <= width - padding && box.maxY <= height - padding;
}

/** Share of the padded viewport the box spans in its fuller dimension; above 1 it does not fit. */
function fill(box: ScreenBox, { width, height }: Viewport, padding: number): number {
  return Math.max(
    (box.maxX - box.minX) / Math.max(width - 2 * padding, 1),
    (box.maxY - box.minY) / Math.max(height - 2 * padding, 1),
  );
}

/**
 * How to move a camera so `box` fills the padded viewport: `panBy([dx, dy])` puts the box centre
 * at the viewport centre and `zoomDelta` scales it to the padded size (negative zooms out).
 */
export function fitAdjustment(box: ScreenBox, viewport: Viewport, padding: number) {
  const dx = (box.minX + box.maxX) / 2 - viewport.width / 2;
  const dy = (box.minY + box.maxY) / 2 - viewport.height / 2;
  const share = fill(box, viewport, padding);
  return { dx, dy, zoomDelta: share > 0 ? -Math.log2(share) : 0 };
}

function boundsOf(points: readonly LngLat[]): [LngLat, LngLat] | null {
  if (points.length === 0) return null;
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

function cameraOf(map: FramingMap): Camera {
  const { lng, lat } = map.getCenter();
  return { center: { lng, lat }, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
}

/**
 * Moves the (already pitched) camera until every point projects inside the padded viewport and
 * the points fill most of it. `project` follows the terrain, so this covers a summit lifted by
 * the exaggeration and the near end stretched by the perspective, which a top-down `fitBounds`
 * misses, and zooms back in where the pitch squeezed the route into a small strip.
 * Works only on a camera that is not animating (use `duration: 0` before calling it).
 */
export function keepPointsInView(map: FramingMap, points: readonly LngLat[], padding: number) {
  const viewport = (): Viewport => {
    const { clientWidth, clientHeight } = map.getContainer();
    return { width: clientWidth, height: clientHeight };
  };
  const box = () => projectedBox(points.map((p) => map.project(p)));

  for (let i = 0; i < MAX_FIT_ITERATIONS; i++) {
    const current = box();
    if (!current) return;
    if (fitsInViewport(current, viewport(), padding) && fill(current, viewport(), padding) >= MIN_FILL) return;
    const { dx, dy, zoomDelta } = fitAdjustment(current, viewport(), padding);
    map.panBy([dx, dy], { duration: 0 });
    map.setZoom(map.getZoom() + zoomDelta - FIT_MARGIN_ZOOM);
  }
  for (let step = 0; step < MAX_ZOOM_OUT_STEPS; step++) {
    const current = box();
    if (!current || fitsInViewport(current, viewport(), padding)) return;
    map.setZoom(map.getZoom() - ZOOM_OUT_STEP);
  }
}

/**
 * Animates the camera so the whole route, summit included, is visible at `pitch`.
 * The target camera is computed synchronously with instant moves and the camera is put back
 * before the animation starts, so nothing flickers.
 */
export function frameRoute(
  map: FramingMap,
  coordinates: readonly (readonly number[])[],
  { padding, pitch, duration }: { padding: number; pitch: number; duration: number },
) {
  const points = coordinates.flatMap(([lon, lat]): LngLat[] => (lon === undefined || lat === undefined ? [] : [[lon, lat]]));
  const bounds = boundsOf(points);
  if (!bounds) return;

  // The elevation profile may have just appeared and shrunk the map container.
  map.resize();
  const start = cameraOf(map);
  map.fitBounds(bounds, { padding, pitch, bearing: start.bearing, duration: 0 });
  keepPointsInView(map, points, padding);
  const target = cameraOf(map);
  map.jumpTo(start);
  map.easeTo({ ...target, duration });
}
