import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addUnmarkedPath, buildTrailGraph, nearestVertex, vertexKey } from '../src/graph';
import { haversineM, type LonLat } from '../src/geo';
import type { OverpassRelation, OverpassResponse } from '../src/overpass';

const toGeom = (coords: LonLat[]): { lat: number; lon: number }[] =>
  coords.map(([lon, lat]) => ({ lat, lon }));

function relation(
  id: number,
  tags: Record<string, string>,
  ways: { ref: number; coords: LonLat[] }[],
): OverpassRelation {
  return {
    type: 'relation',
    id,
    tags: { route: 'hiking', ...tags },
    members: ways.map((w) => ({ type: 'way', ref: w.ref, role: '', geometry: toGeom(w.coords) })),
  };
}

const A: LonLat = [19.5, 49.5];
const B: LonLat = [19.501, 49.5];
const C: LonLat = [19.502, 49.5];
const D: LonLat = [19.502, 49.501];

describe('vertexKey', () => {
  it('formats lon,lat with 7 decimals', () => {
    expect(vertexKey([19.5, 49.25])).toBe('19.5000000,49.2500000');
  });
});

describe('buildTrailGraph', () => {
  it("shared way in red and yellow relations yields one edge pair with colors ['red','yellow']", () => {
    const way = { ref: 10, coords: [A, B] };
    const { graph, trails } = buildTrailGraph([
      relation(1, { 'osmc:symbol': 'yellow:white:yellow_bar', name: 'Zolty' }, [way]),
      relation(2, { 'osmc:symbol': 'red:white:red_bar', name: 'Czerwony' }, [way]),
    ]);
    const forward = graph.adj.get(vertexKey(A));
    const backward = graph.adj.get(vertexKey(B));
    expect(forward).toHaveLength(1);
    expect(backward).toHaveLength(1);
    expect(forward![0]).toMatchObject({ to: vertexKey(B), colors: ['red', 'yellow'], wayId: 10 });
    expect(forward![0]!.lengthM).toBeCloseTo(haversineM(A, B), 6);
    expect(backward![0]).toMatchObject({ to: vertexKey(A), colors: ['red', 'yellow'], wayId: 10 });
    expect(trails).toHaveLength(1);
    expect(trails[0]!.colors).toEqual(['red', 'yellow']);
    expect(trails[0]!.coords).toEqual([A, B]);
  });

  it('two ways meeting at a common coordinate share a vertex', () => {
    const { graph } = buildTrailGraph([
      relation(1, { colour: 'red' }, [
        { ref: 10, coords: [A, B] },
        { ref: 11, coords: [B, C] },
      ]),
    ]);
    expect(graph.vertices.size).toBe(3);
    const atB = graph.adj.get(vertexKey(B))!;
    expect(atB.map((e) => e.to).sort()).toEqual([vertexKey(A), vertexKey(C)].sort());
    expect(atB.map((e) => e.wayId).sort()).toEqual([10, 11]);
  });

  it('makes every point of a way a vertex and connects consecutive points', () => {
    const { graph } = buildTrailGraph([
      relation(1, { colour: 'blue' }, [{ ref: 10, coords: [A, B, C, D] }]),
    ]);
    expect(graph.vertices.size).toBe(4);
    expect(graph.vertices.get(vertexKey(C))).toEqual(C);
    expect(graph.adj.get(vertexKey(A))).toHaveLength(1);
    expect(graph.adj.get(vertexKey(B))).toHaveLength(2);
    expect(graph.adj.get(vertexKey(D))).toHaveLength(1);
  });

  it("relation without color is reported in skipped with reason 'no-color'", () => {
    const { graph, skipped, trails } = buildTrailGraph([
      relation(7, { name: 'Bez koloru' }, [{ ref: 10, coords: [A, B] }]),
    ]);
    expect(skipped).toEqual([{ id: 7, name: 'Bez koloru', reason: 'no-color' }]);
    expect(graph.vertices.size).toBe(0);
    expect(trails).toEqual([]);
  });

  it("reports colors outside the palette with reason 'unsupported-color'", () => {
    const { skipped } = buildTrailGraph([
      relation(8, { 'osmc:symbol': 'white:white::LOOP:black' }, [{ ref: 10, coords: [A, B] }]),
    ]);
    expect(skipped).toEqual([{ id: 8, reason: 'unsupported-color' }]);
  });

  it('ignores non-way members and ways without geometry', () => {
    const rel: OverpassRelation = {
      type: 'relation',
      id: 1,
      tags: { colour: 'green' },
      members: [
        { type: 'node', ref: 1, role: 'guidepost' },
        { type: 'way', ref: 10, role: '' },
        { type: 'way', ref: 11, role: '', geometry: toGeom([A, B]) },
      ],
    };
    const { graph, trails } = buildTrailGraph([rel]);
    expect(graph.vertices.size).toBe(2);
    expect(trails).toHaveLength(1);
  });

  it('does not create self-loops for repeated consecutive points', () => {
    const { graph } = buildTrailGraph([
      relation(1, { colour: 'red' }, [{ ref: 10, coords: [A, A, B] }]),
    ]);
    expect(graph.adj.get(vertexKey(A))).toHaveLength(1);
  });

  it('builds a graph from the real Babia Gora fixture', () => {
    const raw = JSON.parse(
      readFileSync(new URL('../fixtures/babia-gora.relations.json', import.meta.url), 'utf8'),
    ) as OverpassResponse;
    const relations = raw.elements.filter((e): e is OverpassRelation => e.type === 'relation');
    expect(relations.length).toBeGreaterThanOrEqual(3);

    const { graph, skipped, trails } = buildTrailGraph(relations);
    expect(graph.vertices.size).toBeGreaterThan(50);
    expect(trails.length).toBeGreaterThan(5);
    expect(skipped.some((s) => s.reason === 'no-color')).toBe(true);
    expect(skipped.some((s) => s.reason === 'unsupported-color')).toBe(true);

    const colors = new Set(trails.flatMap((t) => t.colors));
    expect(colors.has('blue')).toBe(true);
    expect(colors.has('yellow')).toBe(true);
    // a way shared by a yellow and a green relation carries both colors
    expect(trails.some((t) => t.colors.includes('green') && t.colors.includes('yellow'))).toBe(true);
    // every edge is mirrored
    for (const [from, edges] of graph.adj) {
      for (const e of edges) {
        expect(graph.adj.get(e.to)?.some((r) => r.to === from && r.wayId === e.wayId)).toBe(true);
      }
    }
  });
});

