const LINKS = [
  { href: 'https://www.openstreetmap.org/copyright', label: '© autorzy OpenStreetMap' },
  { href: 'https://openfreemap.org', label: 'OpenFreeMap' },
  { href: 'https://www.openmaptiles.org', label: 'OpenMapTiles' },
  { href: 'https://registry.opendata.aws/terrain-tiles/', label: 'Dane wysokościowe: AWS Terrain Tiles' },
];

export function Footer() {
  return (
    <footer className="footer">
      <ul className="footer__links">
        {LINKS.map(({ href, label }) => (
          <li key={href}>
            <a href={href} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </footer>
  );
}
