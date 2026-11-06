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
 * `bounds` grown on every side by `share` of its span on that axis, kept inside the Web Mercator world
 * (longitude +-180, latitude +-85). Gives a pitched camera room at the edges of the bounds.
 */
export function padBounds(
  [west, south, east, north]: readonly [number, number, number, number],
  share: number,
): [number, number, number, number] {
  const dLon = (east - west) * share;
  const dLat = (north - south) * share;
  return [Math.max(west - dLon, -180), Math.max(south - dLat, -85), Math.min(east + dLon, 180), Math.min(north + dLat, 85)];
}

/**
 * `bounds` grown, evenly on both sides, in the one dimension where a `widthPx` x `heightPx` window is relatively
 * larger, so that the bounds have the window's shape. MapLibre never shows anything outside `maxBounds`: for
 * bounds of a different shape it zooms in until the window is filled, which crops the long side. With bounds
 * of the window's shape, `minZoomForBounds` shows the whole of the original bounds. Limited to the Web Mercator
 * world; a degenerate window leaves the bounds unchanged.
 */
export function coverBounds(
  bounds: readonly [number, number, number, number],
  widthPx: number,
  heightPx: number,
): [number, number, number, number] {
  const [west, south, east, north] = bounds;
  if (!(widthPx > 0 && heightPx > 0)) return [west, south, east, north];
  const dx = (east - west) / 360;
  const yTop = mercatorY(north);
  const yBottom = mercatorY(south);
  const dy = yBottom - yTop;
  const wantedDy = (heightPx * dx) / widthPx;
  if (wantedDy > dy) {
    const grow = (wantedDy - dy) / 2;
    const clampLat = (lat: number) => Math.min(Math.max(lat, -85), 85);
    return [west, clampLat(latitudeOf(yBottom + grow)), east, clampLat(latitudeOf(yTop - grow))];
  }
  const wantedDx = (widthPx * dy) / heightPx;
  const growDeg = ((wantedDx - dx) / 2) * 360;
  return [Math.max(west - growDeg, -180), south, Math.min(east + growDeg, 180), north];
}

/** Highest pitch the map allows (also the `maxPitch` the map is created with). */
export const MAX_PITCH = 80;
/** Pitch limit while zoomed out close to the minimum zoom. */
const OVERVIEW_MAX_PITCH = 15;
/** The overview pitch limit holds below `minZoom` plus this many zoom levels. */
const OVERVIEW_ZOOM_RANGE = 1.5;

/**
 * The highest pitch allowed at `zoom`. A tilted camera sees a wide trapezoid, and MapLibre keeps all of it
 * inside `maxBounds`, so a tilted overview of a wide area cannot show its corners. Close to `minZoom` the
 * camera is therefore kept almost top-down; zooming in beyond `minZoom + 1.5` frees the full pitch.
 */
export function maxPitchForZoom(zoom: number, minZoom: number): number {
  return zoom < minZoom + OVERVIEW_ZOOM_RANGE ? OVERVIEW_MAX_PITCH : MAX_PITCH;
}

/** Side of a Web Mercator tile in pixels (MapLibre's world is `512 * 2^zoom` px wide). */
const TILE_SIZE = 512;

/** Share of the Web Mercator world (0 at the north edge, 1 at the south edge) a latitude lies at. */
function mercatorY(lat: number): number {
  const rad = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

/** Latitude of a Web Mercator `y` (0 at the north edge of the world, 1 at the south edge). */
function latitudeOf(y: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
}

/**
 * The zoom at which `bounds` (`[west, south, east, north]`) just fits a `widthPx` x `heightPx` window,
 * top-down in Web Mercator with 512 px tiles. Used as the map's `minZoom`: zooming out further would
 * show more than the bounds. Never below 0.
 * Top-down only: a pitched camera sees the near rows magnified (about 1.4x at the bottom edge at pitch 50),
 * so a pitched view at this zoom clips the near corners. Pass bounds with slack (see `padBounds`); MapLibre's own `maxBounds` constraint is pitch-aware too.
 */
export function minZoomForBounds(
  [west, south, east, north]: readonly [number, number, number, number],
  widthPx: number,
  heightPx: number,
): number {
  const dx = (east - west) / 360;
  const dy = mercatorY(south) - mercatorY(north);
  const zoom = Math.min(Math.log2(widthPx / (dx * TILE_SIZE)), Math.log2(heightPx / (dy * TILE_SIZE)));
  return Number.isFinite(zoom) ? Math.max(zoom, 0) : 0;
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
