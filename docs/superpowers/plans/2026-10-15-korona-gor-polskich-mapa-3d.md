# Korona Gór Polskich: mapa 3D i planer: plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publiczna statyczna strona z mapą 3D 28 szczytów KGP, szlakami PTTK, gotowymi trasami (profil, GPX) i zapisem postępu w przeglądarce.

**Architecture:** Jeden pakiet npm z dwiema częściami, które łączy tylko format plików w `public/data/` (schemat zod w `src/data/schema.ts`). `pipeline/` to uruchamiane ręcznie skrypty Node, które z Overpass i DEM generują dane. `src/` to aplikacja React z MapLibre, która te pliki tylko czyta. Po zadaniu 2 tor A (pipeline) i tor B (aplikacja) mogą iść równolegle. Testy aplikacji używają danych z fixture, aż zadanie 11 wygeneruje prawdziwe dane.

**Tech Stack:** Node 22, TypeScript (strict, ESM), Vite, React, maplibre-gl 6.x, maplibre-contour 0.1.x, zod 4, pngjs, @turf/simplify, tsx, Vitest + Testing Library + jsdom, Playwright, ESLint (typescript-eslint), GitHub Actions + GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-10-15-korona-gor-polskich-mapa-3d-design.md`

## Global Constraints

- Jeden `package.json` w katalogu głównym, `"type": "module"`, TypeScript `strict: true`. Node 22 (lokalnie v22.17.1).
- Zależności instalowane w najnowszej stabilnej wersji w momencie wykonania. maplibre-gl w głównej wersji 6.x. Bez innych zależności runtime niż: `react`, `react-dom`, `maplibre-gl`, `maplibre-contour`, `zod`. Pipeline dodatkowo: `pngjs`, `@turf/simplify` (devDependencies).
- Bez kluczy API. Źródła mają dokładnie te adresy:
  - styl: `https://tiles.openfreemap.org/styles/liberty`
  - DEM: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` (kodowanie `terrarium`)
  - Overpass, w tej kolejności: `https://overpass-api.de/api/interpreter`, `https://overpass.private.coffee/api/interpreter`, `https://overpass.kumi.systems/api/interpreter`
- Każde żądanie pipeline'u wysyła nagłówek `User-Agent: korona-gor-polskich/0.1 (+https://github.com/<owner>/korona-gor-polskich)`. Bez niego Overpass zwraca 406.
- Kolory PTTK: `red #d32f2f`, `blue #1565c0`, `green #2e7d32`, `yellow #f9a825`, `black #212121`.
- Kolory statusów: zdobyty `#2e7d32`, planowany `#f9a825`, do zdobycia `#c62828`.
- Klucz `localStorage`: `kgp.progress`. Kopia uszkodzonych danych: `kgp.progress.corrupt-<timestamp>`.
- Teksty interfejsu tylko po polsku. Identyfikatory w kodzie, nazwy plików i commity po angielsku. Bez wzmianek o AI w commitach i PR.
- Testy nigdy nie korzystają z sieci. Pipeline działa na `pipeline/fixtures/`, aplikacja na `src/test/fixtures/`, a E2E przechwytuje żądania zewnętrzne.
- Vite `base`: `/korona-gor-polskich/`. Dane wczytywane z `${import.meta.env.BASE_URL}data/...`.
- Komendy: `npm run lint`, `npm run typecheck`, `npm test` (Vitest, jednorazowo), `npm run build`, `npm run e2e`, `npm run data:build`, `npm run data:lookup-peaks`.

## Review Focus

1. **Wyścig przy szybkim przełączaniu szczytów:** użytkownik klika szczyt A, a potem B, zanim przyjdzie plik A. Karta i mapa muszą pokazać B, a spóźniona odpowiedź A jest ignorowana. Test w zadaniu 14.
2. **Znaki specjalne w GPX:** nazwa trasy z `&`, `<` lub cudzysłowem albo z polskimi znakami musi dać poprawny XML w UTF-8. Test w zadaniu 13.
3. **Próbkowanie DEM na granicy kafla:** punkt w ostatnim pikselu kafla (interpolacja potrzebuje sąsiedniego kafla) musi dać wysokość z sąsiada, a nie błąd ani zero. Test w zadaniu 7.
4. **Import pliku z przyszłej wersji formatu lub z nieznanymi szczytami:** `version: 2` jest odrzucany z komunikatem, nieznane `peakId` są pomijane i liczone w podsumowaniu, a obecny postęp pozostaje nietknięty do potwierdzenia. Test w zadaniu 12.
5. **Dwie karty przeglądarki naraz:** zmiana statusu w jednej karcie pojawia się w drugiej (zdarzenie `storage`), żeby druga karta nie nadpisała jej starym stanem. Test w zadaniu 12.

## Wykonanie: kolejność, PR i wymagania wstępne

- **Wymaganie wstępne (decyzja użytkownika):** utworzenie publicznego repo na GitHubie i dodanie `origin`, przed pierwszym PR. Do tego czasu commity lokalnie na gałęziach zadań.
- **Zależności:** 1 → 2 → {tor A: 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11} ‖ {tor B: 12, 13, 14, 15 (niezależne) → 16 → 17 → 18 → 19} → 20 (wymaga 11 i 19).
- **Proponowane PR:** zadanie 1, zadanie 2, zadania 3–4, 5–6, 7, 8, 9–10, 11, 12, 13–14, 15–16, 17–18, 19, 20.

---

### Task 1: Szkielet projektu, narzędzia i CI

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `playwright.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/test/setup.ts`, `.github/workflows/ci.yml`, `.github/workflows/pages.yml`
- Test: `src/App.test.tsx`

**Interfaces:**
- Produces: skrypty npm z Global Constraints. Vitest używa środowiska `jsdom` dla `src/**` i `node` dla `pipeline/**` (`environmentMatchGlobs` albo `projects`). Setup: `@testing-library/jest-dom`.

- [ ] **Step 1: Napisz test, który nie przechodzi**

```tsx
// src/App.test.tsx
it('renders the app title', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Korona Gór Polskich' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Uruchom `npm test`.** Oczekiwany wynik: FAIL (brak `App`).
- [ ] **Step 3: Utwórz szkielet** przez `npm create vite@latest . -- --template react-ts` i dostosuj go: `base: '/korona-gor-polskich/'`, `<html lang="pl">`, `<title>Korona Gór Polskich</title>`, `App` renderuje `<h1>Korona Gór Polskich</h1>`. Dodaj `tsx`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@playwright/test`, `eslint`, `typescript-eslint`.
- [ ] **Step 4: Uruchom `npm test && npm run lint && npm run typecheck && npm run build`.** Oczekiwany wynik: wszystko PASS, powstaje `dist/`.
- [ ] **Step 5: Dodaj CI.**
  - `ci.yml` (dla `pull_request` i `push` na `main`): `npm ci`, `lint`, `typecheck`, `test`, `build`, `npx playwright install --with-deps chromium`, `npm run e2e`. Krok E2E pomija się, gdy nie ma katalogu `e2e/` (`if: hashFiles('e2e/**') != ''`).
  - `pages.yml` (dla `push` na `main`): build i `actions/upload-pages-artifact` + `actions/deploy-pages`.
- [ ] **Step 6: Commit** `chore: scaffold Vite React TypeScript app with CI and Pages deploy`.

---

### Task 2: Wspólny schemat danych

