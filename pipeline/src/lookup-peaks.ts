import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { haversineM } from './geo';
import { type OverpassNode, fetchOverpass, peaksByNameQuery } from './overpass';

export interface ListedPeak {
  name: string;
  range?: string;
  elevation?: number;
  lat?: number;
  lon?: number;
}

/** Reads only what the lookup needs, so it works on a half-filled list (no node ids yet). */
async function readListedPeaks(path: string): Promise<ListedPeak[]> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!Array.isArray(raw)) throw new Error(`${path} must contain an array`);
  return raw.map((entry: unknown, index) => {
    const peak = entry as Partial<ListedPeak> | null;
    if (!peak || typeof peak.name !== 'string') {
      throw new Error(`${path}: entry ${index} has no "name"`);
    }
    return peak as ListedPeak;
  });
}

const hasCoords = (peak: ListedPeak): peak is ListedPeak & { lat: number; lon: number } =>
  typeof peak.lat === 'number' && typeof peak.lon === 'number' && (peak.lat !== 0 || peak.lon !== 0);

function describeNode(node: OverpassNode, peak: ListedPeak): string {
  const tags = node.tags ?? {};
  const parts = [
    `id=${node.id}`,
    `lat=${node.lat.toFixed(5)}`,
    `lon=${node.lon.toFixed(5)}`,
    `ele=${tags.ele ?? '-'}`,
  ];
  if (hasCoords(peak)) {
    parts.push(`dist=${Math.round(haversineM([peak.lon, peak.lat], [node.lon, node.lat]))}m`);
  }
  for (const key of ['wikidata', 'wikipedia', 'alt_name', 'is_in']) {
    if (tags[key]) parts.push(`${key}=${tags[key]}`);
  }
  return parts.join('  ');
}

export function formatCandidates(peaks: ListedPeak[], nodes: OverpassNode[]): string {
  const lines: string[] = [];
  for (const peak of peaks) {
    const candidates = nodes
      .filter((n) => n.tags?.name === peak.name)
      .sort((a, b) => a.id - b.id);
    const header = [
      peak.name,
      peak.range && `(${peak.range})`,
      peak.elevation && `${peak.elevation} m`,
    ]
      .filter(Boolean)
      .join(' ');
    lines.push(`## ${header}`);
    if (candidates.length === 0) lines.push('  no natural=peak node with this exact name');
    for (const node of candidates) lines.push(`  ${describeNode(node, peak)}`);
    lines.push('');
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const path = fileURLToPath(new URL('../peaks.source.json', import.meta.url));
  const peaks = await readListedPeaks(path);
  const names = [...new Set(peaks.map((p) => p.name))];
  const response = await fetchOverpass(peaksByNameQuery(names));
  const nodes = response.elements.filter((el): el is OverpassNode => el.type === 'node');
  console.log(formatCandidates(peaks, nodes));
  console.log('Nothing was written. Pick one node per peak and edit pipeline/peaks.source.json.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
