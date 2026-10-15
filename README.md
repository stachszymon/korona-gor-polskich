# Korona Gór Polskich

Interaktywna mapa 3D 28 szczytów Korony Gór Polskich. Dla każdego szczytu aplikacja pokazuje szlaki PTTK w okolicy i gotowe trasy wejścia z dystansem, przewyższeniem, szacowanym czasem na szczyt i profilem wysokości. Każdą trasę można pobrać jako GPX. Postęp („Zdobyty”, „Planuję”, data, notatka) zapisuje się w przeglądarce (localStorage) i można go wyeksportować do pliku albo z niego zaimportować.

Aplikacja działa na żywo: **https://stachszymon.github.io/korona-gor-polskich/**

Aplikacja jest w pełni statyczna (Vite, React, MapLibre GL, GitHub Pages) i nie ma backendu. Dane o szczytach i trasach są wygenerowane z OpenStreetMap i leżą w repozytorium w `public/data/`.

## Uruchomienie

Potrzebny jest Node.js 22.

```sh
npm ci            # instalacja zależności
npm run dev       # serwer deweloperski (Vite)
npm test          # testy jednostkowe (Vitest)
npm run lint      # ESLint
npm run typecheck # TypeScript
npm run build     # build produkcyjny do dist/
npm run e2e       # testy end-to-end (Playwright)
```

### Generowanie danych

`npm run data:build` buduje `public/data/` od nowa:

1. pobiera z OpenStreetMap szczyty, szlaki PTTK i miejsca startu;
2. wyznacza trasy;
3. pobiera wysokości z AWS Terrain Tiles.

Katalog `public/data/` jest podmieniany dopiero wtedy, gdy wszystkie szczyty zbudują się poprawnie.

```sh
npm run data:build                                     # źródło: Overpass API
npm run data:build -- --cache=.superpowers/osm-cache   # z podręczną pamięcią odpowiedzi OSM na dysku
npm run data:build -- --source=osm-api                 # zapasowe źródło: OSM API 0.6, gdy Overpass nie działa
```

Opcje można łączyć, np. `--source=osm-api --cache=<katalog>`. Pamięć podręczna ma osobny podkatalog dla każdego źródła.

Ręczne poprawki tras są w `pipeline/route-overrides.json`:

- `exclude`: pomija miejsca startu;
- `rename`: zmienia nazwy tras (konwencja: „Z …”, „Ze …”);
- `maxRoutes`: ogranicza liczbę tras;
- `addTrailhead`: dodaje miejsce startu;
- `summitPath`: dorysowuje ostatni odcinek na szczyt.

Lista szczytów jest w `pipeline/peaks.source.json`. Po przebudowie danych przejrzyj raport w konsoli i `git diff public/data`.

## Dane i licencje

### OpenStreetMap: szczyty, szlaki i trasy (`public/data/`)

Dane o szczytach, szlakach i trasach pochodzą z OpenStreetMap: © autorzy OpenStreetMap. Są dostępne na licencji [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/) (zob. też [openstreetmap.org/copyright](https://www.openstreetmap.org/copyright)).

Pliki w `public/data/` (`peaks.json` i `peaks/*.json`) są bazą danych pochodną (derived database) danych OpenStreetMap. Udostępniamy je na tej samej licencji, ODbL 1.0. Wysokości w tych plikach pochodzą z AWS Terrain Tiles (niżej).

### Podkład mapowy

[OpenFreeMap](https://openfreemap.org) (styl Liberty), kafelki w schemacie [OpenMapTiles](https://openmaptiles.org): © OpenMapTiles, dane © autorzy OpenStreetMap.

### Dane wysokościowe (teren 3D, cieniowanie, poziomice, profile)

[AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen / Tilezen). Zestaw łączy kilka źródeł. Pełna lista atrybucji: [tilezen/joerd: attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). Dla Europy obejmuje ona m.in. EU-DEM:

> Produced using Copernicus data and information funded by the European Union – EU-DEM layers.

Atrybucje są też widoczne w stopce aplikacji i w kontrolce atrybucji mapy.

### Licencja kodu

Do ustalenia ([#12](https://github.com/stachszymon/korona-gor-polskich/issues/12)).
