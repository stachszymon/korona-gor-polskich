import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadText } from './download';

const BLOB_URL = 'blob:korona-test';

describe('downloadText', () => {
  let originalCreate: typeof URL.createObjectURL | undefined;
  let originalRevoke: typeof URL.revokeObjectURL | undefined;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    createObjectURL = vi.fn(() => BLOB_URL);
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    URL.createObjectURL = originalCreate as typeof URL.createObjectURL;
    URL.revokeObjectURL = originalRevoke as typeof URL.revokeObjectURL;
  });

  it('clicks an anchor with the given download filename and defers revoke until after the click', () => {
    const clickedAnchors: HTMLAnchorElement[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clickedAnchors.push(this);
      });

    downloadText('babia-gora--zawoja-markowa.gpx', '<gpx/>', 'application/gpx+xml');

    expect(click).toHaveBeenCalledTimes(1);
    expect(clickedAnchors).toHaveLength(1);
    expect(clickedAnchors[0]?.download).toBe('babia-gora--zawoja-markowa.gpx');
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    // Revoking synchronously after click can cancel the download in some browsers.
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.runAllTimers();

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith(BLOB_URL);
  });

  it('removes the temporary anchor from the document', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadText('a.gpx', 'x', 'application/gpx+xml');
    vi.runAllTimers();

    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });
});
