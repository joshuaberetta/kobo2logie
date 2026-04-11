# Plan: OCHA COD-AB P-code reverse geocoding

## Goal

When a Kobo submission contains `_geolocation: [lat, lon]`, resolve it to authoritative OCHA P-codes (`adm1_pcode`, `adm2_pcode`, etc.) and write them back to the submission. P-codes come from OCHA's Common Operational Datasets – Administrative Boundaries (COD-AB), the standard reference for humanitarian operations.

---

## How it works

Two API calls, fired in sequence, both free and requiring no API key:

### Step 1 — Nominatim (country detection only)
```
GET https://nominatim.openstreetmap.org/reverse
  ?lat=<lat>&lon=<lon>&zoom=3&format=jsonv2
  User-Agent: kobo2logie/1.0
```
`zoom=3` returns just country-level—the lightest possible query. We only need `address.country_code` (ISO 3166-1 alpha-2, e.g. `"so"` for Somalia). We then convert it to ISO3 (`"SOM"`) using a small static map in code.

Why Nominatim for this step: it's a single round-trip, returns in <100ms, and OSM country coverage is universal. Rate limit is 1 req/sec, which is irrelevant for Kobo submission volumes.

### Step 2 — OCHA COD-AB ArcGIS Online feature service (point-in-polygon)
```
GET https://services.arcgis.com/{orgId}/arcgis/rest/services/{slug}/FeatureServer/{layer}/query
  ?geometry={lon},{lat}
  &geometryType=esriGeometryPoint
  &spatialRel=esriSpatialRelIntersects
  &outFields=adm0_pcode,adm0_name,adm1_pcode,adm1_name,adm2_pcode,adm2_name
  &returnGeometry=false
  &f=json
```
OCHA publishes official COD-AB polygon layers for ~200 countries to ArcGIS Online under their org `OCHA_FIS`. These are **public, no auth required**. The query returns verified P-codes and admin names from the same dataset that humanitarian coordination uses.

Fields returned by the layer (confirmed from HDX COD-AB schema):
- `adm0_pcode`, `adm0_name` — country level
- `adm1_pcode`, `adm1_name` — state/province/region
- `adm2_pcode`, `adm2_name` — district/county/zone

---

## The one non-trivial requirement: country service URL table

The ArcGIS service URL is **per-country** — each country's COD-AB is a separate ArcGIS item. We need a static lookup table of `ISO3 → { serviceUrl, adm2LayerIndex }`.

### How to discover service URLs

OCHA FISS publishes to ArcGIS Online org ID `5T5nSi527N4F7luB`. URLs can be discovered programmatically:

```
GET https://www.arcgis.com/sharing/rest/search
  ?q=owner:OCHA_FIS+cod-ab+type:"Feature+Service"
  &num=100
  &f=json
```

Returns items with `url` field — that's the FeatureServer base URL. Append `/{layerIndex}/query` to query a specific admin level. Layer indices follow a consistent pattern: 0=ADM0, 1=ADM1, 2=ADM2, 3=ADM3 (where available).

**Setup action**: Run this search once, identify the countries you need, and populate a static table in `src/lib/geocode.ts`. This is a one-time developer task taking ~15 minutes. No API key needed.

Example entry:
```ts
"SOM": {
  serviceUrl: "https://services.arcgis.com/5T5nSi527N4F7luB/arcgis/rest/services/Som_Admin_Boundaries/FeatureServer",
  adm2Layer: 2,
},
```

### Fallback behaviour

If no entry exists for the detected country:
- Log `[geo] No COD-AB service configured for {ISO3}, skipping pcode lookup`
- Skip the ArcGIS step entirely
- Write nothing back — do not fall back to Nominatim admin names (they are not P-codes and would be misleading in the pcode fields)

---

## Fields written back to Kobo

Via the existing `editSubmission()` pipeline:

| Kobo field key | Value |
|---|---|
| `_geo_adm0_name` | Country name (from ArcGIS layer, e.g. `"Somalia"`) |
| `_geo_adm0_pcode` | Country P-code (e.g. `"SOM"`) |
| `_geo_adm1_name` | Admin1 English name (e.g. `"Jubooyinka Hoose"`) |
| `_geo_adm1_pcode` | Admin1 P-code (e.g. `"SO23"`) |
| `_geo_adm2_name` | Admin2 English name (e.g. `"Afmadow"`) |
| `_geo_adm2_pcode` | Admin2 P-code (e.g. `"SO2301"`) |

These use a `_geo_` prefix to make them clearly synthetic / derived fields, distinct from any form question xpaths.

---

## Configuration

Geocoding is opt-in per form, stored in the existing `FORWARD_CONFIG` KV entry:

