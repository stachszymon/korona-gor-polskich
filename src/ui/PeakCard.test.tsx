import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeakDetailSchema, type PeakSummary } from '../data/schema';
import { downloadText } from '../lib/download';
import type { PeakProgress } from '../progress/progress';
import babiaGora from '../test/fixtures/peaks/babia-gora.json';
import { PeakCard, type PeakCardProps } from './PeakCard';

vi.mock('../lib/download');

const detail = PeakDetailSchema.parse(babiaGora);
const peak: PeakSummary = {
  id: 'babia-gora',
  name: 'Babia Góra',
  range: 'Beskid Żywiecki',
  elevation: 1725,
  lat: 49.573,
  lon: 19.529,
  routeCount: 3,
};

function baseProps(overrides: Partial<PeakCardProps> = {}): PeakCardProps {
  return {
    peak,
    detailStatus: 'ready',
    detail,
    entry: null,
    selectedRouteId: null,
    onSelectRoute: vi.fn(),
    onStatusChange: vi.fn(),
    onRetry: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

function renderCard(overrides: Partial<PeakCardProps> = {}) {
  const props = baseProps(overrides);
  render(<PeakCard {...props} />);
  return props;
}

describe('PeakCard', () => {
  beforeEach(() => {
    vi.mocked(downloadText).mockClear();
  });

  it('shows name, elevation and range', () => {
    renderCard();
    expect(screen.getByRole('heading', { name: 'Babia Góra' })).toBeInTheDocument();
    expect(screen.getByText(/1725 m n\.p\.m\./)).toBeInTheDocument();
    expect(screen.getByText(/Beskid Żywiecki/)).toBeInTheDocument();
  });

  it('shows three routes with one-way (to the summit) distance, ascent and duration', () => {
    renderCard();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(screen.getByRole('button', { name: /Z Zawoi Markowej/ })).toBeInTheDocument();
    const first = items.at(0) as HTMLElement;
    expect(within(first).getByText('Start: Zawoja Markowa')).toBeInTheDocument();
    expect(within(first).getByText('7,4 km na szczyt')).toBeInTheDocument();
    expect(within(first).getByText('↑ 980 m')).toBeInTheDocument();
    expect(within(first).getByText('ok. 3 h 30 min na szczyt (szacunkowo)')).toBeInTheDocument();
    expect(first.querySelectorAll('.route-list__stripe')).toHaveLength(2);
  });

  it('clicking a route calls onSelectRoute', async () => {
    const props = renderCard();
    await userEvent.click(screen.getByRole('button', { name: /Z Zawoi Policznego/ }));
    expect(props.onSelectRoute).toHaveBeenCalledWith('babia-gora--zawoja-policzne');
  });

  it('selected route has aria-pressed and a GPX button', () => {
    renderCard({ selectedRouteId: 'babia-gora--korbielow' });
    expect(screen.getByRole('button', { name: /Z Korbielowa/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Z Zawoi Markowej/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByRole('button', { name: 'Pobierz GPX' })).toHaveLength(1);
  });

  it("Pobierz GPX downloads '<route-id>.gpx'", async () => {
    renderCard({ selectedRouteId: 'babia-gora--korbielow' });
    await userEvent.click(screen.getByRole('button', { name: 'Pobierz GPX' }));
    expect(downloadText).toHaveBeenCalledTimes(1);
    const [filename, content, mime] = vi.mocked(downloadText).mock.calls.at(0) as [string, string, string];
    expect(filename).toBe('babia-gora--korbielow.gpx');
    expect(content).toContain('<gpx');
    expect(mime).toBe('application/gpx+xml');
  });

  it('shows a message when there are no routes', () => {
    renderCard({ detail: { ...detail, routes: [] } });
    expect(screen.getByText('Brak gotowych tras dla tego szczytu')).toBeInTheDocument();
  });

  it('shows a loading message', () => {
    renderCard({ detailStatus: 'loading', detail: null });
    expect(screen.getByText('Wczytywanie tras…')).toBeInTheDocument();
  });

  it('error state shows retry button', async () => {
    const props = renderCard({ detailStatus: 'error', detail: null });
    expect(screen.getByText('Nie udało się wczytać tras.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it('close button calls onClose', async () => {
    const props = renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Zamknij' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  describe('status', () => {
    it('Zdobyty with date and note calls onStatusChange({status:done, date, note})', async () => {
      const props = renderCard();
      await userEvent.click(screen.getByRole('button', { name: 'Zdobyty' }));
      expect(props.onStatusChange).toHaveBeenLastCalledWith({ status: 'done' });
      const date = screen.getByLabelText('Data');
      expect(date).toHaveAttribute('type', 'date');
      await userEvent.type(date, '2026-08-15');
      await userEvent.type(screen.getByLabelText('Notatka'), 'Piękna pogoda');
      expect(props.onStatusChange).toHaveBeenLastCalledWith({
        status: 'done',
        date: '2026-08-15',
        note: 'Piękna pogoda',
      });
    });

    it('note field is limited to 500 characters', () => {
      renderCard({ entry: { status: 'done' } });
      expect(screen.getByLabelText('Notatka')).toHaveAttribute('maxlength', '500');
    });

    it('Planuję shows planned date field without note', async () => {
      const props = renderCard();
      await userEvent.click(screen.getByRole('button', { name: 'Planuję' }));
      expect(props.onStatusChange).toHaveBeenLastCalledWith({ status: 'planned' });
      expect(screen.getByLabelText('Planowana data')).toHaveAttribute('type', 'date');
      expect(screen.queryByLabelText('Notatka')).not.toBeInTheDocument();
      await userEvent.type(screen.getByLabelText('Planowana data'), '2027-06-01');
      expect(props.onStatusChange).toHaveBeenLastCalledWith({ status: 'planned', date: '2027-06-01' });
    });

    it('Wyczyść calls onStatusChange(null)', async () => {
      const props = renderCard({ entry: { status: 'done', date: '2026-08-15', note: 'x' } });
      await userEvent.click(screen.getByRole('button', { name: 'Wyczyść' }));
      expect(props.onStatusChange).toHaveBeenCalledWith(null);
      expect(screen.queryByLabelText('Data')).not.toBeInTheDocument();
    });

    it('prefills fields from the stored entry', () => {
      renderCard({ entry: { status: 'done', date: '2026-08-15', note: 'Mgła' } });
      expect(screen.getByRole('button', { name: 'Zdobyty' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByLabelText('Data')).toHaveValue('2026-08-15');
      expect(screen.getByLabelText('Notatka')).toHaveValue('Mgła');
    });

    it('follows the entry prop when it changes', () => {
      const props = baseProps({ entry: { status: 'done', note: 'a' } });
      const { rerender } = render(<PeakCard {...props} />);
      const next: PeakProgress = { status: 'planned', date: '2027-01-01' };
      rerender(<PeakCard {...props} entry={next} />);
      expect(screen.getByLabelText('Planowana data')).toHaveValue('2027-01-01');
    });

    it('renders note as text, not HTML', () => {
      const note = '<img src=x onerror=alert(1)><b>bold</b>';
      const { container } = render(<PeakCard {...baseProps({ entry: { status: 'done', note } })} />);
      expect(screen.getByLabelText('Notatka')).toHaveValue(note);
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('b')).toBeNull();
    });
  });
});