**Files:**
- Create: `src/data/schema.ts`
- Test: `src/data/schema.test.ts`

**Interfaces:**
- Produces (eksportuje):
  - `PTTK_COLORS = ['red','blue','green','yellow','black'] as const`, `type PttkColor`
  - `TRAILHEAD_KINDS = ['parking','station','bus_stop','place','manual'] as const`, `type TrailheadKind`
  - `PeakSummarySchema`: `{ id: string /^[a-z0-9-]+$/, name, range, elevation: int, lat, lon, routeCount: int 0..3 }`
  - `PeaksIndexSchema`: `{ generatedAt: ISO datetime, peaks: PeakSummary[] }`
  - `TrailFeatureSchema`: GeoJSON Feature LineString, współrzędne `[lon, lat]`, `properties: { colors: PttkColor[] (min 1), name?: string }`
  - `RouteSchema`: `{ id: /^[a-z0-9-]+--[a-z0-9-]+$/, name, trailhead: { name, lat, lon, kind }, distanceKm, ascentM, descentM, durationMin: int, colors: PttkColor[] (min 1), geometry: LineString [lon, lat, ele], profile: [distM, eleM][] (min 2) }`
  - `PeakDetailSchema`: `{ peakId, trails: { type: 'FeatureCollection', features: TrailFeature[] }, routes: Route[] (max 3) }`
  - typy `PeakSummary`, `PeaksIndex`, `TrailFeature`, `Route`, `PeakDetail` (`z.infer`)

- [ ] **Step 1: Napisz testy, które nie przechodzą**
  - `accepts the spec example peak detail`: przykład ze specyfikacji, sekcja 3.2, przechodzi `PeakDetailSchema.parse`.
  - `rejects route coordinates without elevation`: `[19.5, 49.6]` w `route.geometry` daje błąd.
  - `rejects unknown trail color`: `colors: ['purple']` daje błąd.
  - `rejects more than 3 routes`.
- [ ] **Step 2: Uruchom `npx vitest run src/data/schema.test.ts`.** Oczekiwany wynik: FAIL.
- [ ] **Step 3: Zaimplementuj schematy** w `src/data/schema.ts`.
- [ ] **Step 4: Uruchom test ponownie.** Oczekiwany wynik: PASS.
- [ ] **Step 5: Commit** `feat: add shared data schema for peaks, trails and routes`.

---

### Task 3: Narzędzia geometrii i czasu przejścia (pipeline)

**Files:**
- Create: `pipeline/src/geo.ts`, `pipeline/src/timing.ts`
- Test: `pipeline/test/geo.test.ts`, `pipeline/test/timing.test.ts`

**Interfaces:**
- Produces:
  - `type LonLat = [number, number]`
  - `haversineM(a: LonLat, b: LonLat): number` (promień Ziemi 6 371 008.8 m)
  - `lineLengthM(coords: LonLat[]): number`
  - `resample(coords: LonLat[], stepM: number): LonLat[]`: punkty co `stepM` wzdłuż linii, zawsze z pierwszym i ostatnim punktem
  - `simplifyLine(coords: LonLat[], toleranceM: number): LonLat[]`: `@turf/simplify` z tolerancją przeliczoną na stopnie (`toleranceM / 111_320`), `highQuality: true`
  - `roundCoord(n: number, digits = 5): number`
  - `estimateDurationMin(distanceKm: number, ascentM: number): number`

- [ ] **Step 1: Napisz testy, które nie przechodzą**

```ts
expect(haversineM([19.5294, 49.5732], [20.0881, 49.1795])).toBeCloseTo(59_600, -3); // Babia Góra → Rysy ≈ 59,6 km
expect(resample([[0,0],[0,0.001]], 25).length).toBe(6); // 111 m → 0,25,50,75,100,111
expect(estimateDurationMin(7.4, 980)).toBe(210); // 7.4/4 + 980/600 = 3.4833 h = 209 min → 210
expect(estimateDurationMin(0, 0)).toBe(0);
expect(roundCoord(19.529412345)).toBe(19.52941);
```

- [ ] **Step 2: Uruchom `npx vitest run pipeline/test`.** Oczekiwany wynik: FAIL.
- [ ] **Step 3: Zaimplementuj funkcje.** `estimateDurationMin = round5((distanceKm / 4 + ascentM / 600) * 60)`, gdzie `round5(m) = Math.round(m / 5) * 5`.
- [ ] **Step 4: Uruchom testy ponownie.** Oczekiwany wynik: PASS.
- [ ] **Step 5: Commit** `feat(pipeline): add geometry and hiking time utilities`.

---

### Task 4: Klient Overpass z serwerami lustrzanymi i ponowieniami

**Files:**
- Create: `pipeline/src/overpass.ts`
- Test: `pipeline/test/overpass.test.ts`

**Interfaces:**
- Produces:
  - `OVERPASS_ENDPOINTS: string[]`, `USER_AGENT: string` (wartości z Global Constraints)
  - typy `OverpassNode { type:'node'; id; lat; lon; tags? }`, `OverpassWayMember { type:'way'; ref; role; geometry?: {lat; lon}[] }`, `OverpassRelation { type:'relation'; id; tags; members: (OverpassWayMember | {type:'node'|'relation'; ref; role})[] }`, `OverpassResponse { elements: (OverpassNode | OverpassRelation)[] }`
  - `class OverpassError extends Error { attempts: string[] }`
  - `fetchOverpass(query: string, deps?: { fetch?: typeof fetch; endpoints?: string[]; retries?: number /*=3*/; sleep?: (ms: number) => Promise<void> }): Promise<OverpassResponse>`
  - `hikingRelationsQuery(lat, lon, radiusM): string` → `[out:json][timeout:90];rel(around:${radiusM},${lat},${lon})[route=hiking];out geom;`
  - `trailheadCandidatesQuery(lat, lon, radiusM): string`: węzły `amenity=parking`, `railway~"^(station|halt)$"`, `highway=bus_stop`, `place~"^(village|town|hamlet)$"` w promieniu, `out;` (parkingi zapisane jako way: `out center;`, zamienione na węzeł)
  - `peakNodesQuery(nodeIds: number[]): string` i `peaksByNameQuery(names: string[]): string` (`node[natural=peak][name=...]` w bbox Polski `49.0,14.0,51.1,24.2`)

- [ ] **Step 1: Napisz testy, które nie przechodzą** (z atrapą `fetch` i `sleep`)
  - `sends POST with form-encoded data and User-Agent header`
  - `retries same endpoint up to 3 times with backoff 1s, 2s, 4s then moves to next mirror`: na każdy serwer przypada 1 próba plus 3 ponowienia (razem 4 próby). Atrapa zwraca 502 cztery razy na pierwszym serwerze, potem 200 JSON na drugim. Oczekiwane wywołania `sleep`: `[1000, 2000, 4000]` (tylko między próbami na tym samym serwerze), wynik sparsowany.
  - `treats HTML body with 200 status as failure` (Overpass zwraca HTML przy błędach)
  - `throws OverpassError listing every attempt when all mirrors fail`
- [ ] **Step 2: Uruchom testy.** Oczekiwany wynik: FAIL.
- [ ] **Step 3: Zaimplementuj** `fetchOverpass` i budowniczych zapytań.
- [ ] **Step 4: Uruchom testy ponownie.** Oczekiwany wynik: PASS.
- [ ] **Step 5: Commit** `feat(pipeline): add Overpass client with mirrors and retries`.

