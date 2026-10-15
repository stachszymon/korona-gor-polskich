import { fireEvent, render, screen } from '@testing-library/react';
import { ElevationProfile } from './ElevationProfile';

const profile: [number, number][] = [
  [0, 800],
  [100, 900],
  [200, 1000],
  [300, 1100],
  [400, 1200],
];

function renderProfile(onHover = vi.fn()) {
  render(<ElevationProfile profile={profile} onHover={onHover} />);
  const svg = screen.getByRole('img', { name: /profil wysokości/i });
  svg.getBoundingClientRect = () =>
    ({ left: 10, top: 0, width: 400, height: 100, right: 410, bottom: 100, x: 10, y: 0, toJSON() {} }) as DOMRect;
  return { svg, onHover };
}

describe('ElevationProfile', () => {
  it('pointer at 50% width reports middle index', () => {
    const { svg, onHover } = renderProfile();
    fireEvent.pointerMove(svg, { clientX: 210 });
    expect(onHover).toHaveBeenLastCalledWith(2);
  });

  it('clamps to the first and last index outside the plot', () => {
    const { svg, onHover } = renderProfile();
    fireEvent.pointerMove(svg, { clientX: -50 });
    expect(onHover).toHaveBeenLastCalledWith(0);
    fireEvent.pointerMove(svg, { clientX: 900 });
    expect(onHover).toHaveBeenLastCalledWith(4);
  });

  it('pointerleave reports null', () => {
    const { svg, onHover } = renderProfile();
    fireEvent.pointerLeave(svg);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it('renders axis labels outside the stretched SVG so the text is not distorted', () => {
    const { svg } = renderProfile();
    expect(svg.querySelector('text')).toBeNull();
    expect(svg.contains(screen.getByText('800 m'))).toBe(false);
  });

  it('shows the elevation axis range', () => {
    renderProfile();
    expect(screen.getByText('800 m')).toBeInTheDocument();
    expect(screen.getByText('1200 m')).toBeInTheDocument();
  });
});
