import { fitAdjustment, fitsInViewport, frameRoute, coverBounds, maxPitchForZoom, minZoomForBounds, padBounds, projectedBox, type FramingMap } from './camera';

const viewport = { width: 800, height: 600 };

describe('projectedBox', () => {
  it('returns the screen-space bounding box of the points', () => {
    expect(
      projectedBox([
        { x: 10, y: 50 },
        { x: 300, y: -20 },
        { x: 120, y: 700 },
      ]),
    ).toEqual({ minX: 10, minY: -20, maxX: 300, maxY: 700 });
  });

  it('returns null for no points', () => {
    expect(projectedBox([])).toBeNull();
  });
});

describe('fitsInViewport', () => {
  it('accepts a box inside the padded viewport, edges included', () => {
    expect(fitsInViewport({ minX: 60, minY: 60, maxX: 740, maxY: 540 }, viewport, 60)).toBe(true);
  });

  it('rejects a box that reaches into the padding on any side', () => {
    expect(fitsInViewport({ minX: 59, minY: 100, maxX: 500, maxY: 500 }, viewport, 60)).toBe(false);
    expect(fitsInViewport({ minX: 100, minY: 59, maxX: 500, maxY: 500 }, viewport, 60)).toBe(false);
    expect(fitsInViewport({ minX: 100, minY: 100, maxX: 741, maxY: 500 }, viewport, 60)).toBe(false);
    expect(fitsInViewport({ minX: 100, minY: 100, maxX: 500, maxY: 541 }, viewport, 60)).toBe(false);
  });
});

describe('fitAdjustment', () => {
  it('pans the box centre to the viewport centre and zooms out by the overflow factor', () => {
    // 1360 x 480 box in a 680 x 480 padded area: twice too wide → one zoom level out.
    const { dx, dy, zoomDelta } = fitAdjustment({ minX: -300, minY: 200, maxX: 1060, maxY: 680 }, viewport, 60);
    expect(dx).toBe(-20);
    expect(dy).toBe(140);
    expect(zoomDelta).toBeCloseTo(-1);
  });

  it('zooms in when the box fills only a small part of the padded viewport', () => {
    // 170 x 120 box in a 680 x 480 padded area: a quarter of the size → two zoom levels in.
    const { dx, dy, zoomDelta } = fitAdjustment({ minX: 315, minY: 240, maxX: 485, maxY: 360 }, viewport, 60);
    expect(dx).toBe(0);
    expect(dy).toBe(0);
    expect(zoomDelta).toBeCloseTo(2);
  });
});

/**
 * A pitched camera in miniature: south (near) of the centre is stretched 2.5x, so a top-down
 * fit leaves the near end of a north–south route below the viewport.
 */
class PitchedMap implements FramingMap {
  center = { lng: 0, lat: 0 };
  zoom = 10;
  pitch = 0;
  bearing = 0;
  calls: string[] = [];
  width = 800;
  height = 600;

  resize() {
    this.calls.push('resize');
    this.height = 460;
  }
  getContainer() {
    return { clientWidth: this.width, clientHeight: this.height };
  }
  getCenter() {
    return { ...this.center };
  }
  getZoom() {
    return this.zoom;
  }
  getPitch() {
    return this.pitch;
  }
  getBearing() {
    return this.bearing;
  }
  private scale() {
    return 2 ** this.zoom;
  }
  project([lng, lat]: [number, number]) {
    const s = this.scale();
    const dy = (this.center.lat - lat) * s;
    return { x: this.width / 2 + (lng - this.center.lng) * s, y: this.height / 2 + (dy > 0 ? dy * 2.5 : dy) };
  }
  fitBounds(bounds: [[number, number], [number, number]], options: { padding: number; pitch: number; duration: number }) {
    this.calls.push(`fitBounds:${options.duration}`);
    const [[w, s], [e, n]] = bounds;
    this.center = { lng: (w + e) / 2, lat: (s + n) / 2 };
    this.pitch = options.pitch;
    // Top-down fit of the taller side into the padded height.
    this.zoom = Math.log2((this.height - 2 * options.padding) / Math.max(n - s, e - w));
  }
  setZoom(zoom: number) {
    this.zoom = zoom;
  }
  panBy([dx, dy]: [number, number]) {
    const s = this.scale();
    this.center = { lng: this.center.lng + dx / s, lat: this.center.lat - dy / s };
  }
  jumpTo(camera: { center: { lng: number; lat: number }; zoom: number; pitch: number; bearing: number }) {
    this.calls.push('jumpTo');
    this.center = { ...camera.center };
    this.zoom = camera.zoom;
    this.pitch = camera.pitch;
    this.bearing = camera.bearing;
  }
  easeTo = vi.fn((camera: { center: { lng: number; lat: number }; zoom: number; pitch: number; bearing: number; duration: number }) => {
    this.calls.push('easeTo');
    void camera;
  });
}

