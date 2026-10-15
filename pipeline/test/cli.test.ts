import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../src/cli';

describe('parseCliArgs', () => {
  it('defaults to Overpass without a cache', () => {
    expect(parseCliArgs([])).toEqual({ source: 'overpass' });
  });

  it('reads --cache=<dir>', () => {
    expect(parseCliArgs(['--cache=.superpowers/osm-cache'])).toEqual({
      source: 'overpass',
      cacheDir: '.superpowers/osm-cache',
    });
  });

  it('reads --source=osm-api', () => {
    expect(parseCliArgs(['--source=osm-api'])).toEqual({ source: 'osm-api' });
    expect(() => parseCliArgs(['--source=overpas'])).toThrow('--source must be "overpass" or "osm-api"');
  });

  it('rejects unknown arguments', () => {
    expect(() => parseCliArgs(['--cahce=x'])).toThrow('unknown argument "--cahce=x"');
    expect(() => parseCliArgs(['--cache='])).toThrow('--cache needs a directory');
  });
});
