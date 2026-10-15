import { describe, expect, it } from 'vitest';
import type { Route } from '../data/schema';
import { gpxFilename, routeToGpx } from './gpx';

const baseRoute: Route = {
  id: 'babia-gora--zawoja-markowa',
  name: 'Z Zawoi Markowej',
  trailhead: { name: 'Zawoja Markowa', lat: 49.6, lon: 19.5, kind: 'parking' },
  distanceKm: 7.4,
  ascentM: 980,
  descentM: 40,
  durationMin: 210,
  colors: ['red', 'yellow'],
  geometry: {
    type: 'LineString',
    coordinates: [
      [19.5, 49.6, 870],
      [19.51, 49.61, 900],
      [19.52, 49.62, 1120],
    ],
  },
  profile: [
    [0, 870],
    [25, 872],
  ],
};

const parse = (xml: string): Document => new DOMParser().parseFromString(xml, 'application/xml');

describe('routeToGpx', () => {
  it('contains one trkpt per coordinate with ele', () => {
    const doc = parse(routeToGpx(baseRoute));
    const points = Array.from(doc.getElementsByTagName('trkpt'));

    expect(points).toHaveLength(3);
    expect(points[0]?.getAttribute('lat')).toBe('49.6');
    expect(points[0]?.getAttribute('lon')).toBe('19.5');
    expect(points[0]?.getElementsByTagName('ele')[0]?.textContent).toBe('870');
    expect(points[2]?.getAttribute('lat')).toBe('49.62');
    expect(points[2]?.getAttribute('lon')).toBe('19.52');
    expect(points[2]?.getElementsByTagName('ele')[0]?.textContent).toBe('1120');
  });

  it('writes the XML declaration, gpx root and a single track with a segment', () => {
    const xml = routeToGpx(baseRoute);

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(
      '<gpx version="1.1" creator="korona-gor-polskich" xmlns="http://www.topografix.com/GPX/1/1">',
    );
    expect(xml.match(/<trk>/g)).toHaveLength(1);
    expect(xml.match(/<trkseg>/g)).toHaveLength(1);
  });

  it('escapes & < > " \' in route name', () => {
    const xml = routeToGpx({ ...baseRoute, name: `Szlak "A" & <B> 'C'` });

    expect(xml).toContain('<name>Szlak &quot;A&quot; &amp; &lt;B&gt; &apos;C&apos;</name>');
  });

  it('output parses with DOMParser without parsererror and keeps \'Śnieżka\'', () => {
    const xml = routeToGpx({ ...baseRoute, name: 'Z Karpacza na Śnieżkę' });
    const doc = parse(xml);

    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(doc.getElementsByTagName('name')[0]?.textContent).toBe('Z Karpacza na Śnieżkę');
  });
});

describe('gpxFilename', () => {
  it("is 'babia-gora--zawoja-markowa.gpx'", () => {
    expect(gpxFilename(baseRoute)).toBe('babia-gora--zawoja-markowa.gpx');
  });
});
