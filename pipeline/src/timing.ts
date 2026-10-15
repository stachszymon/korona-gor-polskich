const round5 = (minutes: number): number => Math.round(minutes / 5) * 5;

/**
 * Estimated hiking time in minutes: 4 km/h horizontally plus 600 m/h of ascent,
 * rounded to the nearest 5 minutes.
 */
export function estimateDurationMin(distanceKm: number, ascentM: number): number {
  return round5((distanceKm / 4 + ascentM / 600) * 60);
}
