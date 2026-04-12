# Plan: Self-Hosted COD-AB Geocoding Service (All Countries)

## Context

A separate app currently supports coordinate → admin P-code lookups for Jamaica and Mozambique.
This plan covers expanding it to all OCHA COD-AB countries (~80), including address geocoding.
Request load is expected to remain low (humanitarian field operations context).

---

## Architecture

### Stack

- **PostgreSQL + PostGIS** — spatial storage and point-in-polygon queries
- **Web framework of choice** — thin REST API layer over PostGIS
- **GDAL / ogr2ogr** — ingestion of OCHA shapefiles/GeoPackages into PostGIS
- **Nominatim** (optional) — address → coordinate geocoding, self-hosted or public instance

### Why PostGIS

- GIST spatial index makes point-in-polygon queries microseconds regardless of polygon count
- Single `ST_Contains(geom, ST_SetSRID(ST_Point($lon, $lat), 4326))` query returns all admin levels
- Handles all projections natively — re-project at ingest, query always in WGS84
- At low load, runs comfortably on a $10–20/month VPS (2 vCPU, 2 GB RAM)

---

## Data Source

### OCHA COD-AB Global Dataset

OCHA publishes a single combined GeoPackage containing all countries and all admin levels:

- **URL**: https://data.humdata.org/dataset/cod-ab-global
- **Format**: GeoPackage (`.gpkg`) — single file, multiple layers
- **Coverage**: ~80 countries, ADM0 through ADM4/5 where available
- **License**: Creative Commons Attribution for Intergovernmental Organisations
- **Update frequency**: Varies by country; HDX shows last-modified dates per dataset

Individual country packages are also available at `https://data.humdata.org/dataset/cod-ab-{iso3}` (e.g. `cod-ab-moz`, `cod-ab-jam`) if you need to update a single country without re-ingesting everything.

### What's Included

Each layer in the GeoPackage has:
- Admin boundary polygons at that level
- P-codes for that level and all parent levels (e.g. ADM3 layer has ADM0, ADM1, ADM2, ADM3 pcodes)
- English names (sometimes also local language names)
- Geometry in WGS84 (EPSG:4326) or a national projection — ogr2ogr handles re-projection

### Field Name Inconsistency

This is the main normalization challenge. Field naming is not standardized across countries:

| Schema | Pcode field | Name field | Example countries |
|---|---|---|---|
| Uppercase + `_EN` | `ADM2_PCODE` | `ADM2_EN` | NGA, SOM, SSD, UKR, most |
| Lowercase + `_NAME` | `adm2_pcode` | `adm2_name` | CMR (Cameroon) |
| Mixed / national | varies | varies | occasional outliers |

**Normalization approach**: after loading into PostGIS, run a post-ingest SQL script that produces a unified view with consistent column names (`adm0_pcode`, `adm0_name`, `adm1_pcode`, etc.) regardless of source schema. This mirrors the regex approach already working in `geocode.ts`:

```
/^adm(\d+)_pcode$/i  →  adm{n}_pcode
/^adm(\d+)_(name|en)$/i  →  adm{n}_name
```

---

## Database Schema

### Recommended table structure

One table per admin level, all sharing the same normalized schema:

```sql
CREATE TABLE cod_adm (
  id          SERIAL PRIMARY KEY,
  iso2        CHAR(2)  NOT NULL,       -- e.g. 'MZ'
  adm_level   SMALLINT NOT NULL,       -- 0, 1, 2, 3, 4
  adm0_pcode  TEXT,
  adm0_name   TEXT,
  adm1_pcode  TEXT,
  adm1_name   TEXT,
  adm2_pcode  TEXT,
  adm2_name   TEXT,
  adm3_pcode  TEXT,
  adm3_name   TEXT,
  adm4_pcode  TEXT,
  adm4_name   TEXT,
  geom        GEOMETRY(MultiPolygon, 4326) NOT NULL
);

CREATE INDEX cod_adm_geom_idx ON cod_adm USING GIST (geom);
CREATE INDEX cod_adm_iso2_level_idx ON cod_adm (iso2, adm_level);
```

Alternatively: a flat denormalized single table with all levels per polygon (deepest admin only), which simplifies queries at the cost of some redundancy. Either works at this scale.

### Query pattern

```sql
SELECT adm0_pcode, adm0_name, adm1_pcode, adm1_name,
       adm2_pcode, adm2_name, adm3_pcode, adm3_name,
       adm4_pcode, adm4_name
FROM cod_adm
WHERE ST_Contains(geom, ST_SetSRID(ST_Point($lon, $lat), 4326))
ORDER BY adm_level DESC
LIMIT 1;
```

