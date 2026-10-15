# Korona Gór Polskich: mapa 3D i planer wyjść (specyfikacja v1)

Data: 2026-10-15
Status: do akceptacji

## 1. Cel

Publicznie dostępna strona internetowa, na której każdy może:

- obejrzeć na mapie 3D (topograficznej, z rzeźbą terenu) wszystkie 28 szczytów Korony Gór Polskich (KGP) oraz szlaki turystyczne wokół nich,
- zaplanować wyjście na szczyt, korzystając z gotowych tras (start, dystans, podejścia, czas, profil wysokości, plik GPX),
- zapisywać swoje osiągnięcia (zdobyte i planowane szczyty) w pamięci przeglądarki.

Wersja 1 nie ma backendu ani kont. Format zapisu postępu ma pozwolić na późniejsze dodanie kont i synchronizacji bez zmiany modelu danych.

### Kryteria sukcesu

- Strona działa jako statyczny serwis na GitHub Pages, bez kluczy API i bez kosztów utrzymania.
- Każdy z 28 szczytów ma co najmniej 1 gotową trasę (najwyżej 3) z dystansem, sumą podejść i zejść, szacowanym czasem, profilem wysokości i plikiem GPX.
- Szlaki są rysowane w kolorach PTTK (czerwony, niebieski, zielony, żółty, czarny), a drogi i pozostałe elementy podkładu nie dominują nad szlakami.
- Postęp użytkownika przetrwa przeładowanie strony i da się go wyeksportować oraz zaimportować jako plik JSON.
- Strona jest używalna na telefonie (szerokość od 360 px).

## 2. Decyzje podjęte podczas projektowania

| Temat | Decyzja | Odrzucone alternatywy i powód |
|---|---|---|
| Silnik mapy | MapLibre GL JS | MapTiler: publiczny klucz API i limit wyświetleń. CesiumJS: token Cesium ion z limitami planu Community, wygląd topo tylko z cudzych kafli rastrowych, ciężkie na telefonach. |
| Podkład | OpenFreeMap (styl „Liberty”, wektorowy) w zmodyfikowanej wersji „górskiej” | Gotowe nakładki rastrowe (np. Waymarked Trails): nie da się zmienić ich stylu, w demo zbyt mocno dominowały. |
| Teren 3D i cieniowanie | AWS Terrain Tiles (kodowanie `terrarium`, publiczny zbiór danych) | — |
| Poziomice | Generowane w przeglądarce z DEM (`maplibre-contour`) | — |
| Szlaki i trasy | Własne dane wygenerowane z OpenStreetMap skryptem i zapisane jako pliki statyczne | Zapytania do Overpass na żywo z przeglądarki: serwery Overpass bywają niedostępne (15.10.2026 zwracały 502/500), a zapytania z przeglądarki blokuje CORS przy błędach. |
| Planowanie | Gotowe trasy (do 3 na szczyt), bez wyznaczania tras przez użytkownika | Wyznaczanie trasy w przeglądarce: znacznie bardziej złożone, odłożone na później. |
| Zapis postępu | `localStorage` oraz eksport i import pliku JSON | Backend z kontami: odłożony na później. |
| Framework | Vite, TypeScript, React | — |
| Hosting | GitHub Pages, wdrażany z GitHub Actions | — |

Prototyp potwierdzający wygląd (rzucany, poza repo) pokazał, że połączenie MapLibre, OpenFreeMap, AWS Terrain Tiles i `maplibre-contour` działa bez klucza na Babiej Górze, Rysach i Śnieżce. Pokazał też, że drogi da się stonować przez zmianę właściwości warstw stylu.

## 3. Architektura

Repozytorium składa się z dwóch niezależnych części, które łączą się tylko przez pliki w `public/data/`.