---

### Task 5: Kolory szlaków i graf szlaków

**Files:**
- Create: `pipeline/src/osmc.ts`, `pipeline/src/graph.ts`, `pipeline/fixtures/babia-gora.relations.json` (wycinek prawdziwej odpowiedzi Overpass, kilka relacji)
- Test: `pipeline/test/osmc.test.ts`, `pipeline/test/graph.test.ts`

**Interfaces:**
- Consumes: `LonLat`, `haversineM` (zadanie 3), `OverpassRelation` (zadanie 4), `PttkColor` (zadanie 2)
- Produces:
  - `trailColor(tags: Record<string, string>): PttkColor | null`
  - `vertexKey(p: LonLat): string`: `${lon.toFixed(7)},${lat.toFixed(7)}`
  - `interface TrailEdge { to: string; lengthM: number; colors: PttkColor[]; wayId: number }`
  - `interface TrailGraph { vertices: Map<string, LonLat>; adj: Map<string, TrailEdge[]> }`
  - `interface SkippedRelation { id: number; name?: string; reason: 'no-color' | 'unsupported-color' }`
  - `buildTrailGraph(relations: OverpassRelation[]): { graph: TrailGraph; skipped: SkippedRelation[]; trails: { colors: PttkColor[]; name?: string; coords: LonLat[] }[] }`: każdy kolejny punkt geometrii odcinka (way) to wierzchołek, a krawędzie są dwukierunkowe. Odcinek należący do kilku relacji ma jedną parę krawędzi z sumą kolorów (posortowaną wg `PTTK_COLORS`). `trails` to jeden wpis na odcinek (do wyświetlania).
  - `nearestVertex(graph: TrailGraph, p: LonLat, maxDistM: number): string | null`

- [ ] **Step 1: Napisz testy, które nie przechodzą**

```ts
expect(trailColor({ 'osmc:symbol': 'red:white:red_bar' })).toBe('red');
expect(trailColor({ colour: 'Blue' })).toBe('blue');
expect(trailColor({ 'osmc:symbol': 'purple:white:purple_bar' })).toBeNull();
expect(trailColor({})).toBeNull();
```

  Graf: `shared way in red and yellow relations yields one edge pair with colors ['red','yellow']`, `two ways meeting at a common coordinate share a vertex`, `relation without color is reported in skipped with reason 'no-color'`, `nearestVertex returns null beyond maxDistM`.
- [ ] **Step 2: Uruchom testy.** Oczekiwany wynik: FAIL.
- [ ] **Step 3: Zaimplementuj** `trailColor` (pierwszy człon `osmc:symbol`, a gdy go brak, `colour`; małe litery) i `buildTrailGraph`.
- [ ] **Step 4: Uruchom testy ponownie.** Oczekiwany wynik: PASS.
- [ ] **Step 5: Commit** `feat(pipeline): parse PTTK colors and build trail graph`.

---

### Task 6: Punkty startu

**Files:**
- Create: `pipeline/src/trailheads.ts`
- Test: `pipeline/test/trailheads.test.ts`

**Interfaces:**
- Consumes: `TrailGraph`, `nearestVertex` (zadanie 5), `OverpassNode` (zadanie 4), `TrailheadKind` (zadanie 2)
- Produces:
  - `slugify(name: string): string`: małe litery, polskie znaki zamienione na ASCII (`ą→a, ć→c, ę→e, ł→l, ń→n, ó→o, ś→s, ź→z, ż→z`), wszystko poza `[a-z0-9]` → `-`, bez powtórzonych i skrajnych `-`
  - `interface Trailhead { id: string; name: string; kind: TrailheadKind; lon: number; lat: number; vertex: string }`
  - `findTrailheads(graph: TrailGraph, pois: OverpassNode[], opts?: { maxDistM?: number /*=300*/; manual?: { name: string; lat: number; lon: number }[] }): Trailhead[]`

- [ ] **Step 1: Napisz testy, które nie przechodzą**
  - `slugify('Zawoja Markowa – parking') === 'zawoja-markowa-parking'`, `slugify('Łysica') === 'lysica'`
  - `ignores POIs farther than 300 m from any trail vertex`
  - `unnamed parking takes the name of the nearest place POI`
  - `duplicate slugs get -2, -3 suffixes in stable order (sorted by lon, then lat)`
  - `kind mapping: amenity=parking→parking, railway=station|halt→station, highway=bus_stop→bus_stop, place=*→place, manual→manual`
  - `two POIs snapping to the same vertex keep one trailhead, preferring parking > station > bus_stop > place`
- [ ] **Step 2: Uruchom testy.** Oczekiwany wynik: FAIL.
- [ ] **Step 3: Zaimplementuj** `slugify` i `findTrailheads`.
- [ ] **Step 4: Uruchom testy ponownie.** Oczekiwany wynik: PASS.
- [ ] **Step 5: Commit** `feat(pipeline): find and name trailheads near trails`.

---

### Task 7: Próbkowanie DEM, profil i suma podejść

**Files:**
- Create: `pipeline/src/elevation.ts`, `pipeline/fixtures/dem/` (kilka małych PNG wygenerowanych w teście przez `pngjs`, bez pobierania)
- Test: `pipeline/test/elevation.test.ts`

**Interfaces:**
- Consumes: `LonLat`, `resample`, `lineLengthM` (zadanie 3)
- Produces:
  - `decodeTerrarium(r: number, g: number, b: number): number` = `r * 256 + g + b / 256 - 32768`
  - `type FetchTile = (z: number, x: number, y: number) => Promise<Buffer>` (PNG)
  - `interface DemSampler { elevationAt(p: LonLat): Promise<number> }`
  - `createDemSampler(fetchTile: FetchTile, zoom = 14): DemSampler`: kafle 256 px w pamięci podręcznej (`Map` po `z/x/y`), interpolacja dwuliniowa, piksel sąsiedni spoza kafla czytany z sąsiedniego kafla
  - `httpTileFetcher(urlTemplate: string, userAgent: string, deps?: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> }): FetchTile`: 1 próba plus 3 ponowienia z odstępami 1 s, 2 s, 4 s, potem błąd z adresem kafla
  - `buildProfile(coords: LonLat[], sampler: DemSampler, stepM = 25): Promise<{ coords3d: [number, number, number][]; profile: [number, number][] }>`: wysokości zaokrąglone do 1 m, dystans do 1 m
  - `ascentDescent(profile: [number, number][], opts?: { window?: number /*=5*/; thresholdM?: number /*=2*/ }): { ascentM: number; descentM: number }`

  Algorytm `ascentDescent` (nie wynika z sygnatury): wygładź wysokości średnią kroczącą o oknie `window` (wyśrodkowaną, przycinaną na końcach). Następnie idź od punktu odniesienia `ref = h[0]`: gdy `h[i] - ref >= thresholdM`, dodaj różnicę do podejść i ustaw `ref = h[i]`. Gdy `ref - h[i] >= thresholdM`, dodaj różnicę do zejść i ustaw `ref = h[i]`. Wynik zaokrąglony do 1 m.

