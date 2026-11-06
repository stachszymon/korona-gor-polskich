import type { MultiPolygon, Position } from 'geojson';
import mountainAreaFixture from '../test/fixtures/mountain-area.json';
import { outsideMask, pointInPolygon } from './mask';

/** Signed area of a ring in lon/lat space: positive for counter-clockwise rings. */
function signedArea(ring: Position[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    sum += x1! * y2! - x2! * y1!;
  }
  return sum / 2;
}

describe('outsideMask', () => {
  const areas = mountainAreaFixture.areas as MultiPolygon;
  const mask = outsideMask(areas);

  it('is one world polygon with a hole per area', () => {
    expect(areas.coordinates).toHaveLength(2);
    expect(mask.type).toBe('Polygon');
    expect(mask.coordinates).toHaveLength(1 + areas.coordinates.length);
    expect(mask.coordinates[0]).toEqual([
      [-180, -85],
      [180, -85],
      [180, 85],
      [-180, 85],
      [-180, -85],
    ]);
  });

  it('has a counter-clockwise outer ring and clockwise holes', () => {
    expect(signedArea(mask.coordinates[0]!)).toBeGreaterThan(0);
    for (const hole of mask.coordinates.slice(1)) expect(signedArea(hole)).toBeLessThan(0);
  });

  it('uses the area rings, reversed, as holes', () => {
    areas.coordinates.forEach((polygon, i) => {
      expect(mask.coordinates[i + 1]).toEqual([...polygon[0]!].reverse());
    });
  });

  it('is just the world for no areas', () => {
    expect(outsideMask({ type: 'MultiPolygon', coordinates: [] }).coordinates).toHaveLength(1);
  });
});

describe('geometry helpers', () => {
  const square: Position[] = [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
    [0, 0],
  ];
  it('pointInPolygon respects holes', () => {
    const hole: Position[] = [
      [0.5, 0.5],
      [0.5, 1.5],
      [1.5, 1.5],
      [1.5, 0.5],
      [0.5, 0.5],
    ];
    expect(pointInPolygon([0.2, 0.2], [square, hole])).toBe(true);
    expect(pointInPolygon([1, 1], [square, hole])).toBe(false);
    expect(pointInPolygon([3, 1], [square])).toBe(false);
  });
});