```
korona-gor-polskich/
├── pipeline/                  # skrypty generujące dane (Node + TypeScript), uruchamiane ręcznie
│   ├── src/
│   │   ├── overpass.ts        # pobieranie z Overpass: lustra, ponowienia, User-Agent
│   │   ├── osmc.ts            # kolor PTTK z osmc:symbol / colour
│   │   ├── graph.ts           # graf szlaków z odcinków (ways) relacji hiking
│   │   ├── trailheads.ts      # wyszukiwanie punktów startu
│   │   ├── routes.ts          # wyznaczanie i wybór tras
│   │   ├── elevation.ts       # próbkowanie DEM (terrarium), podejścia, zejścia, profil
│   │   ├── timing.ts          # szacowany czas przejścia
│   │   ├── overrides.ts       # ręczne poprawki tras
│   │   └── build.ts           # punkt wejścia: generuje public/data/
│   ├── peaks.source.json      # ręcznie przygotowana lista 28 szczytów
│   ├── route-overrides.json   # ręczne poprawki tras
│   └── fixtures/              # zapisane odpowiedzi Overpass i kafle DEM do testów
├── public/data/               # wynik pipeline'u, commitowany do repo
│   ├── peaks.json
│   └── peaks/<peak-id>.json   # szlaki i trasy dla jednego szczytu
└── src/                       # aplikacja (React), czyta tylko public/data/
    ├── map/                   # inicjalizacja MapLibre, styl górski, warstwy
    ├── data/                  # wczytywanie peaks.json i plików szczytów
    ├── progress/              # zapis postępu, walidacja, migracje, eksport i import
    ├── gpx/                   # generowanie pliku GPX
    └── ui/                    # komponenty: lista, karta szczytu, profil, baner
```

### 3.1 Pipeline danych

Uruchamiany ręcznie poleceniem `npm run data:build`. Nie jest częścią builda strony ani CI, bo zależy od zewnętrznych serwerów Overpass i DEM. Wynik trafia do repo osobnym PR, żeby zmiany w trasach dało się przejrzeć.

**Lista szczytów (`peaks.source.json`)**, przygotowana ręcznie według oficjalnej listy KGP. Pola: `id` (slug, np. `babia-gora`), `name`, `range` (pasmo), `elevation` (m n.p.m. według listy KGP), `lat`, `lon`, `osmNodeId`.

Lista 28 szczytów: Rysy (Tatry), Babia Góra (Beskid Żywiecki), Śnieżka (Karkonosze), Śnieżnik (Masyw Śnieżnika), Tarnica (Bieszczady), Turbacz (Gorce), Radziejowa (Beskid Sądecki), Skrzyczne (Beskid Śląski), Mogielica (Beskid Wyspowy), Wysoka Kopa (Góry Izerskie), Rudawiec (Góry Bialskie), Orlica (Góry Orlickie), Wysoka (Pieniny), Wielka Sowa (Góry Sowie), Lackowa (Beskid Niski), Kowadło (Góry Złote), Jagodna (Góry Bystrzyckie), Skalnik (Rudawy Janowickie), Czupel (Beskid Mały), Waligóra (Góry Kamienne), Szczeliniec Wielki (Góry Stołowe), Lubomir (Beskid Makowski), Biskupia Kopa (Góry Opawskie), Chełmiec (Góry Wałbrzyskie), Kłodzka Góra (Góry Bardzkie), Skopiec (Góry Kaczawskie), Ślęża (Masyw Ślęży), Łysica (Góry Świętokrzyskie).

Pipeline sprawdza każdy szczyt względem węzła `natural=peak` w OSM. Jeśli współrzędne różnią się o więcej niż 200 m albo wysokość o więcej niż 10 m, przerywa pracę z listą rozbieżności do ręcznej decyzji. Nie poprawia danych automatycznie. Po sprawdzeniu rozbieżność można zaakceptować polem `acceptOsmMismatch: true` przy danym szczycie. Wtedy pipeline tylko ją wypisuje w raporcie, a obowiązują wartości z `peaks.source.json`.

**Pobieranie z Overpass:**
- zapytanie o relacje `route=hiking` w promieniu 10 km od szczytu (`out geom`) oraz o kandydatów na punkty startu w tym samym promieniu,
- kolejno serwery lustrzane: `overpass-api.de`, `overpass.private.coffee`, `overpass.kumi.systems`, z nagłówkiem `User-Agent` identyfikującym projekt (bez niego serwer zwraca 406),
- do 3 ponowień na serwer z wykładniczym odstępem,
- gdy wszystkie zawiodą, skrypt kończy się błędem i nie nadpisuje istniejących plików w `public/data/`.

**Kolor szlaku:** pierwszy człon `osmc:symbol` (np. `red:white:red_bar` daje `red`), a gdy go brak, tag `colour`. Dozwolone wartości to `red`, `blue`, `green`, `yellow`, `black`. Relacje z innym kolorem lub bez koloru są pomijane i odnotowywane w raporcie pipeline'u.