describe('nearestVertex', () => {
  const { graph } = buildTrailGraph([
    relation(1, { colour: 'red' }, [{ ref: 10, coords: [A, B, C] }]),
  ]);

  it('returns the key of the closest vertex within range', () => {
    expect(nearestVertex(graph, [19.50101, 49.50001], 50)).toBe(vertexKey(B));
  });

  it('returns null beyond maxDistM', () => {
    expect(nearestVertex(graph, [19.6, 49.6], 100)).toBeNull();
  });

  it('returns null for an empty graph', () => {
    expect(nearestVertex({ vertices: new Map(), adj: new Map() }, A, 1000)).toBeNull();
  });
});

describe('addUnmarkedPath', () => {
  const summit: LonLat = [19.5, 49.503]; // ~330 m north of A
  const nearA: LonLat = [19.50002, 49.50001]; // ~2 m from A

  it('connects a summit to the trail graph with uncoloured edges, snapping the end to the nearest vertex', () => {
    const { graph } = buildTrailGraph([relation(1, { colour: 'red' }, [{ ref: 10, coords: [A, B, C] }])]);

    const added = addUnmarkedPath(graph, [summit, [19.5, 49.5015], nearA], 30);

    expect(added).toBe(true);
    expect(nearestVertex(graph, summit, 1)).toBe(vertexKey(summit));
    const middle = graph.adj.get(vertexKey([19.5, 49.5015]))!;
    expect(middle.map((e) => e.to).sort()).toEqual([vertexKey(A), vertexKey(summit)].sort());
    expect(middle.every((e) => e.colors.length === 0 && e.wayId < 0)).toBe(true);
    // the snapped end is the existing vertex A, not a new one 2 m away
    expect(graph.vertices.has(vertexKey(nearA))).toBe(false);
    expect(graph.adj.get(vertexKey(A))!.some((e) => e.to === vertexKey([19.5, 49.5015]))).toBe(true);
  });

  it('adds nothing when the path end is farther than snapM from the graph', () => {
    const { graph } = buildTrailGraph([relation(1, { colour: 'red' }, [{ ref: 10, coords: [A, B, C] }])]);
    const before = graph.vertices.size;
    expect(addUnmarkedPath(graph, [summit, [19.5, 49.502]], 30)).toBe(false);
    expect(graph.vertices.size).toBe(before);
  });
});