```json
{
  "geocode": true
}
```

This means no geocoding runs unless the user enables it for a specific form. No new KV namespace is needed — `geocode` is a new optional key alongside the existing `forwardUrl`, `transcribe`, etc.

---

## Phases

### Phase 1 — `src/lib/geocode.ts`

New file. Exports:

**`resolveCountryIso3(lat, lon)`**  
Calls Nominatim at zoom=3. Returns the ISO3 code (e.g. `"SOM"`) or `null` on failure. Contains the ISO2 → ISO3 conversion table inline (all ~200 countries).

**`queryOchaAdminBoundaries(iso3, lat, lon)`**  
Looks up the country service URL from the static table. If not found, returns `null`. Otherwise queries the ADM2 layer (point-in-polygon). Returns `{ adm0Name, adm0Pcode, adm1Name, adm1Pcode, adm2Name, adm2Pcode }` or `null` on any error.

**`geocodeSubmission(geolocation, env)`**  
Combines both: calls `resolveCountryIso3`, then `queryOchaAdminBoundaries`. Returns the fields map (keyed by Kobo xpaths) ready for `editSubmission()`, or `null` if either step fails.

### Phase 2 — `src/routes/configure.ts`

Add `geocode?: boolean` to the config schema. The configure endpoint already accepts arbitrary keys from the form body — just add it to the TypeScript type and include it in the stored JSON without changing the endpoint structure.

### Phase 3 — `src/routes/ui.ts`

Add a "Geocoding" toggle checkbox to the configure page beneath the existing enrichment options. Same inline HTML + JS pattern as existing toggles.

### Phase 4 — `src/routes/hook.ts`

In the fire-and-forget block, after existing enrichments:

```ts
if (geocode && submission._geolocation) {
  c.executionCtx.waitUntil(
    geocodeAndEditBack(submission, formUID, uid, env)
  );
}
```

`geocodeAndEditBack` is the orchestrator: calls `geocodeSubmission`, then `resolveSubmissionId` + `editSubmission` with the returned fields. Lives in `geocode.ts` or inline in `hook.ts`.

---

## Files changed

| File | Change |
|---|---|
| `src/lib/geocode.ts` | **New file** — Nominatim call, OCHA ArcGIS query, country table, orchestrator |
| `src/routes/configure.ts` | Add `geocode` boolean to stored config type |
| `src/routes/ui.ts` | Geocoding toggle on configure page |
| `src/routes/hook.ts` | Read `geocode` flag, call `waitUntil(geocodeAndEditBack(...))` |
| `src/types.ts` | No change needed — `FORWARD_CONFIG` and auth tokens already in `Env` |
| `wrangler.toml` | No change needed |

---

## Verification

### Before implementing: validate a service URL manually

Pick a country from the OCHA ArcGIS search, then run:
```
curl "https://services.arcgis.com/{orgId}/arcgis/rest/services/{slug}/FeatureServer/2/query?geometry=45.34,2.05&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=adm1_pcode,adm1_name,adm2_pcode,adm2_name&returnGeometry=false&f=json"
```
Confirm the response contains the expected P-codes for a known point.

### Integration verification

1. Enable geocoding on a test form via `POST /api/configure/forward` with `{ "uid": "TEST", "geocode": true }`
2. POST a submission with `_geolocation: [2.05, 45.34]` (Afmadow district, Somalia)
3. Check the Kobo submission is patched with `_geo_adm2_pcode: "SO2301"` (or equivalent)
4. Confirm forms without `geocode: true` are unaffected

### Rate limit note

Nominatim's 1 req/sec limit applies per IP. Cloudflare Workers make egress from distributed IPs, so sequential submissions should not accumulate — but if bursts arrive, Nominatim may return 429. The geocoder should handle this gracefully by logging and returning `null` (no P-code written, no error propagated).

---

## Country service URL table — first pass

The following high-priority countries for humanitarian operations should be populated when implementing. Exact service URLs need to be retrieved from the ArcGIS Online search query above.

| ISO3 | Country |
|---|---|
| AFG | Afghanistan |
| CAF | Central African Republic |
| COD | DR Congo |
| ETH | Ethiopia |
| HTI | Haiti |
| IRQ | Iraq |
| LBY | Libya |
| MMR | Myanmar |
| MOZ | Mozambique |
| NER | Niger |
| NGA | Nigeria |
| PSE | Palestine |
| SDN | Sudan |
| SOM | Somalia |
| SSD | South Sudan |
| SYR | Syrian Arab Republic |
| TCD | Chad |
| UKR | Ukraine |
| VEN | Venezuela |
| YEM | Yemen |
| ZWE | Zimbabwe |

Coverage beyond this list can be added incrementally as needed.
