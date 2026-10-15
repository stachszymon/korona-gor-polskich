import { pointAtDistance } from './routeCursor';

type Coords = [number, number, number][];

describe('pointAtDistance', () => {
  it('returns the midpoint of a straight two-vertex line at half the distance', () => {
    const coords: Coords = [
      [19, 50, 1000],
      [19.1, 50, 1100],
    ];
    const [lon, lat] = pointAtDistance(coords, 500, 1000);
    expect(lon).toBeCloseTo(19.05, 6);
    expect(lat).toBeCloseTo(50, 6);
  });

  it('follows an L-shaped line through the corner', () => {
    // Legs of (nearly) equal length on the equator, so the corner sits at half the distance.
    const coords: Coords = [
      [0, 0, 0],
      [0, 0.1, 0],
      [0.1, 0.1, 0],
    ];
    const total = 2000;
    const first = pointAtDistance(coords, 500, total);
    expect(first[0]).toBeCloseTo(0, 5);
    expect(first[1]).toBeCloseTo(0.05, 4);

    const corner = pointAtDistance(coords, 1000, total);
    expect(corner[0]).toBeCloseTo(0, 4);
    expect(corner[1]).toBeCloseTo(0.1, 4);

    const second = pointAtDistance(coords, 1500, total);
    expect(second[0]).toBeCloseTo(0.05, 4);
    expect(second[1]).toBeCloseTo(0.1, 4);
  });

  it('scales geometry length to the profile total, so unevenly spaced vertices do not matter', () => {
    // Long first leg, short second leg: the corner is at 3/4 of the geometry length.
    const coords: Coords = [
      [0, 0, 0],
      [0.3, 0, 0],
      [0.4, 0, 0],
    ];
    const [lon] = pointAtDistance(coords, 750, 1000);
    expect(lon).toBeCloseTo(0.3, 4);
  });

  it('clamps to the first vertex at 0 and below, and to the last at the total and above', () => {
    const coords: Coords = [
      [19, 50, 0],
      [19.1, 50.1, 0],
    ];
    expect(pointAtDistance(coords, 0, 1000)).toEqual([19, 50]);
    expect(pointAtDistance(coords, -25, 1000)).toEqual([19, 50]);
    expect(pointAtDistance(coords, 1000, 1000)).toEqual([19.1, 50.1]);
    expect(pointAtDistance(coords, 5000, 1000)).toEqual([19.1, 50.1]);
  });

  it('returns the only vertex for a degenerate geometry', () => {
    expect(pointAtDistance([[19, 50, 0]], 10, 100)).toEqual([19, 50]);
    expect(
      pointAtDistance(
        [
          [19, 50, 0],
          [19, 50, 0],
        ],
        10,
        100,
      ),
    ).toEqual([19, 50]);
  });
});
