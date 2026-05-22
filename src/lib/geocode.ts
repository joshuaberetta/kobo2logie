/**
 * Geocoding using geocoder.imtools.info — a self-hosted service backed
 * by HDX/OCHA COD boundary data.
 *
 * Reverse geocode: GET /geocode?lat=&lon= returns ADM0–ADM4 P-codes and names.
 * Forward geocode: GET /geocode?address= returns lat/lon + ADM0–ADM4 P-codes.
 *
 * Output keys use the `_geo_adm{n}_pcode` / `_geo_adm{n}_name` convention that
 * the rest of the pipeline (hook.ts → editSubmission) expects.
 */

const GEOCODER_URL = "https://geocoder.imtools.info/geocode";

type GeocoderResponse = {
  success: boolean;
  error?: string;
  [key: string]: unknown;
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns a map of `_geo_adm{n}_pcode` / `_geo_adm{n}_name` fields ready to be
 * written back to the Kobo submission via `editSubmission()`.
 *
 * Returns {} for uncovered coordinates or on error (logged, not thrown).
 */
export async function geocodeSubmission(lat: number, lon: number): Promise<Record<string, string>> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  let data: GeocoderResponse;
  try {
    const res = await fetch(`${GEOCODER_URL}?${params}`, {
      headers: { "User-Agent": "kobo2logie/1.0" },
    });
    if (res.status === 404) {
      console.log(`[geo] No coverage at (${lat}, ${lon})`);
      return {};
    }
    if (!res.ok) {
      console.error(`[geo] HTTP ${res.status} from geocoder`);
      return {};
    }
    data = await res.json<GeocoderResponse>();
  } catch (err) {
    console.error(`[geo] fetch error: ${err}`);
    return {};
  }

  if (!data.success) {
    console.log(`[geo] Geocoder returned success=false: ${data.error}`);
    return {};
  }

  // Map adm{n}_pcode / adm{n}_name → _geo_adm{n}_pcode / _geo_adm{n}_name
  const out: Record<string, string> = {};
  for (let n = 0; n <= 4; n++) {
    const pcode = data[`adm${n}_pcode`];
    const name  = data[`adm${n}_name`];
    if (typeof pcode === "string" && pcode) out[`_geo_adm${n}_pcode`] = pcode;
    if (typeof name  === "string" && name)  out[`_geo_adm${n}_name`]  = name;
  }
  return out;
}

/**
 * Forward geocode an address string to lat/lon + P-codes.
 *
 * Returns a map containing `_geo_latitude`, `_geo_longitude`, and the same
 * `_geo_adm{n}_pcode` / `_geo_adm{n}_name` fields as `geocodeSubmission()`.
 *
 * Returns {} when the address cannot be resolved or on error (logged, not thrown).
 */
export async function geocodeAddress(address: string): Promise<Record<string, string>> {
  const params = new URLSearchParams({ address });
  let data: GeocoderResponse;
  try {
    const res = await fetch(`${GEOCODER_URL}?${params}`, {
      headers: { "User-Agent": "kobo2logie/1.0" },
    });
    if (res.status === 404) {
      console.log(`[geo/address] No result for address: ${address}`);
      return {};
    }
    if (!res.ok) {
      console.error(`[geo/address] HTTP ${res.status} from geocoder`);
      return {};
    }
    data = await res.json<GeocoderResponse>();
  } catch (err) {
    console.error(`[geo/address] fetch error: ${err}`);
    return {};
  }

  if (!data.success) {
    console.log(`[geo/address] success=false: ${data.error}`);
    return {};
  }

  const out: Record<string, string> = {};

  // Include resolved coordinates
  if (typeof data.latitude === "number") out["_geo_latitude"] = String(data.latitude);
  if (typeof data.longitude === "number") out["_geo_longitude"] = String(data.longitude);

  for (let n = 0; n <= 4; n++) {
    const pcode = data[`adm${n}_pcode`];
    const name  = data[`adm${n}_name`];
    if (typeof pcode === "string" && pcode) out[`_geo_adm${n}_pcode`] = pcode;
    if (typeof name  === "string" && name)  out[`_geo_adm${n}_name`]  = name;
  }
  return out;
}

