const EU_HOSTNAME = "eu.kobotoolbox.org";

export function resolveKoboEditToken(
  server: string,
  tokens: { global: string; eu: string }
): string {
  try {
    const host = new URL(server).hostname;
    return host === EU_HOSTNAME ? tokens.eu : tokens.global;
  } catch {
    return tokens.global;
  }
}

/**
 * Queries the Kobo data API to find the numeric `_id` for a submission
 * identified by its `_uuid`. Returns null if not found or on error.
 */
export async function resolveSubmissionId(
  server: string,
  uid: string,
  uuid: string,
  token: string
): Promise<number | null> {
  try {
    const query = JSON.stringify({ _uuid: uuid });
    const fields = JSON.stringify(["_id"]);
    const url = `${server}/api/v2/assets/${uid}/data.json?query=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Token ${token}` },
    });
    if (!res.ok) {
      console.error(`[edit] resolveSubmissionId failed: HTTP ${res.status}`);
      return null;
    }
    const data = await res.json<{ results?: Array<{ _id?: number }> }>();
    return data.results?.[0]?._id ?? null;
  } catch (err) {
    console.error("[edit] resolveSubmissionId error:", err);
    return null;
  }
}

/**
 * Patches field values back onto an existing Kobo submission using the
 * bulk-edit endpoint. The `data` map uses question xpaths as keys.
 * No binary content is sent — only JSON field values.
 */
export async function editSubmission(
  server: string,
  uid: string,
  id: number,
  data: Record<string, string>,
  token: string
): Promise<{ ok: boolean; httpStatus: number; error?: string }> {
  try {
    const url = `${server}/api/v2/assets/${uid}/data/bulk/`;
    const payload = { submission_ids: [id], data };
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ payload: JSON.stringify(payload) }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[edit] editSubmission failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
      return { ok: false, httpStatus: res.status, error: text.slice(0, 500) };
    }
    return { ok: true, httpStatus: res.status };
  } catch (err) {
    console.error("[edit] editSubmission error:", err);
    return { ok: false, httpStatus: 0, error: String(err) };
  }
}