const routeCoords: [number, number, number][] = [
  [19.5, 49.6, 700],
  [19.52, 49.58, 1200],
  [19.5294, 49.5732, 1725],
];

describe('frameRoute', () => {
  it('resizes first, computes the camera off-screen, jumps back and eases to it', () => {
    const map = new PitchedMap();
    map.center = { lng: 19.53, lat: 49.57 };
    map.zoom = 12.5;
    map.pitch = 65;
    const start = { center: map.getCenter(), zoom: 12.5, pitch: 65, bearing: 0 };

    frameRoute(map, routeCoords, { padding: 60, pitch: 48, duration: 1200 });

    expect(map.calls).toEqual(['resize', 'fitBounds:0', 'jumpTo', 'easeTo']);
    // Jumped back to where the camera was before the off-screen computation.
    expect(map.center).toEqual(start.center);
    expect(map.zoom).toBe(12.5);
    expect(map.pitch).toBe(65);

    const target = map.easeTo.mock.calls[0]![0] as { zoom: number; pitch: number; bearing: number; duration: number };
    expect(target).toMatchObject({ pitch: 48, bearing: 0, duration: 1200 });
  });

  it('a route whose near end projects below the viewport triggers zoom-out until every vertex fits', () => {
    const map = new PitchedMap();
    frameRoute(map, routeCoords, { padding: 60, pitch: 48, duration: 1200 });

    const target = map.easeTo.mock.calls[0]![0] as { center: { lng: number; lat: number }; zoom: number; pitch: number; bearing: number };
    // The plain top-down fit for the resized (460 px high) map.
    const topDownZoom = Math.log2((460 - 120) / (49.6 - 49.5732));
    expect(target.zoom).toBeLessThan(topDownZoom);

    // At the target camera every vertex is inside the padded, resized viewport.
    map.jumpTo(target);
    const box = projectedBox(routeCoords.map(([lon, lat]) => map.project([lon, lat])));
    expect(box).not.toBeNull();
    expect(fitsInViewport(box!, { width: 800, height: 460 }, 60)).toBe(true);
  });

  it('zooms in when the pitched fit leaves the route small, and still keeps every vertex inside', () => {
    const map = new PitchedMap();
    // A pitched camera squeezes the north-south extent, so fitBounds lands far too zoomed out.
    const fit = map.fitBounds.bind(map);
    map.fitBounds = (bounds, options) => {
      fit(bounds, options);
      map.zoom -= 2;
    };
    frameRoute(map, routeCoords, { padding: 60, pitch: 48, duration: 1200 });

    const target = map.easeTo.mock.calls[0]![0];
    map.jumpTo(target);
    const box = projectedBox(routeCoords.map(([lon, lat]) => map.project([lon, lat])))!;
    const viewport460 = { width: 800, height: 460 };
    expect(fitsInViewport(box, viewport460, 60)).toBe(true);
    const fill = Math.max((box.maxX - box.minX) / (800 - 120), (box.maxY - box.minY) / (460 - 120));
    expect(fill).toBeGreaterThanOrEqual(0.8);
  });

  it('does nothing for a route without coordinates', () => {
    const map = new PitchedMap();
    frameRoute(map, [], { padding: 60, pitch: 48, duration: 1200 });
    expect(map.calls).toEqual([]);
  });
});

describe('minZoomForBounds', () => {
  const bounds: [number, number, number, number] = [15, 49, 21, 51.5];

  /** Normalised Web Mercator extent of `bounds`: the share of the world they span. */
  function extent([west, south, east, north]: [number, number, number, number]) {
    const y = (lat: number) => {
      const rad = (lat * Math.PI) / 180;
      return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
    };
    return { dx: (east - west) / 360, dy: y(south) - y(north) };
  }

  it('needs a higher zoom in a big window than in a small one', () => {
    expect(minZoomForBounds(bounds, 1280, 800)).toBeGreaterThan(minZoomForBounds(bounds, 360, 640));
  });

  it('fits the bounds in the window at the returned zoom', () => {
    for (const [width, height] of [
      [1280, 800],
      [360, 640],
      [900, 300],
    ] as const) {
      const zoom = minZoomForBounds(bounds, width, height);
      const { dx, dy } = extent(bounds);
      const worldPx = 512 * 2 ** zoom;
      expect(dx * worldPx).toBeLessThanOrEqual(width + 1e-6);
      expect(dy * worldPx).toBeLessThanOrEqual(height + 1e-6);
      // Tight in at least one dimension.
      expect(Math.max(dx * worldPx - width, dy * worldPx - height)).toBeCloseTo(0, 6);
    }
  });

  it('is limited by the width in a narrow window and by the height in a short one', () => {
    const { dx, dy } = extent(bounds);
    expect(minZoomForBounds(bounds, 360, 2000)).toBeCloseTo(Math.log2(360 / (dx * 512)), 9);
    expect(minZoomForBounds(bounds, 3000, 300)).toBeCloseTo(Math.log2(300 / (dy * 512)), 9);
  });

  it('never goes below zero for a degenerate window', () => {
    expect(minZoomForBounds(bounds, 0, 0)).toBe(0);
  });
});

