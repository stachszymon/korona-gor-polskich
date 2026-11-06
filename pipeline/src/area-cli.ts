import { fileURLToPath } from 'node:url';
import { writeMountainArea } from './area';

const outDir = fileURLToPath(new URL('../../public/data', import.meta.url));
const area = await writeMountainArea(outDir);
console.log(
  `wrote ${outDir}/mountain-area.json: ${area.areas.coordinates.length} polygons, bounds ${area.bounds.join(', ')}`,
);
