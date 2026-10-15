import { formatAscent, formatDistance, formatDuration } from './format';

describe('format', () => {
  it('formatDuration', () => {
    expect(formatDuration(210)).toBe('ok. 3 h 30 min');
    expect(formatDuration(45)).toBe('ok. 45 min');
    expect(formatDuration(120)).toBe('ok. 2 h');
  });

  it('formatDistance uses a decimal comma', () => {
    expect(formatDistance(7.4)).toBe('7,4 km');
    expect(formatDistance(10)).toBe('10 km');
  });

  it('formatAscent', () => {
    expect(formatAscent(980)).toBe('↑ 980 m');
    expect(formatAscent(979.6)).toBe('↑ 980 m');
  });
});
