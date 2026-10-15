import { describe, expect, it } from 'vitest';
import { trailColor } from '../src/osmc';

describe('trailColor', () => {
  it('takes the first part of osmc:symbol', () => {
    expect(trailColor({ 'osmc:symbol': 'red:white:red_bar' })).toBe('red');
  });

  it('falls back to the colour tag, case-insensitively', () => {
    expect(trailColor({ colour: 'Blue' })).toBe('blue');
  });

  it('prefers osmc:symbol over colour', () => {
    expect(trailColor({ 'osmc:symbol': 'green:white:green_bar', colour: 'red' })).toBe('green');
  });

  it('returns null for colors outside the PTTK palette', () => {
    expect(trailColor({ 'osmc:symbol': 'purple:white:purple_bar' })).toBeNull();
    expect(trailColor({ 'osmc:symbol': 'white:white::LOOP:black' })).toBeNull();
  });

  it('returns null when there is no color information', () => {
    expect(trailColor({})).toBeNull();
    expect(trailColor({ name: 'Szlak' })).toBeNull();
  });
});
