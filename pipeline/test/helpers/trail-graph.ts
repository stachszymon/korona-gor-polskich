import type { PttkColor } from '../../../src/data/schema';
import type { DemSampler } from '../../src/elevation';
import { haversineM, type LonLat } from '../../src/geo';
import { type TrailGraph, vertexKey } from '../../src/graph';
import type { Trailhead } from '../../src/trailheads';

export const emptyGraph = (): TrailGraph => ({ vertices: new Map(), adj: new Map() });

function addVertex(g: TrailGraph, p: LonLat): string {
  const key = vertexKey(p);
  if (!g.vertices.has(key)) {
    g.vertices.set(key, p);
    g.adj.set(key, []);
  }
  return key;
}

/** Adds a polyline as one OSM way: an undirected edge pair per segment. */
export function addWay(g: TrailGraph, coords: LonLat[], wayId: number, colors: PttkColor[]): void {
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const ka = addVertex(g, a);
    const kb = addVertex(g, b);
    const lengthM = haversineM(a, b);
    g.adj.get(ka)!.push({ to: kb, lengthM, colors, wayId });
    g.adj.get(kb)!.push({ to: ka, lengthM, colors, wayId });
  }
}

export function trailheadAt(id: string, name: string, p: LonLat): Trailhead {
  return { id, name, kind: 'parking', lon: p[0], lat: p[1], vertex: vertexKey(p) };
}

/** Fake DEM: heights grow towards the south (the summits in the tests lie south of the starts). */
export const fakeSampler: DemSampler = {
  elevationAt: (p) => Promise.resolve(1000 + (49.62 - p[1]) * 20_000 + Math.sin(p[0] * 1000) * 3),
};
