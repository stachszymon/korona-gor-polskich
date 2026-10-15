import { exportProgress, importSummaryText, parseImport } from './importExport';
import type { Progress } from './progress';

const sample = (): Progress => ({
  version: 1,
  updatedAt: '2026-10-15T12:00:00Z',
  peaks: {
    'babia-gora': { status: 'done', date: '2026-08-14', note: 'Mgła' },
    rysy: { status: 'planned' },
    sniezka: { status: 'done' },
  },
});

const known = new Set(['babia-gora', 'rysy', 'sniezka']);

describe('exportProgress', () => {
  it('export filename is kgp-postep-2026-10-15.json', () => {
    const { filename } = exportProgress(sample(), new Date(2026, 9, 15, 12, 0, 0));
    expect(filename).toBe('kgp-postep-2026-10-15.json');
  });

  it('pads month and day', () => {
    const { filename } = exportProgress(sample(), new Date(2026, 0, 5, 12, 0, 0));
    expect(filename).toBe('kgp-postep-2026-01-05.json');
  });

  it('content is JSON indented by 2 spaces', () => {
    const { content } = exportProgress(sample(), new Date(2026, 9, 15));
    expect(content).toBe(JSON.stringify(sample(), null, 2));
    expect(content).toContain('\n  "version": 1');
  });
});

describe('parseImport', () => {
  it('export → parseImport round-trips', () => {
    const { content } = exportProgress(sample(), new Date(2026, 9, 15));
    const r = parseImport(content, known);
    expect(r).toEqual({
      ok: true,
      progress: sample(),
      summary: { done: 2, planned: 1, droppedUnknown: 0 },
    });
  });

  it("version 2 is rejected with error 'Plik pochodzi z nowszej wersji aplikacji'", () => {
    const text = JSON.stringify({ version: 2, updatedAt: '2026-10-15T12:00:00Z', peaks: {} });
    expect(parseImport(text, known)).toEqual({
      ok: false,
      error: 'Plik pochodzi z nowszej wersji aplikacji',
    });
  });

  it("non-JSON is rejected with error 'To nie jest poprawny plik postępu'", () => {
    expect(parseImport('hello <html>', known)).toEqual({
      ok: false,
      error: 'To nie jest poprawny plik postępu',
    });
  });

  it('valid JSON of the wrong shape is rejected with the same error', () => {
    for (const text of ['[]', '42', 'null', '{"foo":1}', '{"version":1,"updatedAt":"x","peaks":{}}']) {
      expect(parseImport(text, known), text).toEqual({
        ok: false,
        error: 'To nie jest poprawny plik postępu',
      });
    }
  });

  it('rejects an entry with an overlong note', () => {
    const p = sample();
    p.peaks['rysy'] = { status: 'done', note: 'x'.repeat(501) };
    expect(parseImport(JSON.stringify(p), known)).toEqual({
      ok: false,
      error: 'To nie jest poprawny plik postępu',
    });
  });

  it('unknown peak ids are dropped and counted', () => {
    const p = sample();
    p.peaks['mont-blanc'] = { status: 'done' };
    p.peaks['everest'] = { status: 'planned' };
    const r = parseImport(JSON.stringify(p), known);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.progress.peaks).sort()).toEqual(['babia-gora', 'rysy', 'sniezka']);
    expect(r.summary).toEqual({ done: 2, planned: 1, droppedUnknown: 2 });
  });
});

describe('importSummaryText', () => {
  it("summary text '12 zdobytych, 3 planowane, nadpisze obecny postęp'", () => {
    expect(importSummaryText({ done: 12, planned: 3, droppedUnknown: 0 })).toBe(
      '12 zdobytych, 3 planowane, nadpisze obecny postęp',
    );
  });

  it('inflects planned for 1, 2-4 and 5+', () => {
    expect(importSummaryText({ done: 1, planned: 1, droppedUnknown: 0 })).toBe(
      '1 zdobyty, 1 planowany, nadpisze obecny postęp',
    );
    expect(importSummaryText({ done: 2, planned: 2, droppedUnknown: 0 })).toBe(
      '2 zdobyte, 2 planowane, nadpisze obecny postęp',
    );
    expect(importSummaryText({ done: 0, planned: 5, droppedUnknown: 0 })).toBe(
      '0 zdobytych, 5 planowanych, nadpisze obecny postęp',
    );
  });

  it('appends the dropped-peaks note with the right inflection', () => {
    const s = (n: number) => importSummaryText({ done: 12, planned: 3, droppedUnknown: n });
    expect(s(1)).toBe(
      '12 zdobytych, 3 planowane, nadpisze obecny postęp, pominięto 1 nieznany szczyt',
    );
    expect(s(2)).toBe(
      '12 zdobytych, 3 planowane, nadpisze obecny postęp, pominięto 2 nieznane szczyty',
    );
    expect(s(5)).toBe(
      '12 zdobytych, 3 planowane, nadpisze obecny postęp, pominięto 5 nieznanych szczytów',
    );
  });
});
