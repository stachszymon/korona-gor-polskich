import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

// No test may reach the network: every external request is answered locally or aborted.
test.beforeEach(async ({ page, baseURL }) => {
  // CI runners render WebGL in software, and the 3D terrain map then starves the main thread so
  // badly that clicks and reloads time out. These tests cover the list/card/progress UI, which is
  // independent of the map, so they run against the app's own no-WebGL fallback.
  await page.addInitScript(`{
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return String(type).startsWith('webgl') ? null : getContext.call(this, type, ...args);
    };
  }`);

  const origin = new URL(baseURL ?? 'http://localhost').origin;
  const styleJson = await readFile(fixture('style.json'));
  const flatTile = await readFile(fixture('flat-tile.png'));

  await page.route(
    (url) => url.origin !== origin,
    (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'tiles.openfreemap.org') {
        if (url.pathname.startsWith('/styles/')) {
          return route.fulfill({ status: 200, contentType: 'application/json', body: styleJson });
        }
        // Vector tiles, glyphs and sprites.
        return route.fulfill({ status: 204 });
      }
      if (url.hostname.includes('elevation-tiles-prod')) {
        return route.fulfill({ status: 200, contentType: 'image/png', body: flatTile });
      }
      return route.abort();
    },
  );
});

async function openApp(page: Page) {
  await page.goto('./');
  await expect(page.getByRole('button', { name: /^Babia Góra/ })).toBeVisible();
}

async function openBabiaGora(page: Page) {
  await openApp(page);
  await page.getByRole('button', { name: /^Babia Góra/ }).click();
  const card = page.getByRole('article', { name: 'Babia Góra' });
  await expect(card).toBeVisible();
  return card;
}

test('clicking Babia Góra in the list opens its card with at least one route', async ({ page }) => {
  const card = await openBabiaGora(page);

  await expect(page.getByText('Twoja przeglądarka nie obsługuje mapy 3D')).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Babia Góra' })).toBeVisible();
  const routes = card.getByRole('region', { name: 'Trasy' }).getByRole('button', { pressed: false });
  await expect(routes.first()).toBeVisible();
  expect(await routes.count()).toBeGreaterThanOrEqual(1);
});

test("marking Babia Góra as done survives reload and the counter shows '1 / 28'", async ({ page }) => {
  const card = await openBabiaGora(page);
  await expect(page.getByText('0 / 28')).toBeVisible();

  await card.getByRole('button', { name: 'Zdobyty' }).click();
  await expect(card.getByRole('button', { name: 'Zdobyty' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('1 / 28')).toBeVisible();

  await page.reload();
  await expect(page.getByText('1 / 28')).toBeVisible();
  await page.getByRole('button', { name: /^Babia Góra/ }).click();
  await expect(
    page.getByRole('article', { name: 'Babia Góra' }).getByRole('button', { name: 'Zdobyty' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('export then import restores the same progress', async ({ page }) => {
  const card = await openBabiaGora(page);
  await card.getByRole('button', { name: 'Zdobyty' }).click();
  await expect(page.getByText('1 / 28')).toBeVisible();

  await page.getByRole('button', { name: 'Mój postęp' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Eksportuj' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^kgp-postep-\d{4}-\d{2}-\d{2}\.json$/);
  const exportedPath = await download.path();

  // Wipe the stored progress, then restore it from the exported file.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByText('0 / 28')).toBeVisible();

  await page.getByRole('button', { name: 'Mój postęp' }).click();
  await page.getByLabel('Plik postępu').setInputFiles(exportedPath);
  await expect(page.getByText(/nadpisze obecny postęp/)).toBeVisible();
  await page.getByRole('button', { name: 'Zastąp' }).click();
  await expect(page.getByText('1 / 28')).toBeVisible();

  await page.reload();
  await expect(page.getByText('1 / 28')).toBeVisible();
});

test('Pobierz GPX downloads a file named babia-gora--*.gpx', async ({ page }) => {
  const card = await openBabiaGora(page);
  const routes = card.getByRole('region', { name: 'Trasy' }).getByRole('button', { pressed: false });
  await routes.first().click();
  await expect(card.getByRole('region', { name: 'Trasy' }).getByRole('button', { pressed: true })).toHaveCount(1);

  const downloadPromise = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Pobierz GPX' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^babia-gora--.+\.gpx$/);

  const path = await download.path();
  const content = await readFile(path, 'utf8');
  expect(content).toContain('<gpx');
});

test('at 360 px width the page has no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openApp(page);

  const scrollWidth = await page.locator('html').evaluate((el) => el.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(360);

  // Still true with a peak card (and its route list) open.
  await page.getByRole('button', { name: /^Babia Góra/ }).click();
  await expect(page.getByRole('article', { name: 'Babia Góra' })).toBeVisible();
  expect(await page.locator('html').evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(360);
});
