import { plural } from './plural';

const form = (n: number) => plural(n, 'zdobyty', 'zdobyte', 'zdobytych');

describe('plural', () => {
  it('uses the singular form for 1', () => {
    expect(form(1)).toBe('zdobyty');
  });

  it('uses the few form for 2-4', () => {
    expect(form(2)).toBe('zdobyte');
    expect(form(3)).toBe('zdobyte');
    expect(form(4)).toBe('zdobyte');
  });

  it('uses the many form for 0 and 5-9', () => {
    expect(form(0)).toBe('zdobytych');
    expect(form(5)).toBe('zdobytych');
    expect(form(9)).toBe('zdobytych');
  });

  it('uses the many form for 11-14 and teens', () => {
    expect(form(11)).toBe('zdobytych');
    expect(form(12)).toBe('zdobytych');
    expect(form(13)).toBe('zdobytych');
    expect(form(14)).toBe('zdobytych');
    expect(form(15)).toBe('zdobytych');
  });

  it('applies the last-digit rule above 20', () => {
    expect(form(22)).toBe('zdobyte');
    expect(form(24)).toBe('zdobyte');
    expect(form(25)).toBe('zdobytych');
    expect(form(112)).toBe('zdobytych');
    expect(form(122)).toBe('zdobyte');
  });

  it('uses the many form for 21 and 101, which are not singular', () => {
    expect(form(21)).toBe('zdobytych');
    expect(form(101)).toBe('zdobytych');
  });
});
