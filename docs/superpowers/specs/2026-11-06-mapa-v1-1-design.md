# Korona Gór Polskich v1.1: jeden obszar gór, interaktywne szlaki, więcej tras

Data: 2026-11-06
Status: do akceptacji
Uzupełnia: `docs/superpowers/specs/2026-10-15-korona-gor-polskich-mapa-3d-design.md` (dalej „spec v1”). Wszystko, czego ten dokument nie zmienia, obowiązuje bez zmian.

## 1. Cel

Mapa ma skupiać uwagę wyłącznie na górach Korony, a proponowane trasy i szlaki mają być czytelne i klikalne. Zmiany wynikają z uwag właściciela po pierwszej wersji:

1. Wszystkie góry od Wysokiej Kopy po Tarnicę tworzą jeden obszar, Łysica jest osobno. Nie da się przesunąć mapy poza góry.
2. Rzeźba terenu jest wyraźniejsza.
3. Paski kolorów przy trasie pokazują tylko szlaki, którymi faktycznie się idzie.
4. Proponowane trasy i dowolne szlaki reagują na najechanie i kliknięcie.
5. Każdy szczyt ma wszystkie sensowne trasy, a nie tylko 3.

### Kryteria sukcesu

- W widoku całej mapy widać jeden obszar gór (Sudety, Beskidy z Tatrami, Bieszczady) i osobną Łysicę. Wszystko poza nimi jest wygaszone.
- Przesuwanie i oddalanie nie pozwala wyjść poza prostokąt obejmujący oba obszary z marginesem.
- Trasa z Zawoi Markowej na Babią Górę ma najwyżej tyle kolorów, ile szlaków trzeba zmienić w terenie (spodziewane 2–3, nie 5).
- Najechanie na proponowaną trasę na mapie podświetla ją i pokazuje nazwę, dystans i czas. Kliknięcie wybiera ją tak samo jak kliknięcie na liście.
- Najechanie na dowolny kolorowy odcinek podświetla wszystkie szlaki, które nim biegną, na całej ich długości w promieniu 10 km. Kliknięcie pokazuje okienko z ich nazwami i kolorami.
- Każdy szczyt ma od 1 do 20 tras. Lista w karcie jest posortowana od najkrótszego czasu i da się ją przewijać.

## 2. Decyzje

| Temat | Decyzja | Odrzucone |
|---|---|---|
| Kształt obszaru gór | Liczony offline w pipeline (`@turf/buffer`, `@turf/union` jako devDependencies) i zapisywany do `public/data/mountain-area.json`. Aplikacja tylko go wczytuje. | Liczenie w przeglądarce bez biblioteki do sumy wielokątów: nie da się połączyć nachodzących na siebie kształtów. Dodanie turf do kodu aplikacji: zbędny rozmiar paczki. |
| Łączenie pasm | Bufor wokół szczytów i tras plus jawne „mosty” między grupami: drzewo rozpinające (MST) najbliższych szczytów sąsiednich grup. Łysica jest wyłączona z łączenia listą w kodzie (`ISOLATED_PEAKS = ['lysica']`). | Otoczka wypukła całości: zakrywa Ostrawę i Katowice. Morfologiczne domknięcie: przy potrzebnym promieniu wciąga też Łysicę. |
| Blokada przesuwania | `maxBounds` = prostokąt obu obszarów + 0,3° marginesu; `minZoom` tak, żeby prostokąt mieścił się w oknie. | Brak blokady (stan v1). |
| Rzeźba | Przesadzenie terenu 1,8 (było 1,3), `hillshade-exaggeration` 0,7 (było 0,5). | — |
| Wszystkie szlaki | Zostają w kolorach PTTK (decyzja właściciela). | Szara siatka, ukrycie szlaków. |
| Kolory trasy | Sekwencja szlaków wybrana algorytmem minimalizującym liczbę przesiadek (patrz 3.2). | Suma kolorów wszystkich szlaków na odcinkach (stan v1). |
| Liczba tras | Wszystkie trasy spełniające reguły, maks. 20 na szczyt. | 3 (v1), 5 najszybszych. |
| Issue #10 | Rozstrzygnięte przez „wszystkie sensowne”: lista zawiera i krótkie, i klasyczne wejścia. | — |