- [ ] **Step 1: Napisz testy, które nie przechodzą**
  - `decodeTerrarium(128, 0, 0) === 0`, `decodeTerrarium(134, 189, 0) === 1725`
  - `bilinear interpolation between four pixels` (kafel PNG z gradientem wygenerowany w teście)
  - `sampling the last pixel column reads the neighbouring tile` (dwa kafle o różnych stałych wysokościach, punkt w połowie między środkiem ostatniego piksela a sąsiadem, oczekiwana średnia)
  - `fetches each tile once` (licznik wywołań atrapy)
  - `ascentDescent ignores ±1 m noise`: profil piłokształtny 1000, 1001, 1000, … daje `{ ascentM: 0, descentM: 0 }`
  - `ascentDescent on monotonic climb 800→1725 gives ascent 925`
  - `httpTileFetcher retries on 503 and throws after 4 failed attempts` (atrapy `fetch` i `sleep`, `sleep` wywołany z `[1000, 2000, 4000]`)
- [ ] **Step 2: Uruchom testy.** Oczekiwany wynik: FAIL.
- [ ] **Step 3: Zaimplementuj** (`pngjs` `PNG.sync.read`, matematyka Web Mercator dla współrzędnych kafla i piksela).
- [ ] **Step 4: Uruchom testy ponownie.** Oczekiwany wynik: PASS.
- [ ] **Step 5: Commit** `feat(pipeline): sample terrarium DEM and compute elevation profile`.

---

### Task 8: Wyznaczanie tras, wybór i ręczne poprawki

**Files:**
- Create: `pipeline/src/routes.ts`, `pipeline/src/overrides.ts`, `pipeline/route-overrides.json` (`{}`)
- Test: `pipeline/test/routes.test.ts`, `pipeline/test/overrides.test.ts`

**Interfaces:**
- Consumes: `TrailGraph` (5), `Trailhead` (6), `buildProfile`, `ascentDescent`, `DemSampler` (7), `estimateDurationMin`, `lineLengthM` (3), `Route` (2)
- Produces:
  - `shortestPaths(graph: TrailGraph, source: string): { dist: Map<string, number>; prev: Map<string, { from: string; edge: TrailEdge }> }`: Dijkstra z kopcem binarnym
  - `interface CandidateRoute { trailhead: Trailhead; coords: LonLat[] /* od startu do szczytu */; lengthM: number; colors: PttkColor[] /* w kolejności występowania */; edges: Map<string, number> /* klucz krawędzi nieskierowanej → długość */ }`
  - `candidateRoutes(graph, summitVertex: string, trailheads: Trailhead[], opts?: { minLenM?: 1000; maxLenM?: 20000 }): CandidateRoute[]`
  - `interface EnrichedRoute extends CandidateRoute { coords3d; profile; ascentM; descentM; durationMin }`
  - `enrichRoute(c: CandidateRoute, sampler: DemSampler): Promise<EnrichedRoute>`
  - `selectRoutes(routes: EnrichedRoute[], opts?: { maxCount?: 3; minStartSeparationM?: 2000; maxOverlap?: 0.5 }): EnrichedRoute[]`: sortowanie po `durationMin`, potem zachłannie. Pokrycie = długość wspólnych krawędzi / `lengthM` kandydata, liczona względem każdej już wybranej trasy.
  - `toRoute(peakId: string, r: EnrichedRoute, peakName: string): Route`: `id = ${peakId}--${trailhead.id}`, domyślna nazwa `${trailhead.name} → ${peakName}`, `distanceKm` z 1 miejscem po przecinku, geometria uproszczona (`simplifyLine`, 5 m), zaokrąglona (`roundCoord`), z zachowaniem wysokości z najbliższego punktu `coords3d`
  - `RouteOverridesSchema` (zod): `Record<peakId, { exclude?: string[]; rename?: Record<routeId, string>; addTrailhead?: { name; lat; lon }[] }>`
  - `loadOverrides(path: string): Promise<RouteOverrides>`, `excludedTrailheads(o, peakId): Set<string>`, `manualTrailheads(o, peakId)`, `applyRenames(routes: Route[], o, peakId): Route[]`

- [ ] **Step 1: Napisz testy, które nie przechodzą** (mały ręcznie zbudowany graf w teście)
  - `shortestPaths finds the shorter of two branches`
  - `candidateRoutes drops routes shorter than 1 km and longer than 20 km`
  - `candidate coords start at trailhead and end at summit`
  - `selectRoutes picks at most 3, fastest first`
  - `selectRoutes rejects a start within 2 km of an already selected start`
  - `selectRoutes rejects a route sharing more than 50% of its length with a selected route`
  - `toRoute builds id 'babia-gora--zawoja-markowa' and passes RouteSchema`
  - overrides: `exclude removes trailhead before selection`, `rename replaces route name`, `addTrailhead appears as kind 'manual'`, `invalid overrides file fails with zod error naming the path`
- [ ] **Step 2: Uruchom testy.** Oczekiwany wynik: FAIL.
- [ ] **Step 3: Zaimplementuj** `routes.ts` i `overrides.ts`.
- [ ] **Step 4: Uruchom testy ponownie.** Oczekiwany wynik: PASS.
- [ ] **Step 5: Commit** `feat(pipeline): compute, select and override routes`.

---

### Task 9: Lista szczytów i walidacja względem OSM

**Files:**
- Create: `pipeline/src/peaks.ts`, `pipeline/src/lookup-peaks.ts` (CLI `npm run data:lookup-peaks`), `pipeline/peaks.source.json`
- Test: `pipeline/test/peaks.test.ts`

**Interfaces:**
- Consumes: `fetchOverpass`, `peaksByNameQuery`, `peakNodesQuery` (4), `haversineM` (3)
- Produces:
  - `PeakSourceSchema`: `{ id, name, range, elevation: int, lat, lon, osmNodeId: int, acceptOsmMismatch?: boolean }`. `PeakSourcesSchema` to tablica o długości dokładnie 28 z unikalnymi `id`.
  - `loadPeakSources(path: string): Promise<PeakSource[]>`
  - `checkPeakAgainstOsm(src: PeakSource, node: OverpassNode): { distanceM: number; elevationDiffM: number | null; ok: boolean }`: `ok`, gdy `distanceM <= 200` i (`ele` brak lub `|diff| <= 10`), albo gdy `acceptOsmMismatch`
  - `lookup-peaks.ts`: dla nazw z `peaks.source.json` drukuje kandydatów `natural=peak` (id, lat, lon, ele) do ręcznego wyboru. Niczego nie zapisuje.

- [ ] **Step 1: Napisz testy, które nie przechodzą**
  - `ok when 150 m away and elevation differs by 8 m`
  - `not ok when 250 m away`, `not ok when elevation differs by 12 m`
  - `acceptOsmMismatch makes a mismatch ok`
  - `missing ele tag ignores elevation check`
  - `the real peaks.source.json has 28 unique peaks matching the spec list` (porównanie nazw z listą z sekcji 3.1 specyfikacji)
- [ ] **Step 2: Uruchom testy.** Oczekiwany wynik: FAIL.
- [ ] **Step 3: Zaimplementuj** `peaks.ts` i `lookup-peaks.ts`.
- [ ] **Step 4: Wypełnij `peaks.source.json`:** uruchom `npm run data:lookup-peaks` i dla każdego z 28 szczytów wybierz węzeł pasujący do pasma. Wysokość wpisz według oficjalnej listy KGP, a współrzędne z wybranego węzła. Niejednoznaczne przypadki (np. „Wysoka” w Pieninach) opisz w PR.
- [ ] **Step 5: Uruchom testy ponownie.** Oczekiwany wynik: PASS.
- [ ] **Step 6: Commit** `feat(pipeline): add KGP peak list with OSM validation`.