**Graf szlaków:** wierzchołki to węzły OSM na końcach i przecięciach odcinków szlaków, a krawędzie to fragmenty odcinków z długością w metrach i listą kolorów szlaków, które nimi biegną. Szczyt dołącza się do najbliższego wierzchołka grafu, który musi leżeć w promieniu 150 m. W przeciwnym razie szczyt trafia do raportu jako błąd.

**Punkty startu (kandydaci):** wierzchołki grafu leżące najdalej 300 m od:
- parkingu (`amenity=parking`),
- stacji lub przystanku kolejowego (`railway=station|halt`),
- przystanku autobusowego (`highway=bus_stop`),
- środka miejscowości (`place=village|town|hamlet`).

Nazwa startu pochodzi z nazwy tego obiektu albo najbliższej miejscowości.

**Wyznaczanie i wybór tras:**
1. Algorytm Dijkstry ze szczytu do wszystkich kandydatów po krawędziach grafu.
2. Odrzucenie tras dłuższych niż 20 km (w jedną stronę) i krótszych niż 1 km.
3. Ranking według szacowanego czasu przejścia (rosnąco).
4. Wybór zachłanny do 3 tras: kolejna trasa jest dodawana tylko wtedy, gdy jej start leży co najmniej 2 km od startów już wybranych tras, a nie więcej niż 50% jej długości pokrywa się z wybraną trasą.
5. Zastosowanie `route-overrides.json` (patrz niżej).

**Wysokości:** geometria trasy jest próbkowana co 25 m. Wysokość każdej próbki pochodzi z kafli AWS Terrain Tiles `terrarium` na zoomie 14, z interpolacją dwuliniową. Suma podejść i zejść jest liczona z profilu wygładzonego średnią kroczącą z 5 próbek, z progiem 2 m, żeby szum DEM nie zawyżał wyniku.

**Szacowany czas (w jedną stronę, na szczyt):** `czas_h = dystans_km / 4 + podejścia_m / 600`. To 4 km/h po płaskim i 10 minut na każde 100 m podejścia. Wynik jest zaokrąglany do 5 minut. Interfejs opisuje go jako szacunek.

**Ręczne poprawki (`route-overrides.json`)**, kluczowane `peakId`. Obsługiwane operacje:
- `exclude`: lista identyfikatorów startów do pominięcia,
- `rename`: mapa identyfikatora trasy na nazwę wyświetlaną, np. „Z Zawoi przez Markowe Szczawiny”,
- `addTrailhead`: dodatkowy punkt startu (`lat`, `lon`, `name`), który pipeline traktuje jak kandydata.

Identyfikator trasy ma postać `<peakId>--<trailheadId>`, gdzie `trailheadId` to slug nazwy startu. Dzięki temu poprawki przetrwają ponowne uruchomienie pipeline'u.

**Upraszczanie i rozmiar:** linie szlaków i tras są upraszczane algorytmem Douglasa-Peuckera z tolerancją około 5 m, a współrzędne zaokrąglane do 5 miejsc po przecinku. Docelowy rozmiar pliku jednego szczytu to najwyżej 500 KB (przekroczenie jest ostrzeżeniem w raporcie).

**Raport:** pipeline wypisuje dla każdego szczytu liczbę relacji, liczbę pominiętych relacji (z powodem) i wybrane trasy z dystansem i czasem. Trasy przegląda człowiek przed commitem.

### 3.2 Format danych w `public/data/`

`peaks.json`, wczytywany przy starcie:

```json
{
  "generatedAt": "2026-10-15T12:00:00Z",
  "peaks": [
    { "id": "babia-gora", "name": "Babia Góra", "range": "Beskid Żywiecki",
      "elevation": 1725, "lat": 49.5732, "lon": 19.5294, "routeCount": 3 }
  ]
}
```

`peaks/<peak-id>.json`, wczytywany po wybraniu szczytu:

```json
{
  "peakId": "babia-gora",
  "trails": { "type": "FeatureCollection", "features": [
    { "type": "Feature", "properties": { "colors": ["red"], "name": "Główny Szlak Beskidzki" },
      "geometry": { "type": "LineString", "coordinates": [[19.5, 49.57]] } }
  ]},
  "routes": [
    { "id": "babia-gora--zawoja-markowa", "name": "Z Zawoi Markowej",
      "trailhead": { "name": "Zawoja Markowa", "lat": 49.6, "lon": 19.5, "kind": "parking" },
      "distanceKm": 7.4, "ascentM": 980, "descentM": 40, "durationMin": 210,
      "colors": ["red", "yellow"],
      "geometry": { "type": "LineString", "coordinates": [[19.5, 49.6, 870]] },
      "profile": [[0, 870], [25, 872]] }
  ]
}
```