Returns the deepest available admin level for that point, with all parent P-codes populated.

---

## Ingest Pipeline

### One-time setup

```bash
# Download global GeoPackage from HDX
# (URL from https://data.humdata.org/dataset/cod-ab-global)
wget -O cod_ab_global.gpkg "https://..."

# List layers
ogrinfo cod_ab_global.gpkg

# Load each admin level layer into PostGIS, re-projecting to WGS84
ogr2ogr \
  -f "PostgreSQL" \
  PG:"dbname=geocode user=postgres" \
  cod_ab_global.gpkg \
  -nln cod_adm_raw \
  -t_srs EPSG:4326 \
  -append \
  <layer_name>
```

### Post-ingest normalization

After loading all raw layers, run a SQL migration that:
1. Identifies pcode and name columns using `information_schema` (or a known mapping table)
2. Inserts normalized rows into `cod_adm` with consistent column names
3. Drops the raw table

A Python script using `geopandas` + `sqlalchemy` can handle this more robustly than pure SQL, since it can iterate column names programmatically and apply the same regex normalization already proven in `geocode.ts`.

### Partial updates (single country)

```bash
# Download updated country GeoPackage from HDX
wget -O moz_updated.gpkg "https://data.humdata.org/dataset/cod-ab-moz/..."

# Delete existing rows for that country
psql -c "DELETE FROM cod_adm WHERE iso2 = 'MZ';"

# Re-ingest
ogr2ogr -f "PostgreSQL" ... moz_updated.gpkg
```

---

## API Design

### Coordinate → P-codes

```
GET /geocode?lat={lat}&lon={lon}
```

Response:
```json
{
  "adm0_pcode": "MZ",
  "adm0_name": "Mozambique",
  "adm1_pcode": "MZ11",
  "adm1_name": "Nampula",
  "adm2_pcode": "MZ1101",
  "adm2_name": "Nampula"
}
```

Only populated levels are returned (sparse countries with only ADM1 won't have `adm2_pcode`).

### Address → P-codes (optional, via Nominatim)

```
GET /geocode?address=Nampula+Mozambique
```

Internally: address → Nominatim → (lat, lon) → PostGIS query → P-codes.

### Integration with kobo2logie

`geocode.ts` can be updated to call this service instead of (or to supplement) OCHA's ArcGIS endpoints. Replace the two-phase ArcGIS lookup with a single call:

```typescript
const res = await fetch(`${GEO_SERVICE_URL}/geocode?lat=${lat}&lon=${lon}`);
const data = await res.json();
// data already has normalized adm{n}_pcode / adm{n}_name fields
```

---

## Infrastructure

### Minimum viable server

| Resource | Requirement |
|---|---|
| CPU | 2 vCPU (spatial index makes queries cheap) |
| RAM | 2 GB (PostGIS working set for ~80 countries fits easily) |
| Storage | ~5 GB (1–3 GB for PostGIS data + OS + WAL headroom) |
| Cost | ~$10–20/month (Hetzner CX22, DigitalOcean Basic, Fly.io) |

PostGIS with a GIST index does not need to load polygons into RAM — the index pages are cached by the OS buffer. At low request load, even a shared-CPU instance is sufficient.

### Deployment options

- **Fly.io** — persistent volume for PostGIS, easy deploy, free tier covers low traffic
- **Hetzner** — cheap dedicated VPS, straightforward Postgres install
- **Supabase** — managed Postgres with PostGIS extension enabled; no server management; free tier has 500 MB storage (may be tight for all countries)
- **Railway** — managed Postgres, PostGIS available via extension

---

## Data Freshness

OCHA updates country boundaries periodically. HDX shows last-modified dates per dataset.
Options:
1. **Manual refresh** — re-download and re-ingest when a country dataset updates (acceptable for low-stakes use)
2. **HDX API polling** — HDX has a CKAN-compatible API; script can check `metadata_modified` dates and trigger re-ingest automatically
3. **No automation** — for humanitarian context, boundary changes are infrequent enough that quarterly manual checks are usually sufficient

---

## Known Limitations

- **No global ADM2+ from OCHA ArcGIS**: OCHA only publishes ADM0/ADM1 as a global queryable service; ADM2+ requires country-specific endpoints or self-hosting (this plan)
- **Schema normalization is imperfect**: a small number of country datasets have non-standard field names that the regex approach won't catch — these need manual mapping entries
- **Boundary disputes**: some borders are contested; COD-AB follows UN recognition which may differ from local expectations
- **Island nations and territories**: some are omitted from COD-AB or have limited admin levels
