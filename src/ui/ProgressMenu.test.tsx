import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { downloadText } from '../lib/download';
import type { Progress } from '../progress/progress';
import { ProgressMenu, type ProgressMenuProps } from './ProgressMenu';

vi.mock('../lib/download');

const current: Progress = {
  version: 1,
  updatedAt: '2026-10-01T10:00:00.000Z',
  peaks: { rysy: { status: 'done', date: '2026-08-14' } },
};

const imported: Progress = {
  version: 1,
  updatedAt: '2026-10-10T10:00:00.000Z',
  peaks: {
    rysy: { status: 'done' },
    sniezka: { status: 'done' },
    'babia-gora': { status: 'planned' },
    'nieznany-szczyt': { status: 'done' },
  },
};

function file(content: string): File {
  return new File([content], 'postep.json', { type: 'application/json' });
}

function setup(overrides: Partial<ProgressMenuProps> = {}) {
  const props: ProgressMenuProps = {
    progress: current,
    knownPeakIds: new Set(['rysy', 'sniezka', 'babia-gora']),
    onReplace: vi.fn(),
    now: () => new Date(2026, 9, 15),
    ...overrides,
  };
  const user = userEvent.setup();
  render(<ProgressMenu {...props} />);
  return { props, user };
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Mój postęp' }));
}

describe('ProgressMenu', () => {
  beforeEach(() => {
    vi.mocked(downloadText).mockClear();
  });

  it('exports the current progress as a dated JSON file', async () => {
    const { user } = setup();
    await openMenu(user);
    await user.click(screen.getByRole('button', { name: 'Eksportuj' }));

    expect(downloadText).toHaveBeenCalledTimes(1);
    const [filename, content, mime] = vi.mocked(downloadText).mock.calls[0] as [string, string, string];
    expect(filename).toBe('kgp-postep-2026-10-15.json');
    expect(JSON.parse(content)).toEqual(current);
    expect(mime).toBe('application/json');
  });

  it("import shows summary and only replaces progress after 'Zastąp'", async () => {
    const { props, user } = setup();
    await openMenu(user);
    await user.upload(screen.getByLabelText('Plik postępu'), file(JSON.stringify(imported)));

    expect(
      await screen.findByText(/2 zdobyte, 1 planowany, nadpisze obecny postęp, pominięto 1 nieznany szczyt/),
    ).toBeInTheDocument();
    expect(props.onReplace).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Zastąp' }));
    expect(props.onReplace).toHaveBeenCalledTimes(1);
    const replaced = vi.mocked(props.onReplace).mock.calls[0]?.[0] as Progress;
    expect(Object.keys(replaced.peaks).sort()).toEqual(['babia-gora', 'rysy', 'sniezka']);
    expect(screen.queryByRole('button', { name: 'Zastąp' })).not.toBeInTheDocument();
  });

  it("'Anuluj' leaves progress unchanged", async () => {
    const { props, user } = setup();
    await openMenu(user);
    await user.upload(screen.getByLabelText('Plik postępu'), file(JSON.stringify(imported)));
    await screen.findByRole('button', { name: 'Zastąp' });

    await user.click(screen.getByRole('button', { name: 'Anuluj' }));
    expect(props.onReplace).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Zastąp' })).not.toBeInTheDocument();
  });

  it('invalid file shows error message', async () => {
    const { props, user } = setup();
    await openMenu(user);
    await user.upload(screen.getByLabelText('Plik postępu'), file('to nie jest json'));

    expect(await screen.findByRole('alert')).toHaveTextContent('To nie jest poprawny plik postępu');
    expect(screen.queryByRole('button', { name: 'Zastąp' })).not.toBeInTheDocument();
    expect(props.onReplace).not.toHaveBeenCalled();
  });

  it('a file from a newer app version shows that reason', async () => {
    const { user } = setup();
    await openMenu(user);
    await user.upload(
      screen.getByLabelText('Plik postępu'),
      file(JSON.stringify({ version: 2, updatedAt: '2026-10-10T10:00:00.000Z', peaks: {} })),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Plik pochodzi z nowszej wersji aplikacji');
  });

  it('disables import until the peak list is known', async () => {
    const { user } = setup({ knownPeakIds: new Set() });
    await openMenu(user);
    expect(screen.getByRole('button', { name: 'Importuj' })).toBeDisabled();
  });
});