---

### Task 10: Orkiestracja builda danych

**Files:**
- Create: `pipeline/src/build.ts`, `pipeline/src/cli.ts` (`npm run data:build` → `tsx pipeline/src/cli.ts`), `pipeline/fixtures/babia-gora.pois.json`
- Test: `pipeline/test/build.test.ts`

**Interfaces:**
- Consumes: wszystkie funkcje z zadań 3–9, `PeaksIndexSchema`, `PeakDetailSchema` (2)
- Produces:
  - `interface BuildDeps { overpass(query: string): Promise<OverpassResponse>; fetchTile: FetchTile; overrides: RouteOverrides; now(): Date; log(line: string): void }`
  - `interface PeakReport { peakId; relations: number; skipped: SkippedRelation[]; routes: { id; name; distanceKm; durationMin }[]; sizeBytes: number; warnings: string[]; errors: string[] }`
  - `buildPeak(src: PeakSource, deps: BuildDeps): Promise<{ detail: PeakDetail; report: PeakReport }>`: promień zapytań 10 000 m. Szczyt dołączany przez `nearestVertex(…, 150)`. Trasy przechodzą przez `excludedTrailheads` → `candidateRoutes` → `enrichRoute` → `selectRoutes` → `toRoute` → `applyRenames`. Szlaki do wyświetlenia są uproszczone (5 m) i zaokrąglone.
  - `buildAll(sources: PeakSource[], deps: BuildDeps, outDir: string): Promise<{ ok: boolean; reports: PeakReport[] }>`: najpierw walidacja wszystkich szczytów względem OSM (jedno zapytanie `peakNodesQuery`). Pliki zapisywane do `${outDir}.tmp/`, a po sukcesie wszystkich szczytów `outDir` jest podmieniany przez rename. Przy jakimkolwiek błędzie `outDir` pozostaje nietknięty, a `.tmp` jest usuwany.
  - Błędy szczytu: brak wierzchołka w promieniu 150 m od szczytu, 0 tras po wyborze, niezgodność z OSM bez akceptacji. Ostrzeżenie: plik szczytu > 500 000 bajtów.
  - `cli.ts` drukuje raport (tabela na każdy szczyt) i kończy się kodem 1, gdy `ok === false`.

- [ ] **Step 1: Napisz testy, które nie przechodzą** (atrapy `overpass` i `fetchTile` na fixture, katalog tymczasowy)
  - `buildPeak on Babia Góra fixture yields 1–3 routes that pass PeakDetailSchema and end within 150 m of the summit`
  - `buildAll writes peaks.json and peaks/<id>.json that pass schemas`
  - `buildAll leaves existing outDir untouched when one peak has zero routes`
  - `buildAll leaves existing outDir untouched when Overpass throws`
  - `report lists skipped relations and size warning above 500000 bytes`
- [ ] **Step 2: Uruchom testy.** Oczekiwany wynik: FAIL.
- [ ] **Step 3: Zaimplementuj** `build.ts` i `cli.ts`.
- [ ] **Step 4: Uruchom testy ponownie.** Oczekiwany wynik: PASS.
- [ ] **Step 5: Commit** `feat(pipeline): orchestrate atomic data build with report`.

---

### Task 11: Wygenerowanie prawdziwych danych i test spójności

