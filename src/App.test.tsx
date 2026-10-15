import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { PeakDetailSchema } from './data/schema';
import { STORAGE_KEY } from './progress/progress';
import babiaGora from './test/fixtures/peaks/babia-gora.json';
import peaksIndex from './test/fixtures/peaks.json';

vi.mock('./map/MapView', () => ({
  MapView: (props: {
    cursor: [number, number] | null;
    onPeakClick(id: string): void;
    onTileError(): void;
  }) => (
    <div data-testid="map" data-cursor={JSON.stringify(props.cursor)}>
      <button type="button" onClick={() => props.onPeakClick('babia-gora')}>
        marker Babia Góra
      </button>
      <button type="button" onClick={props.onTileError}>
        simulate tile error
      </button>
    </div>
  ),
}));

vi.mock('./ui/ElevationProfile', () => ({
  ElevationProfile: (props: { onHover(index: number | null): void }) => (
    <button type="button" onClick={() => props.onHover(1)}>
      hover profile
    </button>
  ),
}));

const route = PeakDetailSchema.parse(babiaGora).routes[0]!;

function json(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as Response;
}

function makeFetch(detail: unknown = babiaGora): typeof fetch {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('data/peaks.json')) return Promise.resolve(json(peaksIndex));
    if (url.endsWith('data/peaks/babia-gora.json')) return Promise.resolve(json(detail));
    return Promise.resolve(json({}, false));
  }) as unknown as typeof fetch;
}

function renderApp(deps: NonNullable<Parameters<typeof App>[0]['deps']> = {}) {
  const user = userEvent.setup();
  render(<App deps={{ fetchFn: makeFetch(), supportsWebGL: () => false, ...deps }} />);
  return { user };
}