`coordinates` trasy zawierają trzecią współrzędną, czyli wysokość w metrach. `profile` to pary `[dystans_m, wysokość_m]`.

### 3.3 Aplikacja

**Mapa (`src/map/`):**
- styl OpenFreeMap „Liberty” pobierany w czasie działania i modyfikowany przed przekazaniem do MapLibre („styl górski”):
  - ukryte warstwy: obwódki dróg (`*_casing`), tarcze i nazwy dróg (`highway-shield*`, `road_shield*`, `highway-name-minor`, `highway-name-major`), POI (`poi_*`), strzałki jednokierunkowe, budynki 3D,
  - linie dróg w kolorze `#a89f91` o szerokości zależnej od zoomu (0,3 px na zoomie 10, 2,5 px na zoomie 16),
  - mocniej zaznaczony las,
- teren 3D z przesadzeniem 1,3, cieniowanie rzeźby, poziomice (z opisami wysokości na głównych liniach), niebo i mgła atmosferyczna,
- własne warstwy:
  - `trails`: szlaki w kolorach PTTK. Odcinek z kilkoma szlakami jest rysowany jako równoległe linie z przesunięciem (`line-offset`),
  - `route-selected`: wybrana trasa, pogrubiona, z białą obwódką. Gdy jest wybrana trasa, warstwa `trails` ma krycie 0,35,
  - `peaks`: znaczniki szczytów w kolorze zależnym od statusu, z podpisem „nazwa, wysokość”,
  - `profile-cursor`: punkt na trasie odpowiadający pozycji kursora na profilu.

**Kolory statusów:** zdobyty `#2e7d32`, planowany `#f9a825`, do zdobycia `#c62828`.
**Kolory PTTK:** czerwony `#d32f2f`, niebieski `#1565c0`, zielony `#2e7d32`, żółty `#f9a825`, czarny `#212121`.

**Interfejs (`src/ui/`)**, w całości po polsku:
- **Widok startowy:** mapa południowej Polski pochylona o 50°, obejmująca wszystkie 28 szczytów, i licznik postępu „zdobyte / 28”.
- **Lista szczytów:** na szerokości od 768 px panel boczny, poniżej wysuwany panel od dołu. Filtry: pasmo, status. Sortowanie: wysokość (domyślnie malejąco), nazwa.
- **Wybór szczytu** (z listy lub znacznika): przelot kamery do szczytu (pochylenie 65°, około 3 s), wczytanie `peaks/<id>.json` i otwarcie karty szczytu.
- **Karta szczytu:** nazwa, wysokość, pasmo, przyciski statusu, lista tras. Każda trasa pokazuje nazwę, punkt startu, dystans, podejścia, szacowany czas i kolorowe paski szlaków.
- **Wybór trasy:** kamera dopasowuje widok do całej trasy, trasa jest podświetlona, pod mapą pojawia się profil wysokości (SVG). Ruch kursora lub palca po profilu przesuwa punkt na mapie. Przycisk „Pobierz GPX”.
- **Status szczytu:** „Zdobyty” z opcjonalną datą i notatką, „Planuję” z opcjonalną planowaną datą, oraz „Wyczyść”.
- **Menu „Mój postęp”:** eksport do pliku `kgp-postep-RRRR-MM-DD.json` i import z pliku, z podglądem („12 zdobytych, 3 planowane, nadpisze obecny postęp”) i potwierdzeniem.
- **Stopka z atrybucjami:** © autorzy OpenStreetMap, OpenFreeMap, OpenMapTiles, źródła danych wysokościowych AWS Terrain Tiles.

**Zapis postępu (`src/progress/`):**
- klucz `localStorage`: `kgp.progress`,
- format:

```json
{ "version": 1,
  "updatedAt": "2026-10-15T12:00:00Z",
  "peaks": { "babia-gora": { "status": "done", "date": "2026-08-14", "note": "Mgła" } } }
```

- `status` to `"done"` albo `"planned"`. Szczyt bez wpisu ma status „do zdobycia”. `date` jest opcjonalna, w formacie ISO `RRRR-MM-DD`, a `note` to opcjonalny tekst do 500 znaków,
- odczyt przechodzi przez walidację schematu i funkcję migracji (`migrate(v) → v1`), żeby przyszłe wersje formatu mogły wczytywać stare dane,
- ten sam format służy do eksportu i importu oraz w przyszłości do synchronizacji z backendem.

