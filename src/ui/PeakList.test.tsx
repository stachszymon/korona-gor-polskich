import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fixture from '../test/fixtures/peaks.json';
import { PeaksIndexSchema } from '../data/schema';
import { emptyProgress } from '../progress/progress';
import { PeakList } from './PeakList';
import { ProgressCounter } from './ProgressCounter';

const peaks = PeaksIndexSchema.parse(fixture).peaks;
const progress = emptyProgress('2026-10-15T12:00:00.000Z');
const withDone = { ...progress, peaks: { rysy: { status: 'done' as const } } };

describe('PeakList', () => {
  it('clicking a list item calls onSelect with id', async () => {
    const onSelect = vi.fn();
    render(<PeakList peaks={peaks} progress={progress} selectedId={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: /Rysy/ }));
    expect(onSelect).toHaveBeenCalledWith('rysy');
  });

  it('shows filter selects with Polish labels', () => {
    render(<PeakList peaks={peaks} progress={progress} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByLabelText('Pasmo')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Sortuj')).toBeInTheDocument();
  });

  it('lists name, elevation and a status dot with the status colour', () => {
    render(<PeakList peaks={peaks} progress={withDone} selectedId="rysy" onSelect={() => {}} />);
    const item = screen.getByRole('button', { name: /Rysy/ });
    expect(item).toHaveTextContent('2499 m');
    expect(item).toHaveAttribute('aria-current', 'true');
    const dot = item.querySelector('[data-status]');
    expect(dot).toHaveAttribute('data-status', 'done');
    expect(dot).toHaveStyle({ backgroundColor: '#2e7d32' });
  });

  it('filters by range and sorts by name via the selects', async () => {
    render(<PeakList peaks={peaks} progress={progress} selectedId={null} onSelect={() => {}} />);
    await userEvent.selectOptions(screen.getByLabelText('Sortuj'), 'name');
    const names = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    const lysica = names.findIndex((n) => n.includes('Łysica'));
    expect(names[lysica - 1]).toContain('Lubomir');
    expect(names[lysica + 1]).toContain('Mogielica');

    await userEvent.selectOptions(screen.getByLabelText('Pasmo'), 'Tatry');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('filters by status', async () => {
    render(<PeakList peaks={peaks} progress={withDone} selectedId={null} onSelect={() => {}} />);
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'done');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('shows an empty-state message when nothing matches', async () => {
    render(<PeakList peaks={peaks} progress={progress} selectedId={null} onSelect={() => {}} />);
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'done');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText('Brak szczytów spełniających filtry')).toBeInTheDocument();
  });
});

describe('ProgressCounter', () => {
  it("counter shows '1 / 28'", () => {
    render(<ProgressCounter done={1} total={28} />);
    const el = screen.getByLabelText('Zdobyte szczyty: 1 z 28');
    expect(el).toHaveTextContent('1 / 28');
  });
});
