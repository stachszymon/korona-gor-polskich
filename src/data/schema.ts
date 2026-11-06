import { z } from 'zod';

export const PTTK_COLORS = ['red', 'blue', 'green', 'yellow', 'black'] as const;
export type PttkColor = (typeof PTTK_COLORS)[number];

export const TRAILHEAD_KINDS = ['parking', 'station', 'bus_stop', 'place', 'manual'] as const;
export type TrailheadKind = (typeof TRAILHEAD_KINDS)[number];

const PttkColorSchema = z.enum(PTTK_COLORS);
const TrailheadKindSchema = z.enum(TRAILHEAD_KINDS);

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

export const PeakSummarySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  range: z.string().min(1),
  elevation: z.number().int(),
  lat: latitude,
  lon: longitude,
  routeCount: z.number().int().min(0).max(20),
});
export type PeakSummary = z.infer<typeof PeakSummarySchema>;

export const PeaksIndexSchema = z.object({
  generatedAt: z.iso.datetime(),
  peaks: z.array(PeakSummarySchema),
});
export type PeaksIndex = z.infer<typeof PeaksIndexSchema>;

/** `[lon, lat]` */
const PositionSchema = z.tuple([longitude, latitude]);
/** `[lon, lat, elevationM]` */
const PositionWithElevationSchema = z.tuple([longitude, latitude, z.number()]);

/** An OSM hiking relation a trail segment belongs to. */
export const TrailRelationSchema = z.object({
  id: z.int(),
  name: z.string().optional(),
  color: PttkColorSchema,
});
export type TrailRelation = z.infer<typeof TrailRelationSchema>;

export const TrailFeatureSchema = z.object({
  type: z.literal('Feature'),
  properties: z.object({
    colors: z.array(PttkColorSchema).min(1),
    name: z.string().optional(),
    relations: z.array(TrailRelationSchema).min(1),
  }),
  geometry: z.object({
    type: z.literal('LineString'),
    coordinates: z.array(PositionSchema),
  }),
});
export type TrailFeature = z.infer<typeof TrailFeatureSchema>;

export const LEG_COLORS = [...PTTK_COLORS, 'none'] as const;
export type LegColor = (typeof LEG_COLORS)[number];

/** A stretch of a route followed along one trail colour (`none`: unmarked path). */
export const LegSchema = z.object({
  color: z.enum(LEG_COLORS),
  lengthM: z.number().nonnegative(),
});
export type Leg = z.infer<typeof LegSchema>;

export const RouteSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+--[a-z0-9-]+$/),
  name: z.string().min(1),
  trailhead: z.object({
    name: z.string().min(1),
    lat: latitude,
    lon: longitude,
    kind: TrailheadKindSchema,
  }),
  distanceKm: z.number().nonnegative(),
  ascentM: z.number().nonnegative(),
  descentM: z.number().nonnegative(),
  durationMin: z.number().int().nonnegative(),
  colors: z.array(PttkColorSchema).min(1),
  /** The same stretches as `colors`, in order from the trailhead, with their length. */
  legs: z.array(LegSchema).min(1),
  geometry: z.object({
    type: z.literal('LineString'),
    coordinates: z.array(PositionWithElevationSchema),
  }),
  /** `[distanceM, elevationM]` pairs. */
  profile: z.array(z.tuple([z.number(), z.number()])).min(2),
});
export type Route = z.infer<typeof RouteSchema>;

export const PeakDetailSchema = z.object({
  peakId: z.string().regex(/^[a-z0-9-]+$/),
  trails: z.object({
    type: z.literal('FeatureCollection'),
    features: z.array(TrailFeatureSchema),
  }),
  routes: z.array(RouteSchema).max(20),
});
export type PeakDetail = z.infer<typeof PeakDetailSchema>;

/** The mountains as one MultiPolygon (outer rings counter-clockwise) and the area the map may show. */
export const MountainAreaSchema = z.object({
  areas: z.object({
    type: z.literal('MultiPolygon'),
    coordinates: z.array(z.array(z.array(PositionSchema).min(4)).min(1)).min(1),
  }),
  /** `[west, south, east, north]` */
  bounds: z
    .tuple([longitude, latitude, longitude, latitude])
    .refine(
      ([west, south, east, north]) => west < east && south < north,
      'bounds must have west < east and south < north',
    ),
});
export type MountainArea = z.infer<typeof MountainAreaSchema>;