## 3. Pipeline danych

### 3.1 Obszar gór (`pipeline/src/area.ts`)

- Wejście: `peaks.json` i geometrie tras ze wszystkich plików szczytów w katalogu wyjściowym.
- Dla każdego szczytu: koło o promieniu 12 km. Dla każdej trasy: bufor 4 km wokół linii.
- Grupy: szczyty łączone w grupy, gdy ich kształty się przecinają. Łysica nigdy nie jest łączona.
- Mosty: między grupami (poza Łysicą) liczone jest MST po odległościach najbliższych par szczytów. Każda krawędź MST staje się „kapsułą”, czyli buforem 15 km wokół odcinka łączącego te dwa szczyty.
- Wynik: suma (`union`) wszystkich kształtów, uproszczona z tolerancją 200 m, współrzędne zaokrąglone do 4 miejsc.
- Plik `public/data/mountain-area.json`: `{ "areas": MultiPolygon, "bounds": [west, south, east, north] }`. `bounds` to prostokąt `areas` powiększony o 0,3°.
- Polecenie `npm run data:area` liczy obszar z istniejących danych bez sieci. `data:build` uruchamia je na końcu.
- Oczekiwane: dokładnie 2 wielokąty (główne pasmo i Łysica). Kraków, Katowice, Wrocław i Warszawa są poza obszarem, a Zakopane, Karpacz, Wisła i Ustrzyki Górne wewnątrz.

### 3.2 Kolory trasy

- Każda krawędź ścieżki ma zbiór kolorów szlaków.
- Wybór jednego koloru na krawędź algorytmem Viterbiego. Koszt to liczba zmian koloru, a remisy rozstrzyga dłuższy łączny odcinek w danym kolorze, potem kolejność `PTTK_COLORS`.
- `colors` trasy to sekwencja kolorów po kolei bez powtórzeń sąsiednich, np. `["red", "yellow"]`. Ten sam kolor może wystąpić ponownie dalej, jeśli trasa wraca na szlak.
- Nowe pole `legs: { color, lengthM }[]` (te same odcinki co `colors`, z długością w metrach, zaokrągloną do 10 m) w schemacie trasy.
- Krawędzie nieoznakowane (`summitPath`) nie dostają koloru: noga ma `color: "none"`, a w `colors` się nie pojawia.

### 3.3 Szlaki z identyfikatorem relacji

- Każdy odcinek szlaku w `trails` dostaje `properties.relations: { id: number; name?: string; color: PttkColor }[]`, czyli relacje OSM, do których należy. Pole `colors` zostaje dla zgodności (unikalne kolory relacji).
- Aplikacja podświetla „cały szlak” jako wszystkie odcinki z danym `relations[].id`.

### 3.4 Więcej tras

- `selectRoutes`: `maxCount` 20, odstęp startów ≥ 1000 m, pokrycie ≤ 0,8. Kolejność rosnąco po `durationMin`, jak w v1.
- `route-overrides.json`: `maxRoutes` dopuszcza 1–20. Dotychczasowe wpisy obowiązują.
- Schemat: `routes.max(20)`, `routeCount` 0–20.
- Ostrzeżenie o rozmiarze pliku szczytu: powyżej 1 500 000 bajtów (było 500 000).
- Nowe trasy bez wpisu `rename` dostają nazwę domyślną „Z <nazwa startu>” zamiast „Start → Szczyt”, bo test spójności wymaga prefiksu „Z/Ze/Spod”.

### 3.5 Regeneracja danych

Pełny `data:build` z siecią, przegląd raportu, poprawki w `route-overrides.json` (m.in. nowa nazwa startu przy Lackowej). PR z tabelą zmian liczby tras na szczyt.

## 4. Aplikacja

### 4.1 Maska, blokada i rzeźba

- `src/data/api.ts`: `loadMountainArea()` wczytuje i waliduje `mountain-area.json` (nowy schemat `MountainAreaSchema`).
- Maska i ograniczanie etykiet (z v1.0) używają `areas` z pliku zamiast liczenia `mountainAreas` w przeglądarce. `src/map/mask.ts` zostaje tylko z `outsideMask`.
- Mapa: `setMaxBounds(bounds)`, `minZoom` = zoom, przy którym `bounds` mieści się w kontenerze (przeliczany przy zmianie rozmiaru).
- `TERRAIN_EXAGGERATION = 1.8`, `hillshade-exaggeration` 0,7.
- Gdy pliku obszaru nie da się wczytać: mapa działa bez maski i bez blokady, bez komunikatu (to tylko ozdoba).