**Files:**
- Create: `public/data/peaks.json`, `public/data/peaks/*.json` (wynik pipeline'u), `src/data/consistency.test.ts`
- Modify: `pipeline/route-overrides.json`

**Interfaces:**
- Consumes: `npm run data:build` (10), schematy (2)

- [ ] **Step 1: Napisz test spójności, który nie przechodzi**
  - `peaks.json has exactly 28 peaks and passes PeaksIndexSchema`
  - `every peak file passes PeakDetailSchema and has 1–3 routes`
  - `routeCount in peaks.json equals routes.length in the peak file`
  - `last point of every route lies within 150 m of its peak`
- [ ] **Step 2: Uruchom `npx vitest run src/data/consistency.test.ts`.** Oczekiwany wynik: FAIL (brak plików).
- [ ] **Step 3: Uruchom `npm run data:build`** (sieć wymagana) i przeczytaj raport. Bezsensowne starty (np. parking 50 m od innego, dziwne nazwy) popraw w `route-overrides.json` (`exclude`, `rename`, `addTrailhead`) i powtórz build. Powtarzaj, aż raport nie ma błędów.
- [ ] **Step 4: Uruchom test spójności ponownie.** Oczekiwany wynik: PASS. Uruchom też `du -sh public/data`; wynik wpisz do PR.
- [ ] **Step 5: Commit** `feat(data): generate KGP peaks, trails and routes from OSM`. W opisie PR wklej raport pipeline'u, żeby recenzent mógł przejrzeć trasy.

---

### Task 12: Zapis postępu, import i eksport

**Files:**
- Create: `src/progress/progress.ts`, `src/progress/importExport.ts`, `src/progress/useProgress.ts`, `src/lib/plural.ts`
- Test: `src/progress/progress.test.ts`, `src/progress/importExport.test.ts`, `src/progress/useProgress.test.tsx`, `src/lib/plural.test.ts`

**Interfaces:**
- Produces:
  - `type PeakStatus = 'done' | 'planned'`, `interface PeakProgress { status: PeakStatus; date?: string /* RRRR-MM-DD */; note?: string /* ≤ 500 znaków */ }`, `interface Progress { version: 1; updatedAt: string; peaks: Record<string, PeakProgress> }`
  - `STORAGE_KEY = 'kgp.progress'`, `ProgressSchema`, `class ProgressFormatError extends Error`
  - `emptyProgress(nowIso: string): Progress`
  - `migrate(raw: unknown): Progress`: akceptuje `version: 1`. Brak `version` albo wartość > 1 rzuca `ProgressFormatError`.
  - `getStorage(): Storage | null`: próba `setItem`/`removeItem` w try/catch
  - `loadProgress(storage: Storage | null, now: () => Date): { progress: Progress; persistent: boolean; recoveredCorrupt: boolean }`: przy uszkodzonych danych kopia pod `kgp.progress.corrupt-<now().getTime()>` i pusty postęp
  - `saveProgress(storage: Storage | null, p: Progress): boolean`
  - `setPeakStatus(p: Progress, peakId: string, entry: PeakProgress | null, nowIso: string): Progress` (czysta, `null` usuwa wpis)
  - `plural(n: number, one: string, few: string, many: string): string`: polskie reguły (1; 2–4 bez 12–14; reszta)
  - `exportProgress(p: Progress, today: Date): { filename: string; content: string }`: `kgp-postep-RRRR-MM-DD.json`, JSON z wcięciem 2
  - `type ImportResult = { ok: true; progress: Progress; summary: { done: number; planned: number; droppedUnknown: number } } | { ok: false; error: string }`
  - `parseImport(text: string, knownPeakIds: Set<string>): ImportResult`
  - `importSummaryText(s): string`, np. `"12 zdobytych, 3 planowane, nadpisze obecny postęp"`, z dopiskiem `", pominięto 2 nieznane szczyty"`, gdy `droppedUnknown > 0`
  - `useProgress(): { progress: Progress; persistent: boolean; recoveredCorrupt: boolean; setStatus(peakId, entry | null): void; replace(p: Progress): void }`: nasłuchuje zdarzenia `storage` dla `STORAGE_KEY` i przeładowuje stan

- [ ] **Step 1: Napisz testy, które nie przechodzą**
  - progress: `loads empty progress when key missing`, `round-trips save/load`, `corrupt JSON is copied to kgp.progress.corrupt-<ts> and progress starts empty with recoveredCorrupt=true`, `null storage → persistent=false and saveProgress returns false`, `rejects note longer than 500 chars`, `rejects date '2026-13-01'`
  - plural: `plural(1,'zdobyty','zdobyte','zdobytych')==='zdobyty'`, `2→'zdobyte'`, `5→'zdobytych'`, `12→'zdobytych'`, `22→'zdobyte'`
  - importExport: `export filename is kgp-postep-2026-10-15.json`, `export → parseImport round-trips`, `version 2 is rejected with error 'Plik pochodzi z nowszej wersji aplikacji'`, `non-JSON is rejected with error 'To nie jest poprawny plik postępu'`, `unknown peak ids are dropped and counted`, `summary text '12 zdobytych, 3 planowane, nadpisze obecny postęp'`
  - useProgress: `storage event from another tab updates state`, `setStatus persists to storage`
- [ ] **Step 2: Uruchom testy.** Oczekiwany wynik: FAIL.
- [ ] **Step 3: Zaimplementuj** moduły.
- [ ] **Step 4: Uruchom testy ponownie.** Oczekiwany wynik: PASS.
- [ ] **Step 5: Commit** `feat: persist hiking progress with import and export`.

---

### Task 13: Generowanie GPX

**Files:**
- Create: `src/gpx/gpx.ts`, `src/lib/download.ts`
- Test: `src/gpx/gpx.test.ts`

**Interfaces:**
- Consumes: `Route` (2)
- Produces:
  - `routeToGpx(route: Route): string`: `<?xml version="1.0" encoding="UTF-8"?>`, `<gpx version="1.1" creator="korona-gor-polskich" xmlns="http://www.topografix.com/GPX/1/1">`, jeden `<trk><name>…</name><trkseg>` z `<trkpt lat lon><ele>`
  - `gpxFilename(route: Route): string` = `${route.id}.gpx`
  - `downloadText(filename: string, content: string, mime: string): void` (Blob + tymczasowy `<a download>`)

- [ ] **Step 1: Napisz testy, które nie przechodzą**
  - `contains one trkpt per coordinate with ele`
  - `escapes & < > " ' in route name`: nazwa `Szlak "A" & <B>` daje `Szlak &quot;A&quot; &amp; &lt;B&gt;`
  - `output parses with DOMParser without parsererror and keeps 'Śnieżka'`
  - `gpxFilename is 'babia-gora--zawoja-markowa.gpx'`
- [ ] **Step 2: Uruchom testy.** Oczekiwany wynik: FAIL.
- [ ] **Step 3: Zaimplementuj** moduły.
- [ ] **Step 4: Uruchom testy ponownie.** Oczekiwany wynik: PASS.
- [ ] **Step 5: Commit** `feat: export routes as GPX`.

---

### Task 14: Wczytywanie danych w aplikacji

**Files:**
- Create: `src/data/api.ts`, `src/data/usePeakDetail.ts`, `src/test/fixtures/peaks.json` (wszystkie 28 szczytów z nazwami, pasmami i wysokościami ze specyfikacji), `src/test/fixtures/peaks/babia-gora.json` (3 trasy), `src/test/fixtures/peaks/rysy.json` (1 trasa). Wszystkie pliki są małe i zgodne ze schematem.
- Test: `src/data/api.test.ts`, `src/data/usePeakDetail.test.tsx`

**Interfaces:**
- Consumes: `PeaksIndexSchema`, `PeakDetailSchema` (2)
- Produces:
  - `class DataLoadError extends Error { kind: 'network' | 'invalid' }`
  - `loadPeaksIndex(fetchFn = fetch, base = import.meta.env.BASE_URL): Promise<PeaksIndex>`
  - `loadPeakDetail(peakId: string, fetchFn = fetch, base = import.meta.env.BASE_URL): Promise<PeakDetail>`
  - `usePeakDetail(peakId: string | null, fetchFn?): { status: 'idle' | 'loading' | 'ready' | 'error'; detail: PeakDetail | null; retry(): void }`: obowiązuje tylko odpowiedź na ostatnie `peakId`
  - `usePeaksIndex(fetchFn?)`: ten sam kształt dla indeksu

- [ ] **Step 1: Napisz testy, które nie przechodzą**
  - `loads and validates fixture index`
  - `non-200 response → DataLoadError kind 'network'`
  - `schema mismatch → DataLoadError kind 'invalid'`
  - `usePeakDetail ignores a late response for a previously selected peak` (odpowiedź A rozwiązana po B; oczekiwany `detail.peakId === 'rysy'`)
  - `retry() refetches after error`
- [ ] **Step 2: Uruchom testy.** Oczekiwany wynik: FAIL.
- [ ] **Step 3: Zaimplementuj** moduły.
- [ ] **Step 4: Uruchom testy ponownie.** Oczekiwany wynik: PASS.
- [ ] **Step 5: Commit** `feat: load and validate static peak data`.

---

### Task 15: Styl górski i warstwy nakładki

**Files:**
- Create: `src/map/config.ts`, `src/map/mountainStyle.ts`, `src/map/overlay.ts`, `src/test/fixtures/liberty-layers.json` (wycinek stylu Liberty z warstwami wymienionymi w testach)
- Test: `src/map/mountainStyle.test.ts`, `src/map/overlay.test.ts`

**Interfaces:**
- Consumes: `PeakSummary`, `PeakDetail`, `PttkColor` (2), `Progress` (12)
- Produces:
  - `config.ts`: `STYLE_URL`, `DEM_URL`, `PTTK_HEX: Record<PttkColor, string>`, `STATUS_HEX = { done: '#2e7d32', planned: '#f9a825', todo: '#c62828' }`, `TERRAIN_EXAGGERATION = 1.3`
  - `toMountainStyle(style: StyleSpecification): StyleSpecification` (czysta, bez mutacji wejścia):
    - ukrywa (`layout.visibility = 'none'`) warstwy pasujące do `/^(road|bridge|tunnel)_.*_casing$/`, `/^highway-shield/`, `/^road_shield/`, `highway-name-minor`, `highway-name-major`, `/^poi_/`, `/^road_one_way/`, `building-3d`
    - linie `/^(road|bridge|tunnel)_(motorway|trunk|secondary|link|minor|street|service)/` (bez `_casing`): `line-color '#a89f91'`, `line-width ['interpolate',['linear'],['zoom'],10,0.3,13,0.9,16,2.5]`
    - `landcover_wood`: `fill-color 'rgba(120, 170, 90, 0.45)'`
    - dokłada źródła `dem` i `hillshade-dem` (raster-dem, `DEM_URL`, `terrarium`, `tileSize 256`, `maxzoom 15`), warstwę `hillshade` (`hillshade-exaggeration 0.5`, `hillshade-shadow-color '#473B24'`) przed pierwszą warstwą `symbol`, `terrain: { source: 'dem', exaggeration: 1.3 }` i `sky` z mgłą
  - `peaksToGeoJSON(peaks: PeakSummary[], progress: Progress): FeatureCollection<Point, { id; label: string /* "Babia Góra\n1725 m" */; status: 'done' | 'planned' | 'todo' }>`
  - `trailsForDisplay(trails: TrailFeature[]): FeatureCollection<LineString, { color: string; offset: number }>`: jeden obiekt na kolor, `offset = (index - (n - 1) / 2) * 3` px
  - `routeToGeoJSON(route: Route | null): FeatureCollection`
  - `overlayLayers(): LayerSpecification[]` z identyfikatorami w kolejności: `trails`, `route-selected-casing`, `route-selected`, `peaks`, `peak-labels`, `profile-cursor`, oraz źródłami `trails`, `route`, `peaks`, `cursor`
  - `trailsOpacity(hasSelectedRoute: boolean): number`: `0.35` albo `1`
  - `contourSourceSpec(demSource): SourceSpecification` i warstwy `contour-lines` i `contour-labels` (progi `{11:[200,1000],12:[100,500],13:[50,250],14:[20,100]}`, opisy `"<ele> m"`)

- [ ] **Step 1: Napisz testy, które nie przechodzą**
  - `hides casing, shields, POIs and 3D buildings`
  - `mutes road lines but leaves road_path_pedestrian unchanged`
  - `does not mutate the input style`
  - `inserts hillshade before the first symbol layer and sets terrain exaggeration 1.3`
  - `peaksToGeoJSON maps progress to status and builds label 'Babia Góra\n1725 m'`
  - `trailsForDisplay splits a red+yellow segment into two features with offsets -1.5 and 1.5`
  - `overlayLayers ids are in the documented order`
- [ ] **Step 2: Uruchom testy.** Oczekiwany wynik: FAIL.
- [ ] **Step 3: Zaimplementuj** moduły.
- [ ] **Step 4: Uruchom testy ponownie.** Oczekiwany wynik: PASS.
- [ ] **Step 5: Commit** `feat(map): mountain base style and overlay layer builders`.

---

### Task 16: Komponent mapy

**Files:**
- Create: `src/map/MapView.tsx`, `src/map/webgl.ts`
- Test: `src/map/MapView.test.tsx` (z `vi.mock('maplibre-gl')`)

**Interfaces:**
- Consumes: wszystko z zadania 15, `PeakSummary`, `PeakDetail` (2), `Progress` (12)
- Produces:
  - `supportsWebGL(): boolean`
  - `MapView` props: `{ peaks: PeakSummary[]; progress: Progress; detail: PeakDetail | null; selectedRouteId: string | null; cursor: [number, number] | null; onPeakClick(id: string): void; onTileError(): void }`
  - Zachowanie:
    - po starcie pobiera `STYLE_URL`, przekształca go `toMountainStyle` i tworzy mapę,
    - dodaje poziomice i `overlayLayers()`,
    - widok startowy to `fitBounds` wszystkich szczytów z `pitch: 50`,
    - zmiana `detail` wywołuje `flyTo({ center: szczyt, zoom: 12.5, pitch: 65, duration: 3000 })`,
    - zmiana `selectedRouteId` wywołuje `fitBounds(bbox trasy, { padding: 60, pitch: 60 })` i ustawia krycie `trails` przez `trailsOpacity`,
    - kliknięcie warstwy `peaks` wywołuje `onPeakClick(id)`,
    - zdarzenie `error` mapy dotyczące kafla wywołuje `onTileError` najwyżej raz na sesję.

- [ ] **Step 1: Napisz testy, które nie przechodzą**
  - `creates map with mountain style and adds overlay layers on load`
  - `flies to the peak when detail changes`
  - `fits bounds and dims trails when a route is selected`
  - `calls onPeakClick with feature id`
  - `calls onTileError once for repeated tile errors`
- [ ] **Step 2: Uruchom testy.** Oczekiwany wynik: FAIL.
- [ ] **Step 3: Zaimplementuj** `MapView` (instancja mapy w `useRef`, aktualizacje źródeł przez `setData` w `useEffect`) i `supportsWebGL`.
- [ ] **Step 4: Uruchom testy ponownie.** Oczekiwany wynik: PASS.
- [ ] **Step 5: Sprawdź ręcznie** w `npm run dev`: na Babiej Górze widać teren 3D, poziomice, stonowane drogi i znaczniki. Zrób zrzut ekranu do PR.
- [ ] **Step 6: Commit** `feat(map): MapLibre view with terrain, contours and overlays`.

---

### Task 17: Lista szczytów, filtry i licznik postępu

**Files:**
- Create: `src/ui/peakList.ts`, `src/ui/PeakList.tsx`, `src/ui/ProgressCounter.tsx`
- Test: `src/ui/peakList.test.ts`, `src/ui/PeakList.test.tsx`

**Interfaces:**
- Consumes: `PeakSummary` (2), `Progress` (12), `STATUS_HEX` (15)
- Produces:
  - `type PeakFilter = { range: string | 'all'; status: 'all' | 'done' | 'planned' | 'todo'; sort: 'elevation-desc' | 'name' }`, domyślnie `{ range: 'all', status: 'all', sort: 'elevation-desc' }`
  - `filterAndSortPeaks(peaks, progress, filter): PeakSummary[]` (nazwy sortowane `localeCompare(…, 'pl')`)
  - `PeakList` props: `{ peaks; progress; selectedId: string | null; onSelect(id): void }`: filtry pasmo, status i sortowanie jako `<select>` z etykietami „Pasmo”, „Status”, „Sortuj”, a w liście kolorowa kropka statusu, nazwa i wysokość
  - `ProgressCounter` props `{ done: number; total: number }`: tekst `"12 / 28"` z `aria-label="Zdobyte szczyty: 12 z 28"`

- [ ] **Step 1: Napisz testy, które nie przechodzą**
  - `default sort is elevation descending (Rysy first)`
  - `name sort uses Polish collation (Łysica after Lubomir, before Mogielica)`
  - `status filter 'todo' excludes done and planned`
  - `clicking a list item calls onSelect with id`
  - `counter shows '1 / 28'`
- [ ] **Step 2: Uruchom testy.** Oczekiwany wynik: FAIL.
- [ ] **Step 3: Zaimplementuj** moduły.
- [ ] **Step 4: Uruchom testy ponownie.** Oczekiwany wynik: PASS.
- [ ] **Step 5: Commit** `feat(ui): peak list with filters and progress counter`.

---

### Task 18: Karta szczytu, trasy, status, profil i GPX

**Files:**
- Create: `src/ui/PeakCard.tsx`, `src/ui/RouteList.tsx`, `src/ui/StatusControls.tsx`, `src/ui/ElevationProfile.tsx`, `src/ui/format.ts`
- Test: `src/ui/format.test.ts`, `src/ui/PeakCard.test.tsx`, `src/ui/ElevationProfile.test.tsx`

**Interfaces:**
- Consumes: `PeakSummary`, `PeakDetail`, `Route` (2), `PeakProgress` (12), `routeToGpx`, `gpxFilename`, `downloadText` (13), `PTTK_HEX` (15)
- Produces:
  - `formatDuration(min: number): string`: `210` → `"ok. 3 h 30 min"`, `45` → `"ok. 45 min"`, `120` → `"ok. 2 h"`
  - `formatDistance(km: number): string`: `7.4` → `"7,4 km"`, a `formatAscent(m)`: `980` → `"↑ 980 m"`
  - `PeakCard` props: `{ peak: PeakSummary; detailStatus: 'loading' | 'ready' | 'error'; detail: PeakDetail | null; entry: PeakProgress | null; selectedRouteId: string | null; onSelectRoute(id): void; onStatusChange(entry: PeakProgress | null): void; onRetry(): void; onClose(): void }`
  - `StatusControls`: przyciski „Zdobyty”, „Planuję”, „Wyczyść”. Przy „Zdobyty” są pola „Data” (`type=date`) i „Notatka” (`maxLength=500`), a przy „Planuję” pole „Planowana data”.
  - `RouteList`: dla każdej trasy nazwa, „Start: …”, dystans, podejście i czas z dopiskiem „(szacunkowo)” oraz paski kolorów. Wybrana trasa ma `aria-pressed=true` i przycisk „Pobierz GPX”. Gdy `routes` jest puste, tekst „Brak gotowych tras dla tego szczytu”.
  - `ElevationProfile` props: `{ profile: [number, number][]; onHover(index: number | null): void }`: SVG z obszarem i osią wysokości, `pointermove` mapuje x na najbliższy indeks profilu, `pointerleave` wywołuje `null`
  - Błąd wczytywania: tekst „Nie udało się wczytać tras.” i przycisk „Spróbuj ponownie” (`onRetry`).

- [ ] **Step 1: Napisz testy, które nie przechodzą**
  - format: wartości z Interfaces
  - PeakCard: `shows three routes with distance, ascent and duration`, `clicking a route calls onSelectRoute`, `Pobierz GPX downloads '<route-id>.gpx'` (atrapa `downloadText`), `Zdobyty with date and note calls onStatusChange({status:'done', date, note})`, `Wyczyść calls onStatusChange(null)`, `error state shows retry button`, `renders note as text, not HTML`
  - ElevationProfile: `pointer at 50% width reports middle index`, `pointerleave reports null`
- [ ] **Step 2: Uruchom testy.** Oczekiwany wynik: FAIL.
- [ ] **Step 3: Zaimplementuj** komponenty.
- [ ] **Step 4: Uruchom testy ponownie.** Oczekiwany wynik: PASS.
- [ ] **Step 5: Commit** `feat(ui): peak card with routes, status, elevation profile and GPX`.

---

### Task 19: Powłoka aplikacji: układ, banery, tryb bez WebGL, menu postępu, atrybucje

**Files:**
- Create: `src/ui/Banner.tsx`, `src/ui/ProgressMenu.tsx`, `src/ui/Footer.tsx`, `src/ui/layout.css`
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`, `src/ui/ProgressMenu.test.tsx`

**Interfaces:**
- Consumes: `usePeaksIndex`, `usePeakDetail` (14), `useProgress`, `exportProgress`, `parseImport`, `importSummaryText` (12), `MapView`, `supportsWebGL` (16), `PeakList`, `ProgressCounter` (17), `PeakCard` (18)
- Produces:
  - `App` ze stanem `selectedPeakId`, `selectedRouteId`, `cursorIndex` → `cursor` (współrzędne z `route.geometry`). `App` przyjmuje opcjonalne `deps: { fetchFn?; supportsWebGL?; storage? }` dla testów.
  - Układ: od 768 px panel boczny 360 px, a poniżej wysuwany panel od dołu (CSS, `@media (min-width: 768px)`). Przy szerokości 360 px nie ma poziomego przewijania.
  - Banery (dokładne teksty):
    - `persistent === false`: „Postęp nie zostanie zapisany w tej przeglądarce”
    - `recoveredCorrupt`: „Zapisany postęp był uszkodzony. Zachowaliśmy jego kopię i zaczynamy od nowa.”
    - `onTileError`: „Część mapy nie wczytała się” (z możliwością zamknięcia)
    - błąd `peaks.json`: „Nie udało się wczytać listy szczytów.” z przyciskiem „Spróbuj ponownie”
  - Bez WebGL: zamiast `MapView` komunikat „Twoja przeglądarka nie obsługuje mapy 3D”. Lista, karta, status i GPX działają dalej.
  - `ProgressMenu` (przycisk „Mój postęp”):
    - „Eksportuj” pobiera plik z `exportProgress`,
    - „Importuj” otwiera wybór pliku, pokazuje `importSummaryText` i przyciski „Zastąp” i „Anuluj”, a błąd importu pokazuje treść `error`.
  - `Footer`: „© autorzy OpenStreetMap”, „OpenFreeMap”, „OpenMapTiles”, „Dane wysokościowe: AWS Terrain Tiles” jako linki.

- [ ] **Step 1: Napisz testy, które nie przechodzą** (fixture z zadania 14, `supportsWebGL: () => false` tam, gdzie mapa nie jest testowana)
  - `selecting a peak from the list opens its card with routes`
  - `marking a peak as done updates the counter to '1 / 28'`
  - `shows storage banner when storage is null`
  - `shows corrupt banner when stored progress is invalid JSON`
  - `shows no-WebGL message and still lists peaks`
  - `index load failure shows retry which reloads`
  - ProgressMenu: `import shows summary and only replaces progress after 'Zastąp'`, `'Anuluj' leaves progress unchanged`, `invalid file shows error message`
- [ ] **Step 2: Uruchom testy.** Oczekiwany wynik: FAIL.
- [ ] **Step 3: Zaimplementuj** powłokę i komponenty.
- [ ] **Step 4: Uruchom testy ponownie.** Oczekiwany wynik: PASS.
- [ ] **Step 5: Sprawdź ręcznie** w `npm run dev` na szerokości 360 px i 1280 px. Zrzuty ekranu dołącz do PR.
- [ ] **Step 6: Commit** `feat(ui): app shell with responsive layout, banners and progress menu`.

---

### Task 20: Testy E2E

**Files:**
- Create: `e2e/app.spec.ts`, `e2e/fixtures/style.json` (minimalny styl: tło + jedna warstwa `symbol`), `e2e/fixtures/flat-tile.png` (kafel terrarium 0 m)
- Modify: `playwright.config.ts` (`webServer: npm run build && npx vite preview --port 4173`, `baseURL: http://localhost:4173/korona-gor-polskich/`, tylko Chromium)

**Interfaces:**
- Consumes: zbudowana aplikacja (19), prawdziwe dane z `public/data/` (11)

- [ ] **Step 1: Napisz testy** (`page.route`: `tiles.openfreemap.org/**` → `style.json` lub pusta odpowiedź 204 dla kafli, `elevation-tiles-prod/**` → `flat-tile.png`, pozostałe zewnętrzne adresy → `abort`)
  - `clicking Babia Góra in the list opens its card with at least one route`
  - `marking Babia Góra as done survives reload and the counter shows '1 / 28'`
  - `export then import restores the same progress` (`page.waitForEvent('download')`, potem `setInputFiles`)
  - `Pobierz GPX downloads a file named babia-gora--*.gpx`
  - `at 360 px width the page has no horizontal scroll` (`document.documentElement.scrollWidth <= 360`)
- [ ] **Step 2: Uruchom `npm run e2e`.** Oczekiwany wynik: PASS. Jeśli coś nie przechodzi, popraw kod aplikacji, a nie testy, zgodnie z superpowers:systematic-debugging.
- [ ] **Step 3: Sprawdź CI** (`gh pr checks --watch`). Krok E2E w `ci.yml` jest teraz aktywny.
- [ ] **Step 4: Commit** `test(e2e): cover peak selection, progress, import/export and GPX`.