describe('padBounds', () => {
  it('grows every side by the share of the span on that axis', () => {
    const padded = padBounds([10, 40, 20, 50], 0.1);
    expect(padded[0]).toBeCloseTo(9, 9);
    expect(padded[1]).toBeCloseTo(39, 9);
    expect(padded[2]).toBeCloseTo(21, 9);
    expect(padded[3]).toBeCloseTo(51, 9);
  });

  it('uses each axis own span', () => {
    const [west, south, east, north] = padBounds([15, 48, 23, 51], 0.08);
    expect(west).toBeCloseTo(15 - 0.64, 9);
    expect(east).toBeCloseTo(23 + 0.64, 9);
    expect(south).toBeCloseTo(48 - 0.24, 9);
    expect(north).toBeCloseTo(51 + 0.24, 9);
  });

  it('stays inside the Web Mercator world', () => {
    expect(padBounds([-179, -84, 179, 84], 0.5)).toEqual([-180, -85, 180, 85]);
  });

  it('does not mutate its input', () => {
    const input: [number, number, number, number] = [10, 40, 20, 50];
    padBounds(input, 0.1);
    expect(input).toEqual([10, 40, 20, 50]);
  });
});

describe('maxPitchForZoom', () => {
  it('flattens the camera to 15 degrees near the minimum zoom', () => {
    expect(maxPitchForZoom(6, 6)).toBe(15);
    expect(maxPitchForZoom(6.4, 6)).toBe(15);
    expect(maxPitchForZoom(7.49, 6)).toBe(15);
  });

  it('frees the pitch 1.5 zoom levels above the minimum', () => {
    expect(maxPitchForZoom(7.5, 6)).toBe(80);
    expect(maxPitchForZoom(12.5, 6)).toBe(80);
  });

  it('follows the minimum zoom, not absolute zoom levels', () => {
    expect(maxPitchForZoom(8, 7)).toBe(15);
    expect(maxPitchForZoom(8.5, 7)).toBe(80);
  });
});

describe('coverBounds', () => {
  type Bounds = [number, number, number, number];
  const mercY = (lat: number) => {
    const rad = (lat * Math.PI) / 180;
    return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
  };
  const size = ([west, south, east, north]: Bounds) => ({ dx: (east - west) / 360, dy: mercY(south) - mercY(north) });
  const wide: Bounds = [15, 48.6, 23.2, 51.4];

  it('keeps the bounds when the window has the same shape', () => {
    const { dx, dy } = size(wide);
    const covered = coverBounds(wide, 1000 * dx, 1000 * dy);
    for (let i = 0; i < 4; i++) expect(covered[i]).toBeCloseTo(wide[i]!, 6);
  });

  it('grows the bounds north and south, evenly, when the window is taller than they are wide', () => {
    const covered = coverBounds(wide, 920, 718);
    expect(covered[0]).toBe(wide[0]);
    expect(covered[2]).toBe(wide[2]);
    expect(covered[1]).toBeLessThan(wide[1]);
    expect(covered[3]).toBeGreaterThan(wide[3]);
    const { dx, dy } = size(covered);
    expect(dx / dy).toBeCloseTo(920 / 718, 6);
    // Evenly in Mercator space: the centre does not move.
    expect((mercY(covered[1]) + mercY(covered[3])) / 2).toBeCloseTo((mercY(wide[1]) + mercY(wide[3])) / 2, 9);
  });

  it('grows the bounds east and west when the window is wider than they are', () => {
    const covered = coverBounds(wide, 3000, 300);
    expect(covered[1]).toBeCloseTo(wide[1], 9);
    expect(covered[3]).toBeCloseTo(wide[3], 9);
    expect(covered[0]).toBeLessThan(wide[0]);
    expect(covered[2]).toBeGreaterThan(wide[2]);
    const { dx, dy } = size(covered);
    expect(dx / dy).toBeCloseTo(3000 / 300, 6);
  });

  it('lets minZoomForBounds fit both dimensions at once, so the window is exactly filled', () => {
    for (const [w, h] of [
      [920, 718],
      [360, 640],
      [1560, 998],
    ] as const) {
      const covered = coverBounds(wide, w, h);
      const zoom = minZoomForBounds(covered, w, h);
      const { dx, dy } = size(covered);
      expect(dx * 512 * 2 ** zoom).toBeCloseTo(w, 3);
      expect(dy * 512 * 2 ** zoom).toBeCloseTo(h, 3);
    }
  });

  it('returns the bounds unchanged for a degenerate window', () => {
    expect(coverBounds(wide, 0, 0)).toEqual(wide);
  });
});
