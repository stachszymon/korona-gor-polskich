import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { OverpassNode } from '../src/overpass';
import {
  type PeakSource,
  PeakSourceSchema,
  PeakSourcesSchema,
  checkPeakAgainstOsm,
  loadPeakSources,
} from '../src/peaks';

// ~111 m per 0.001 degree of latitude.
const SRC: PeakSource = {
  id: 'babia-gora',
  name: 'Babia Góra',
  range: 'Beskid Żywiecki',
  elevation: 1725,
  lat: 49.5732,
  lon: 19.5294,
  osmNodeId: 1,
};

function node(offsetLat: number, tags?: Record<string, string>): OverpassNode {
  const n: OverpassNode = { type: 'node', id: 1, lat: SRC.lat + offsetLat, lon: SRC.lon };
  if (tags) n.tags = tags;
  return n;
}

describe('checkPeakAgainstOsm', () => {
  it('ok when 150 m away and elevation differs by 8 m', () => {
    const result = checkPeakAgainstOsm(SRC, node(150 / 111_195, { ele: '1717' }));
    expect(result.distanceM).toBeGreaterThan(145);
    expect(result.distanceM).toBeLessThan(155);
    expect(result.elevationDiffM).toBe(-8);
    expect(result.ok).toBe(true);
  });

  it('not ok when 250 m away', () => {
    const result = checkPeakAgainstOsm(SRC, node(250 / 111_195, { ele: '1725' }));
    expect(result.distanceM).toBeGreaterThan(245);
    expect(result.ok).toBe(false);
  });

  it('not ok when elevation differs by 12 m', () => {
    const result = checkPeakAgainstOsm(SRC, node(0, { ele: '1713' }));
    expect(result.elevationDiffM).toBe(-12);
    expect(result.ok).toBe(false);
  });

  it('acceptOsmMismatch makes a mismatch ok', () => {
    const accepted: PeakSource = { ...SRC, acceptOsmMismatch: true };
    const result = checkPeakAgainstOsm(accepted, node(250 / 111_195, { ele: '1713' }));
    expect(result.ok).toBe(true);
    // The measurements are still reported so the pipeline can list the accepted mismatch.
    expect(result.distanceM).toBeGreaterThan(245);
    expect(result.elevationDiffM).toBe(-12);
  });

  it('missing ele tag ignores elevation check', () => {
    const result = checkPeakAgainstOsm(SRC, node(0));
    expect(result.elevationDiffM).toBeNull();
    expect(result.ok).toBe(true);
  });

  it('parses decimal and unit-suffixed ele values', () => {
    expect(checkPeakAgainstOsm(SRC, node(0, { ele: '1724.6' })).elevationDiffM).toBeCloseTo(-0.4);
    expect(checkPeakAgainstOsm(SRC, node(0, { ele: '1725 m' })).elevationDiffM).toBe(0);
  });

  it('treats an unparseable ele tag as missing', () => {
    expect(checkPeakAgainstOsm(SRC, node(0, { ele: 'high' })).elevationDiffM).toBeNull();
  });
});

describe('PeakSourceSchema', () => {
  it('rejects a non-integer elevation', () => {
    expect(PeakSourceSchema.safeParse({ ...SRC, elevation: 1725.5 }).success).toBe(false);
  });

  it('rejects a non-integer osmNodeId', () => {
    expect(PeakSourceSchema.safeParse({ ...SRC, osmNodeId: 1.5 }).success).toBe(false);
  });

  it('accepts the optional acceptOsmMismatch flag', () => {
    expect(PeakSourceSchema.safeParse({ ...SRC, acceptOsmMismatch: true }).success).toBe(true);
  });
});

describe('PeakSourcesSchema', () => {
  const many = (n: number): PeakSource[] =>
    Array.from({ length: n }, (_, i) => ({ ...SRC, id: `peak-${i}` }));

  it('accepts exactly 28 peaks with unique ids', () => {
    expect(PeakSourcesSchema.safeParse(many(28)).success).toBe(true);
  });

  it('rejects 27 and 29 peaks', () => {
    expect(PeakSourcesSchema.safeParse(many(27)).success).toBe(false);
    expect(PeakSourcesSchema.safeParse(many(29)).success).toBe(false);
  });

  it('rejects duplicate ids', () => {
    const peaks = many(28);
    peaks[27] = { ...SRC, id: 'peak-0' };
    expect(PeakSourcesSchema.safeParse(peaks).success).toBe(false);
  });
});

// Spec section 3.1, "Lista 28 szczytów".
const SPEC_PEAKS: [name: string, range: string][] = [
  ['Rysy', 'Tatry'],
  ['Babia Góra', 'Beskid Żywiecki'],
  ['Śnieżka', 'Karkonosze'],
  ['Śnieżnik', 'Masyw Śnieżnika'],
  ['Tarnica', 'Bieszczady'],
  ['Turbacz', 'Gorce'],
  ['Radziejowa', 'Beskid Sądecki'],
  ['Skrzyczne', 'Beskid Śląski'],
  ['Mogielica', 'Beskid Wyspowy'],
  ['Wysoka Kopa', 'Góry Izerskie'],
  ['Rudawiec', 'Góry Bialskie'],
  ['Orlica', 'Góry Orlickie'],
  ['Wysoka', 'Pieniny'],
  ['Wielka Sowa', 'Góry Sowie'],
  ['Lackowa', 'Beskid Niski'],
  ['Kowadło', 'Góry Złote'],
  ['Jagodna', 'Góry Bystrzyckie'],
  ['Skalnik', 'Rudawy Janowickie'],
  ['Czupel', 'Beskid Mały'],
  ['Waligóra', 'Góry Kamienne'],
  ['Szczeliniec Wielki', 'Góry Stołowe'],
  ['Lubomir', 'Beskid Makowski'],
  ['Biskupia Kopa', 'Góry Opawskie'],
  ['Chełmiec', 'Góry Wałbrzyskie'],
  ['Kłodzka Góra', 'Góry Bardzkie'],
  ['Skopiec', 'Góry Kaczawskie'],
  ['Ślęża', 'Masyw Ślęży'],
  ['Łysica', 'Góry Świętokrzyskie'],
];

describe('the real peaks.source.json', () => {
  const path = fileURLToPath(new URL('../peaks.source.json', import.meta.url));

  it('has 28 unique peaks matching the spec list', async () => {
    const peaks = await loadPeakSources(path);
    expect(peaks).toHaveLength(28);
    expect(new Set(peaks.map((p) => p.id)).size).toBe(28);
    expect(new Set(peaks.map((p) => p.osmNodeId)).size).toBe(28);
    expect(peaks.map((p) => [p.name, p.range])).toEqual(SPEC_PEAKS);
  });

  it('keeps every peak inside Poland', async () => {
    for (const p of await loadPeakSources(path)) {
      expect(p.lat).toBeGreaterThan(49.0);
      expect(p.lat).toBeLessThan(51.1);
      expect(p.lon).toBeGreaterThan(14.0);
      expect(p.lon).toBeLessThan(24.2);
    }
  });
});
