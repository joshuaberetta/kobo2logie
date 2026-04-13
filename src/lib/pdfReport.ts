import { isAllowedMediaHost } from "./kobo.js";

const KOBO2PDF_URL = "https://kobo2pdf.imtools.info";

export interface PdfReportConfig {
  template?: string;
  formTitle?: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function renderPdf(
  cfg: PdfReportConfig,
  submission: Record<string, unknown>,
  koboServer: string,
  koboToken: string
): Promise<{ ok: boolean; error?: string; pdfBytes?: ArrayBuffer }> {
  // ── 1. Fetch image attachments to embed in the PDF ───────────────────────
  const pdfAttachments: Array<{ filename: string; content_type: string; content: string }> = [];
  const rawAttachments = submission._attachments;
  if (Array.isArray(rawAttachments)) {
    for (const att of rawAttachments as Array<Record<string, unknown>>) {
      if (att.is_deleted) continue;
      const mimetype = String(att.mimetype ?? "");
      if (!mimetype.startsWith("image/")) continue;
      const downloadUrl = String(att.download_url ?? "");
      if (!downloadUrl || !isAllowedMediaHost(downloadUrl, koboServer)) continue;
      try {
        const mediaRes = await fetch(downloadUrl, {
          headers: { Authorization: `Token ${koboToken}` },
        });
        if (!mediaRes.ok) {
          console.error(`[pdf] Failed to fetch attachment ${att.media_file_basename}: ${mediaRes.status}`);
          continue;
        }
        const buf = await mediaRes.arrayBuffer();
        pdfAttachments.push({
          filename: String(att.media_file_basename ?? att.filename ?? ""),
          content_type: mimetype,
          content: arrayBufferToBase64(buf),
        });
      } catch (e) {
        console.error(`[pdf] Error fetching attachment ${att.media_file_basename}: ${e}`);
      }
    }
  }

  // ── 2. Call the kobo2pdf render service ─────────────────────────────────
  let pdfBytes: ArrayBuffer;
  try {
    const renderRes = await fetch(`${KOBO2PDF_URL}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        template: cfg.template ?? "submission",
        data: submission,
        meta: {
          ...(cfg.formTitle ? { formTitle: cfg.formTitle } : {}),
          reportDate: new Date().toISOString().slice(0, 10),
        },
        ...(pdfAttachments.length ? { attachments: pdfAttachments } : {}),
      }),
    });
    if (!renderRes.ok) {
      const text = await renderRes.text().catch(() => "");
      return { ok: false, error: `kobo2pdf error ${renderRes.status}: ${text.slice(0, 200)}` };
    }
    const contentType = renderRes.headers.get("content-type") ?? "";
    if (!contentType.includes("application/pdf")) {
      return { ok: false, error: `kobo2pdf returned unexpected content-type: ${contentType}` };
    }
    pdfBytes = await renderRes.arrayBuffer();
  } catch (e) {
    return { ok: false, error: `Failed to reach kobo2pdf service: ${e}` };
  }

  return { ok: true, pdfBytes };
}
