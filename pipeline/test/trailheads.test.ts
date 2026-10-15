import { describe, expect, it } from 'vitest';
import type { LonLat } from '../src/geo';
import { type TrailGraph, vertexKey } from '../src/graph';
import type { OverpassNode } from '../src/overpass';
import { findTrailheads, slugify } from '../src/trailheads';

// ~111 m per 0.001 degree of latitude; ~70 m per 0.001 degree of longitude at lat 50.
const A: LonLat = [19.0, 50.0];
const B: LonLat = [19.01, 50.0];

function graphOf(...points: LonLat[]): TrailGraph {
  const vertices = new Map<string, LonLat>();
  const adj = new Map<string, never[]>();
  for (const p of points) {
    vertices.set(vertexKey(p), p);
    adj.set(vertexKey(p), []);
  }
  return { vertices, adj };
}

let nextId = 1;
function poi(lon: number, lat: number, tags: Record<string, string>): OverpassNode {
  return { type: 'node', id: nextId++, lat, lon, tags };
}

describe('slugify', () => {
  it('lowercases, drops dashes and punctuation runs', () => {
    expect(slugify('Zawoja Markowa – parking')).toBe('zawoja-markowa-parking');
  });

  it('replaces Polish letters with ASCII', () => {
    expect(slugify('Łysica')).toBe('lysica');
    expect(slugify('ąćęłńóśźż ĄĆĘŁŃÓŚŹŻ')).toBe('acelnoszz-acelnoszz');
  });

  it('strips combining marks of non-Polish letters instead of turning them into dashes', () => {
    expect(slugify('Štrbské Pleso')).toBe('strbske-pleso');
    expect(slugify('Zürich')).toBe('zurich');
    expect(slugify('Štrbské Pleso'.normalize('NFD'))).toBe('strbske-pleso');
  });

  it('trims leading and trailing separators', () => {
    expect(slugify('  --Kasprowy Wierch!! ')).toBe('kasprowy-wierch');
  });
});