**GPX (`src/gpx/`):** GPX 1.1 z jednym `<trk>`, którego `<name>` to nazwa trasy, z punktami `<trkpt lat lon>` i `<ele>`. Nazwa pliku: `<route-id>.gpx`. Plik powstaje w przeglądarce.

## 4. Obsługa błędów

| Sytuacja | Zachowanie |
|---|---|
| Brak WebGL | Zamiast mapy komunikat „Twoja przeglądarka nie obsługuje mapy 3D” i sama lista szczytów z kartami, trasami (bez profilu na mapie), statusami i GPX. |
| Kafle podkładu lub terenu nie wczytują się | Mapa pokazuje to, co się wczytało. Szczyty, szlaki i trasy pochodzą z naszych plików, więc pozostają widoczne. Pojawia się nieblokujący komunikat „Część mapy nie wczytała się”. |
| Nie wczytał się `peaks.json` lub plik szczytu | Komunikat z przyciskiem „Spróbuj ponownie”. Reszta aplikacji działa. |
| `localStorage` niedostępny lub rzuca wyjątek | Aplikacja działa, postęp jest trzymany w pamięci sesji, a na górze widać baner „Postęp nie zostanie zapisany w tej przeglądarce”. |
| Uszkodzone dane w `kgp.progress` | Dane są kopiowane pod klucz `kgp.progress.corrupt-<timestamp>`, postęp startuje pusty, a użytkownik dostaje komunikat. Dane nie są nigdy kasowane po cichu. |
| Niepoprawny plik importu | Import jest odrzucany z komunikatem o przyczynie, a obecny postęp pozostaje nietknięty. |
| Overpass lub DEM niedostępny w pipeline | Ponowienia i serwery lustrzane, a w ostateczności błąd bez nadpisywania `public/data/`. |

## 5. Testy

Zgodnie z TDD: najpierw test, który nie przechodzi, potem minimalna implementacja.

- **Pipeline (Vitest, bez sieci, na plikach z `pipeline/fixtures/`):**
  - parsowanie koloru z `osmc:symbol` i `colour`,
  - budowa grafu i dołączenie szczytu,
  - wyszukiwanie punktów startu,
  - wyznaczanie tras, w tym reguły odstępu startów i pokrycia,
  - podejścia i zejścia z progiem i wygładzaniem,
  - formuła czasu,
  - zastosowanie `route-overrides.json`,
  - logika ponowień i serwerów lustrzanych (z atrapą `fetch`).
- **Aplikacja, testy jednostkowe (Vitest):** walidacja i migracja postępu, obsługa uszkodzonych danych i braku `localStorage`, eksport i import, generowanie GPX (poprawny XML, wysokości, nazwa), filtrowanie i sortowanie listy, modyfikacja stylu górskiego (ukryte warstwy, zmienione właściwości).
- **Komponenty (Testing Library, atrapa MapLibre):** lista, karta szczytu, przyciski statusu, profil wysokości, baner braku zapisu.
- **E2E (Playwright, na zbudowanej stronie, z kaflami podstawionymi przez przechwytywanie żądań):**
  - kliknięcie szczytu na liście otwiera kartę z trasami,
  - oznaczenie szczytu jako zdobyty przetrwa przeładowanie strony i zmienia licznik,
  - eksport, a potem import, przywraca ten sam postęp,
  - „Pobierz GPX” zwraca plik o oczekiwanej nazwie.
- **Test spójności danych (na `public/data/`):** dokładnie 28 szczytów, każdy ma 1–3 trasy, ostatni punkt każdej trasy leży najdalej 150 m od szczytu, a każdy plik szczytu przechodzi walidację schematu.

## 6. Wdrożenie i CI

- Repozytorium na GitHubie, gałąź `main`.
- GitHub Actions dla każdego PR i `main`: lint (ESLint), sprawdzanie typów (`tsc --noEmit`), testy jednostkowe i komponentowe, test spójności danych, build, testy E2E.
- Po zmianie na `main` build jest publikowany na GitHub Pages (`base` w Vite ustawiony na ścieżkę repozytorium).
- Pipeline danych nie działa w CI. Jest uruchamiany lokalnie, a wynik trafia do repo w osobnym PR.

## 7. Poza zakresem v1

Konta i synchronizacja postępu, wyznaczanie własnych tras, pogoda, zdjęcia, przełącznik na podkład satelitarny, wersja angielska, tryb offline (PWA).