### 4.2 Interakcja z trasami na mapie

- Nowa warstwa `routes` pokazuje wszystkie trasy wybranego szczytu jako cienkie linie (2 px, kolor trasy `#6a1b9a`, krycie 0,55) pod szlakami.
- Najechanie (`mousemove`) na trasę: pogrubienie, krycie 1, kursor wskazujący i podpowiedź (MapLibre `Popup` bez przycisku zamknięcia) „<nazwa> · <dystans> na szczyt · <czas>”.
- Kliknięcie trasy wywołuje `onRouteSelect(routeId)`, czyli to samo, co kliknięcie na liście.
- Wybrana trasa jak w v1 (`route-selected`). Pozostałe trasy szczytu zostają widoczne w trybie cienkim.
- Najechanie na wiersz listy tras podświetla tę trasę na mapie.

### 4.3 Interakcja ze szlakami

- Najechanie na odcinek szlaku podświetla (szersza linia, białe obramowanie) wszystkie odcinki relacji, do których należy odcinek pod kursorem. Działa przez `feature-state` albo filtr po `relationIds`.
- Kliknięcie otwiera okienko (`Popup` z przyciskiem zamknięcia) z listą: kolorowy pasek + nazwa szlaku (albo „Szlak <kolor>” bez nazwy). Klik obok zamyka okienko.
- Priorytet przy nakładaniu: trasa > szlak. Najechanie na trasę nie podświetla szlaków pod nią.
- Na urządzeniach dotykowych: dotknięcie = kliknięcie, a podświetlenie trwa do następnego dotknięcia.

### 4.4 Lista tras

- Karta szczytu pokazuje wszystkie trasy posortowane rosnąco po czasie. Lista przewija się w obrębie karty.
- Nad listą jest licznik „N tras”.
- Paski kolorów pokazują `colors` w kolejności, ze strzałkami między nimi („czerwony → żółty”) i etykietami dla czytników ekranu.

## 5. Obsługa błędów

| Sytuacja | Zachowanie |
|---|---|
| Brak lub zły `mountain-area.json` | Mapa bez maski i bez `maxBounds`, reszta działa. |
| Trasa bez nóg w kolorze (sama ścieżka nieoznakowana) | `colors` puste jest niedozwolone, więc pipeline zgłasza błąd szczytu. |
| Szlak bez nazwy w OSM | W okienku: „Szlak czerwony” (nazwa koloru po polsku). |

## 6. Testy

- **Pipeline:**
  - Viterbi: odcinek wspólny czerwonego i żółtego między czerwonym a czerwonym daje `["red"]`; zmiana szlaku w połowie daje `["red", "yellow"]`; remis długości.
  - Relacje na odcinkach szlaków.
  - `selectRoutes` z nowymi parametrami.
  - Obszar: 2 wielokąty; wymienione miasta wewnątrz i na zewnątrz; Łysica osobno; poprawna orientacja; `bounds` zawiera oba wielokąty.
- **Aplikacja:**
  - Walidacja `mountain-area.json`.
  - `minZoom` z `bounds`.
  - Warstwy `routes` i podświetlania szlaków (specyfikacje warstw).
  - MapView z atrapą: najechanie i kliknięcie trasy wywołuje `onRouteSelect`; najechanie na szlak ustawia podświetlenie relacji; kliknięcie szlaku otwiera okienko z nazwami.
  - Karta: licznik tras, sortowanie, strzałki kolorów.
- **Spójność danych:** 1–20 tras na szczyt, każda trasa ma `legs`, a suma ich długości jest równa `distanceKm` z tolerancją 2%; plik obszaru istnieje i przechodzi schemat.
- **E2E:** bez zmian w scenariuszach; liczba tras ≥ 1.

## 7. Poza zakresem

Własne wyznaczanie tras przez użytkownika, filtrowanie tras po trudności, podgląd tras wszystkich szczytów naraz.
