import type { z } from 'zod';
import {
  PeakDetailSchema,
  PeaksIndexSchema,
  type PeakDetail,
  type PeaksIndex,
} from './schema';

export type DataLoadErrorKind = 'network' | 'invalid';

export class DataLoadError extends Error {
  readonly kind: DataLoadErrorKind;

  constructor(kind: DataLoadErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DataLoadError';
    this.kind = kind;
  }
}

async function loadJson<T>(
  url: string,
  schema: z.ZodType<T>,
  fetchFn: typeof fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchFn(url);
  } catch (cause) {
    throw new DataLoadError('network', `Request failed: ${url}`, { cause });
  }
  if (!response.ok) {
    throw new DataLoadError('network', `Unexpected status ${response.status} for ${url}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new DataLoadError('invalid', `Malformed JSON in ${url}`, { cause });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new DataLoadError('invalid', `Unexpected data format in ${url}`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export function loadPeaksIndex(
  fetchFn: typeof fetch = (...args) => fetch(...args),
  base: string = import.meta.env.BASE_URL,
): Promise<PeaksIndex> {
  return loadJson(`${base}data/peaks.json`, PeaksIndexSchema, fetchFn);
}

export function loadPeakDetail(
  peakId: string,
  fetchFn: typeof fetch = (...args) => fetch(...args),
  base: string = import.meta.env.BASE_URL,
): Promise<PeakDetail> {
  return loadJson(
    `${base}data/peaks/${encodeURIComponent(peakId)}.json`,
    PeakDetailSchema,
    fetchFn,
  );
}