function storedProgress() {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === null ? null : (JSON.parse(raw) as { peaks: Record<string, { status: string; note?: string }> });
}

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('selecting a peak from the list opens its card with routes', async () => {
    const { user } = renderApp();
    const list = await screen.findByRole('region', { name: 'Lista szczytów' });
    await user.click(within(list).getByRole('button', { name: /Babia Góra/ }));

    const card = await screen.findByRole('article', { name: 'Babia Góra' });
    expect(await within(card).findByRole('button', { name: /Z Zawoi Markowej/ })).toBeInTheDocument();
  });

  it("marking a peak as done updates the counter to '1 / 28'", async () => {
    const { user } = renderApp();
    expect(await screen.findByText('0 / 28')).toBeInTheDocument();
    const list = await screen.findByRole('region', { name: 'Lista szczytów' });
    await user.click(within(list).getByRole('button', { name: /Babia Góra/ }));
    await user.click(await screen.findByRole('button', { name: 'Zdobyty' }));

    expect(screen.getByText('1 / 28')).toBeInTheDocument();
    expect(storedProgress()?.peaks['babia-gora']?.status).toBe('done');
  });

  it('persists note edits after a short delay and flushes them when the card closes', async () => {
    const { user } = renderApp();
    const list = await screen.findByRole('region', { name: 'Lista szczytów' });
    await user.click(within(list).getByRole('button', { name: /Babia Góra/ }));
    await user.click(await screen.findByRole('button', { name: 'Zdobyty' }));

    await user.type(screen.getByLabelText('Notatka'), 'Mgła');
    expect(storedProgress()?.peaks['babia-gora']?.note).toBeUndefined();
    await waitFor(() => expect(storedProgress()?.peaks['babia-gora']?.note).toBe('Mgła'), { timeout: 2000 });

    await user.type(screen.getByLabelText('Notatka'), '!');
    await user.click(screen.getByRole('button', { name: 'Zamknij' }));
    expect(storedProgress()?.peaks['babia-gora']?.note).toBe('Mgła!');
  });

  it('shows storage banner when storage is null', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    renderApp();
    expect(await screen.findByText('Postęp nie zostanie zapisany w tej przeglądarce')).toBeInTheDocument();
  });

  it('shows no storage banner when storage works', async () => {
    renderApp();
    await screen.findByRole('region', { name: 'Lista szczytów' });
    expect(screen.queryByText('Postęp nie zostanie zapisany w tej przeglądarce')).not.toBeInTheDocument();
  });

  it('shows corrupt banner when stored progress is invalid JSON', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    renderApp();
    expect(
      await screen.findByText('Zapisany postęp był uszkodzony. Zachowaliśmy jego kopię i zaczynamy od nowa.'),
    ).toBeInTheDocument();
  });

  it('shows no-WebGL message and still lists peaks', async () => {
    renderApp({ supportsWebGL: () => false });
    expect(screen.getByText('Twoja przeglądarka nie obsługuje mapy 3D')).toBeInTheDocument();
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();
    const list = await screen.findByRole('region', { name: 'Lista szczytów' });
    expect(within(list).getByRole('button', { name: /Rysy/ })).toBeInTheDocument();
  });

  it('index load failure shows retry which reloads', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValue(json(peaksIndex));
    const { user } = renderApp({ fetchFn });

    expect(await screen.findByText('Nie udało się wczytać listy szczytów.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));

    expect(await screen.findByRole('region', { name: 'Lista szczytów' })).toBeInTheDocument();
    expect(screen.queryByText('Nie udało się wczytać listy szczytów.')).not.toBeInTheDocument();
  });

  it('renders the map and selects a peak from a map marker', async () => {
    const { user } = renderApp({ supportsWebGL: () => true });
    await screen.findByRole('region', { name: 'Lista szczytów' });
    expect(screen.queryByText('Twoja przeglądarka nie obsługuje mapy 3D')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'marker Babia Góra' }));
    expect(await screen.findByRole('article', { name: 'Babia Góra' })).toBeInTheDocument();
  });

  it('shows a dismissible banner when map tiles fail', async () => {
    const { user } = renderApp({ supportsWebGL: () => true });
    await screen.findByRole('region', { name: 'Lista szczytów' });
    await user.click(screen.getByRole('button', { name: 'simulate tile error' }));

    const banner = screen.getByText('Część mapy nie wczytała się').closest('[role="status"]') as HTMLElement;
    await user.click(within(banner).getByRole('button', { name: 'Zamknij' }));
    expect(screen.queryByText('Część mapy nie wczytała się')).not.toBeInTheDocument();
  });

  it('shows the elevation profile for a selected route and moves the map cursor', async () => {
    const { user } = renderApp({ supportsWebGL: () => true });
    await screen.findByRole('region', { name: 'Lista szczytów' });
    await user.click(screen.getByRole('button', { name: 'marker Babia Góra' }));
    expect(screen.queryByRole('button', { name: 'hover profile' })).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: /Z Zawoi Markowej/ }));
    expect(screen.getByTestId('map')).toHaveAttribute('data-cursor', 'null');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'hover profile' }));
    });
    const [lon, lat] = route.geometry.coordinates[1]!;
    const cursor = JSON.parse(screen.getByTestId('map').getAttribute('data-cursor') ?? 'null') as [number, number];
    expect(cursor[0]).toBeCloseTo(lon, 4);
    expect(cursor[1]).toBeCloseTo(lat, 4);
  });

  it('places the cursor by distance when profile and geometry have different point counts', async () => {
    // Simplified geometry (3 vertices, evenly spaced) against a profile with a point every 100 m.
    const detail = structuredClone(babiaGora);
    const first = detail.routes[0]!;
    first.geometry.coordinates = [
      [19.0, 49.0, 800],
      [19.1, 49.0, 900],
      [19.2, 49.0, 1000],
    ];
    first.profile = [
      [0, 800],
      [100, 850],
      [200, 900],
      [300, 950],
      [400, 1000],
    ];
    const { user } = renderApp({ supportsWebGL: () => true, fetchFn: makeFetch(detail) });
    await screen.findByRole('region', { name: 'Lista szczytów' });
    await user.click(screen.getByRole('button', { name: 'marker Babia Góra' }));
    await user.click(await screen.findByRole('button', { name: /Z Zawoi Markowej/ }));

    // The mocked profile reports index 1: 100 m of 400 m, a quarter of the way along the geometry.
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'hover profile' }));
    });
    const [lon, lat] = JSON.parse(screen.getByTestId('map').getAttribute('data-cursor') ?? 'null') as [number, number];
    expect(lon).toBeCloseTo(19.05, 4);
    expect(lat).toBeCloseTo(49.0, 4);
  });
});
