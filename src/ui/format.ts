/** `210` → `"ok. 3 h 30 min"`, `45` → `"ok. 45 min"`, `120` → `"ok. 2 h"`. */
export function formatDuration(min: number): string {
  const total = Math.round(min);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `ok. ${minutes} min`;
  if (minutes === 0) return `ok. ${hours} h`;
  return `ok. ${hours} h ${minutes} min`;
}

/** `7.4` → `"7,4 km"`; whole numbers have no decimals. */
export function formatDistance(km: number): string {
  const rounded = Math.round(km * 10) / 10;
  return `${String(rounded).replace('.', ',')} km`;
}

/** `980` → `"↑ 980 m"`. */
export function formatAscent(m: number): string {
  return `↑ ${Math.round(m)} m`;
}