describe('findTrailheads', () => {
  it('ignores POIs farther than 300 m from any trail vertex', () => {
    const graph = graphOf(A, B);
    const near = poi(19.0, 50.002, { amenity: 'parking', name: 'Blisko' }); // ~222 m
    const far = poi(19.0, 50.004, { amenity: 'parking', name: 'Daleko' }); // ~445 m
    const result = findTrailheads(graph, [near, far]);
    expect(result.map((t) => t.name)).toEqual(['Blisko']);
  });

  it('respects a custom maxDistM', () => {
    const graph = graphOf(A);
    const p = poi(19.0, 50.002, { amenity: 'parking', name: 'P' });
    expect(findTrailheads(graph, [p], { maxDistM: 100 })).toEqual([]);
    expect(findTrailheads(graph, [p], { maxDistM: 300 })).toHaveLength(1);
  });

  it('unnamed parking takes the name of the nearest place POI', () => {
    const graph = graphOf(A, B);
    const parking = poi(19.0, 50.0005, { amenity: 'parking' });
    const nearVillage = poi(19.001, 50.0, { place: 'village', name: 'Bliska Wieś' });
    const farVillage = poi(19.2, 50.0, { place: 'village', name: 'Daleka Wieś' });
    const result = findTrailheads(graph, [farVillage, parking, nearVillage]);
    const th = result.find((t) => t.kind === 'parking');
    expect(th?.name).toBe('Bliska Wieś');
    expect(th?.id).toBe('bliska-wies');
  });

  it('drops an unnamed POI when there is no place POI to borrow a name from', () => {
    const graph = graphOf(A);
    expect(findTrailheads(graph, [poi(19.0, 50.0, { amenity: 'parking' })])).toEqual([]);
  });

  it('duplicate slugs get -2, -3 suffixes in stable order (sorted by lon, then lat)', () => {
    const graph = graphOf([19.0, 50.0], [19.1, 50.0], [19.2, 50.0]);
    const east = poi(19.2, 50.0, { amenity: 'parking', name: 'Parking' });
    const west = poi(19.0, 50.0, { amenity: 'parking', name: 'Parking' });
    const mid = poi(19.1, 50.0, { amenity: 'parking', name: 'Parking' });
    const forward = findTrailheads(graph, [east, west, mid]);
    const backward = findTrailheads(graph, [mid, west, east]);
    expect(forward.map((t) => [t.id, t.lon])).toEqual([
      ['parking', 19.0],
      ['parking-2', 19.1],
      ['parking-3', 19.2],
    ]);
    expect(backward).toEqual(forward);
  });

  it('breaks lon ties by lat when numbering duplicate slugs', () => {
    const graph = graphOf([19.0, 50.0], [19.0, 50.01]);
    const north = poi(19.0, 50.01, { amenity: 'parking', name: 'Parking' });
    const south = poi(19.0, 50.0, { amenity: 'parking', name: 'Parking' });
    const result = findTrailheads(graph, [north, south]);
    expect(result.map((t) => [t.id, t.lat])).toEqual([
      ['parking', 50.0],
      ['parking-2', 50.01],
    ]);
  });

  it('never lets a numbered suffix collide with a real slug', () => {
    const graph = graphOf([19.0, 50.0], [19.1, 50.0], [19.2, 50.0]);
    const result = findTrailheads(graph, [
      poi(19.0, 50.0, { amenity: 'parking', name: 'Parking' }),
      poi(19.1, 50.0, { amenity: 'parking', name: 'Parking' }),
      poi(19.2, 50.0, { amenity: 'parking', name: 'Parking 2' }),
    ]);
    expect(result.map((t) => t.id)).toEqual(['parking', 'parking-2', 'parking-2-2']);
  });

  it('treats a whitespace-only name as unnamed and borrows the nearest place name', () => {
    const graph = graphOf(A);
    const result = findTrailheads(graph, [
      poi(19.0, 50.0, { amenity: 'parking', name: '   ' }),
      poi(19.001, 50.0, { place: 'village', name: 'Zawoja' }),
    ]);
    const th = result.find((t) => t.kind === 'parking');
    expect(th?.name).toBe('Zawoja');
  });

  it('trims surrounding whitespace from names', () => {
    const graph = graphOf(A);
    const result = findTrailheads(graph, [poi(19.0, 50.0, { amenity: 'parking', name: '  Palenica  ' })]);
    expect(result[0]).toMatchObject({ name: 'Palenica', id: 'palenica' });
  });

  it('borrows names only from village, town and hamlet POIs', () => {
    const graph = graphOf(A);
    const parking = poi(19.0, 50.0, { amenity: 'parking' });
    const suburb = poi(19.0005, 50.0, { place: 'suburb', name: 'Osiedle' }); // nearest, wrong type
    const hamlet = poi(19.01, 50.0, { place: 'hamlet', name: 'Przysiółek' });
    const result = findTrailheads(graph, [parking, suburb, hamlet]);
    expect(result.find((t) => t.kind === 'parking')?.name).toBe('Przysiółek');
    // with no village/town/hamlet at all the unnamed parking is dropped
    expect(findTrailheads(graph, [parking, suburb]).filter((t) => t.kind === 'parking')).toEqual([]);
  });

  it('kind mapping: amenity=parking→parking, railway=station|halt→station, highway=bus_stop→bus_stop, place=*→place, manual→manual', () => {
    const graph = graphOf(
      [19.0, 50.0],
      [19.1, 50.0],
      [19.2, 50.0],
      [19.3, 50.0],
      [19.4, 50.0],
      [19.5, 50.0],
    );
    const result = findTrailheads(
      graph,
      [
        poi(19.0, 50.0, { amenity: 'parking', name: 'P' }),
        poi(19.1, 50.0, { railway: 'station', name: 'S' }),
        poi(19.2, 50.0, { railway: 'halt', name: 'H' }),
        poi(19.3, 50.0, { highway: 'bus_stop', name: 'B' }),
        poi(19.4, 50.0, { place: 'hamlet', name: 'L' }),
      ],
      { manual: [{ name: 'M', lat: 50.0, lon: 19.5 }] },
    );
    expect(result.map((t) => [t.name, t.kind])).toEqual([
      ['P', 'parking'],
      ['S', 'station'],
      ['H', 'station'],
      ['B', 'bus_stop'],
      ['L', 'place'],
      ['M', 'manual'],
    ]);
  });

  it('ignores nodes without a recognised tag', () => {
    const graph = graphOf(A);
    const noTags: OverpassNode = { type: 'node', id: 900, lat: 50.0, lon: 19.0 };
    const other = poi(19.0, 50.0, { amenity: 'cafe', name: 'Kawiarnia' });
    const railOther = poi(19.0, 50.0, { railway: 'tram_stop', name: 'Tram' });
    expect(findTrailheads(graph, [noTags, other, railOther])).toEqual([]);
  });

  it('two POIs snapping to the same vertex keep one trailhead, preferring parking > station > bus_stop > place', () => {
    const graph = graphOf(A);
    const pois = [
      poi(19.0, 50.0, { place: 'village', name: 'Wieś' }),
      poi(19.0, 50.0001, { highway: 'bus_stop', name: 'Przystanek' }),
      poi(19.0, 50.0002, { railway: 'station', name: 'Stacja' }),
      poi(19.0, 50.0003, { amenity: 'parking', name: 'Parking' }),
    ];
    for (const order of [pois, [...pois].reverse()]) {
      const result = findTrailheads(graph, order);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ kind: 'parking', name: 'Parking', vertex: vertexKey(A) });
    }
    const noParking = findTrailheads(graph, pois.slice(0, 3));
    expect(noParking.map((t) => t.kind)).toEqual(['station']);
    const busVsPlace = findTrailheads(graph, pois.slice(0, 2));
    expect(busVsPlace.map((t) => t.kind)).toEqual(['bus_stop']);
  });

  it('among POIs of the same kind on one vertex keeps the one closest to the vertex', () => {
    const graph = graphOf(A);
    const far = poi(19.0, 50.002, { amenity: 'parking', name: 'Dalszy' });
    const close = poi(19.0, 50.0005, { amenity: 'parking', name: 'Bliższy' });
    expect(findTrailheads(graph, [far, close]).map((t) => t.name)).toEqual(['Bliższy']);
  });

  it('does not merge POIs that share an OSM id but are different objects', () => {
    // Way centers are emitted as nodes carrying the way id, so ids can collide with node ids.
    const graph = graphOf([19.0, 50.0], [19.1, 50.0]);
    const wayParking: OverpassNode = {
      type: 'node',
      id: 77,
      lat: 50.0,
      lon: 19.0,
      tags: { amenity: 'parking', name: 'Parking Zachód' },
    };
    const busStop: OverpassNode = {
      type: 'node',
      id: 77,
      lat: 50.0,
      lon: 19.1,
      tags: { highway: 'bus_stop', name: 'Przystanek Wschód' },
    };
    const result = findTrailheads(graph, [wayParking, busStop]);
    expect(result.map((t) => t.name)).toEqual(['Parking Zachód', 'Przystanek Wschód']);
  });

  it('snaps to the nearest vertex and reports its key and the POI position', () => {
    const graph = graphOf(A, B);
    const result = findTrailheads(graph, [poi(19.009, 50.001, { amenity: 'parking', name: 'P' })]);
    expect(result).toEqual([
      { id: 'p', name: 'P', kind: 'parking', lon: 19.009, lat: 50.001, vertex: vertexKey(B) },
    ]);
  });

  it('manual points are kept and win over a POI on the same vertex', () => {
    const graph = graphOf(A);
    const result = findTrailheads(graph, [poi(19.0, 50.0, { amenity: 'parking', name: 'Parking' })], {
      manual: [{ name: 'Moja Polana', lat: 50.0001, lon: 19.0 }],
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'manual', name: 'Moja Polana', id: 'moja-polana' });
  });

  it('manual points farther than maxDistM from the graph are dropped', () => {
    const graph = graphOf(A);
    expect(findTrailheads(graph, [], { manual: [{ name: 'X', lat: 50.01, lon: 19.0 }] })).toEqual([]);
  });

  it('returns an empty list for an empty graph', () => {
    expect(findTrailheads(graphOf(), [poi(19.0, 50.0, { amenity: 'parking', name: 'P' })])).toEqual([]);
  });
});
