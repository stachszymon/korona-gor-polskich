// Generates e2e/fixtures/flat-tile.png: a 256x256 terrarium tile for 0 m (r=128, g=0, b=0).
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const png = new PNG({ width: 256, height: 256 });
for (let i = 0; i < png.data.length; i += 4) {
  png.data[i] = 128;
  png.data[i + 1] = 0;
  png.data[i + 2] = 0;
  png.data[i + 3] = 255;
}
writeFileSync(new URL('./flat-tile.png', import.meta.url), PNG.sync.write(png));
