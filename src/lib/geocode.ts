/**
 * Reverse geocoding using OCHA COD ArcGIS feature services.
 *
 * Two-step approach:
 *   1. Query the COD global ADM1 service — free, no key, covers all OCHA countries.
 *      Returns ADM0 + ADM1 P-codes and the ISO2 country code we use to look up step 2.
 *   2. If the country has a deeper service in COUNTRY_ADM_SERVICES, query it for ADM2+.
 *      Different countries have different maximum levels (ADM2 → ADM4).
 *
 * Field normalisation:
 *   COD services use inconsistent casing. After lower-casing all attribute keys:
 *     adm{n}_pcode → _geo_adm{n}_pcode
 *     adm{n}_name  → _geo_adm{n}_name  (lowercase "name" field)
 *     adm{n}_en    → _geo_adm{n}_name  (uppercase-origin English name field)
 *
 * Always pass geometry as a JSON object with a spatialReference so ArcGIS does
 * the transformation automatically — avoids failures on services stored in WebMercator.
 */

// ── Global ADM1 service ──────────────────────────────────────────────────────

const OCHA_GLOBAL_ADM1_URL =
  "https://services-eu1.arcgis.com/fppoCYaq7HfVFbIV/arcgis/rest/services/COD_global_adm1/FeatureServer/1/query";

// ── Per-country deeper services (ADM2+) ──────────────────────────────────────
// Keyed by ISO2 code (value of adm0_pcode from the global ADM1 service).
// `highestLayer` is the layer index within the FeatureServer that holds the
// most granular admin level. That layer always carries all parent P-codes too.

type CountryServiceEntry = {
  baseUrl: string;
  highestLayer: number;
};

const COUNTRY_ADM_SERVICES: Record<string, CountryServiceEntry> = {
  // Cameroon — OCHA FIS cod_ab_cmr, ADM3 at layer 11 (lowercase field schema)
  CM: {
    baseUrl: "https://services-eu1.arcgis.com/fppoCYaq7HfVFbIV/arcgis/rest/services/cod_ab_cmr/FeatureServer",
    highestLayer: 11,
  },
  // Somalia — OCHA ADM2 service (uppercase ADM2_PCODE / ADM2_EN schema)
  SO: {
    baseUrl: "https://services2.arcgis.com/nmmtq2usnuAY9BMj/arcgis/rest/services/som_admbnda_adm2_ocha_20250108/FeatureServer",
    highestLayer: 0,
  },
  // South Sudan — OCHA ADM2 service (uppercase schema)
  SS: {
    baseUrl: "https://services7.arcgis.com/FD2EnwdQZ5RYAmzY/arcgis/rest/services/ssd_admbnda_adm2_imwg_nbs_20210924/FeatureServer",
    highestLayer: 0,
  },
  // Nigeria — OCHA/OSGOF ADM2 at layer 6 (uppercase schema)
  NG: {
    baseUrl: "https://services8.arcgis.com/oTalEaSXAuyNT7xf/arcgis/rest/services/nga_adm_osgof_20190417/FeatureServer",
    highestLayer: 6,
  },
  // Ukraine — DTM/OCHA UA_CODs, ADM4 at layer 4 (uppercase ADM4_EN schema)
  UA: {
    baseUrl: "https://services5.arcgis.com/QYf5PkPqzJKVzrmF/arcgis/rest/services/UA_CODs/FeatureServer",
    highestLayer: 4,
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

type ArcGisResponse = {
  features?: Array<{ attributes: Record<string, string | number | null> }>;
  error?: unknown;
};

/** Build the ArcGIS point geometry JSON string with explicit WGS84 SRS. */
function geoPoint(lon: number, lat: number): string {
  return JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } });
}

/**
 * Extract P-code and name fields from ArcGIS feature attributes.
 * Handles both lowercase (adm2_pcode / adm2_name) and uppercase (ADM2_PCODE / ADM2_EN) schemas.
 * Returns { _geo_adm{n}_pcode, _geo_adm{n}_name } for every level found with a non-null value.
 */
function extractPcodeFields(attrs: Record<string, string | number | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawKey, rawVal] of Object.entries(attrs)) {
    if (!rawVal) continue;
    const val = String(rawVal);
    const key = rawKey.toLowerCase();
    // adm{n}_pcode or adm{n}_code
    const pcM = /^adm(\d+)_pcode$/.exec(key);
    if (pcM) { out[`_geo_adm${pcM[1]}_pcode`] = val; continue; }
    // adm{n}_name (lowercase native) or adm{n}_en (English name in uppercase-origin services)
    const nmM = /^adm(\d+)_(name|en)$/.exec(key);
    if (nmM) out[`_geo_adm${nmM[1]}_name`] = val;
  }
  return out;
}

async function queryLayer(url: string): Promise<Record<string, string>> {
  let data: ArcGisResponse;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "kobo2logie/1.0" } });
    if (!res.ok) {
      console.error(`[geo] HTTP ${res.status} → ${url.slice(0, 80)}`);
      return {};
    }
    data = await res.json<ArcGisResponse>();
  } catch (err) {
    console.error(`[geo] fetch error: ${err}`);
    return {};
  }
  if (data.error) {
    console.error(`[geo] ArcGIS error: ${JSON.stringify(data.error)}`);
    return {};
  }
  const attrs = data.features?.[0]?.attributes;
  if (!attrs) return {};
  return extractPcodeFields(attrs);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns a map of `_geo_adm{n}_pcode` / `_geo_adm{n}_name` fields ready to be
 * written back to the Kobo submission via `editSubmission()`.
 *
 * Always returns at least ADM0+ADM1 for any OCHA-covered country.
 * Returns ADM2+ where a country-specific service is configured.
 * Returns {} for uncovered coordinates or on error (logged, not thrown).
 */
export async function geocodeSubmission(lat: number, lon: number): Promise<Record<string, string>> {
  // Step 1: global ADM1 (always)
  const adm1Params = new URLSearchParams({
    geometry: geoPoint(lon, lat),
    geometryType: "esriGeometryPoint",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "adm0_pcode,adm0_name,adm1_pcode,adm1_name",
    returnGeometry: "false",
    f: "json",
  });
  const adm1Fields = await queryLayer(`${OCHA_GLOBAL_ADM1_URL}?${adm1Params}`);

  if (Object.keys(adm1Fields).length === 0) {
    console.log(`[geo] No OCHA COD coverage at (${lat}, ${lon})`);
    return {};
  }

  // Step 2: per-country deeper service (ADM2+) if available
  const iso2 = adm1Fields["_geo_adm0_pcode"];
  const countrySvc = iso2 ? COUNTRY_ADM_SERVICES[iso2] : undefined;
  if (!countrySvc) {
    return adm1Fields;
  }

  const deepParams = new URLSearchParams({
    geometry: geoPoint(lon, lat),
    geometryType: "esriGeometryPoint",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "false",
    f: "json",
  });
  const deepFields = await queryLayer(
    `${countrySvc.baseUrl}/${countrySvc.highestLayer}/query?${deepParams}`
  );

  // Merge: deeper fields fill in ADM2+; global ADM1 fields provide names where deeper service lacks them
  return { ...adm1Fields, ...deepFields };
}
