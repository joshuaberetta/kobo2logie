/**
 * Reverse geocoding using geocoder.imtools.info — a self-hosted service backed
 * by HDX/OCHA COD boundary data.
 *
 * Single GET /geocode?lat=&lon= call returns ADM0–ADM4 P-codes and names for
 * any coordinate covered by the loaded boundaries. No API key required.
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

