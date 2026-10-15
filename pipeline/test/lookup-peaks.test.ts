import { describe, expect, it } from 'vitest';
import { formatCandidates } from '../src/lookup-peaks';
import type { OverpassNode } from '../src/overpass';

const node = (id: number, lat: number, lon: number, tags: Record<string, string>): OverpassNode => ({
  type: 'node',
  id,
  lat,
  lon,
  tags,
});

describe('formatCandidates', () => {
  it('lists every node with the exact name, sorted by id, with id, coordinates and ele', () => {
    const out = formatCandidates(
      [{ name: 'Wysoka', range: 'Pieniny', elevation: 1050 }],
      [
        node(20, 49.4, 20.5, { name: 'Wysoka', ele: '1050' }),
        node(10, 50.1, 19.1, { name: 'Wysoka' }),
        node(30, 50.0, 19.0, { name: 'Wysoka Kopa', ele: '1126' }),
      ],
    );
    expect(out).toContain('## Wysoka (Pieniny) 1050 m');
    expect(out).toContain('id=10  lat=50.10000  lon=19.10000  ele=-');
    expect(out).toContain('id=20  lat=49.40000  lon=20.50000  ele=1050');
    expect(out).not.toContain('id=30');
    expect(out.indexOf('id=10')).toBeLessThan(out.indexOf('id=20'));
  });

  it('prints the distance to already filled coordinates', () => {
    const out = formatCandidates(
      [{ name: 'Rysy', lat: 49.1795, lon: 20.088 }],
      [node(1, 49.1795, 20.088, { name: 'Rysy' })],
    );
    expect(out).toContain('dist=0m');
  });

  it('says so when there is no node with that name', () => {
    const out = formatCandidates([{ name: 'Nigdzie' }], []);
    expect(out).toContain('no natural=peak node with this exact name');
  });
});
