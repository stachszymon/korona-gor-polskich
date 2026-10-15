import { supportsWebGL } from './webgl';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('supportsWebGL', () => {
  it('is true when a webgl2 context can be created', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) =>
      type === 'webgl2' ? {} : null) as HTMLCanvasElement['getContext']);
    expect(supportsWebGL()).toBe(true);
  });

  it('is false when no context can be created', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(supportsWebGL()).toBe(false);
  });

  it('is false when creating the context throws', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(supportsWebGL()).toBe(false);
  });
});
