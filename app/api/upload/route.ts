// Plain HTTP upload endpoint - deliberately NOT an MCP tool. Its purpose is
// to let a shell-capable MCP client (e.g. Claude Code) move file bytes from
// disk to this server via `curl -F`, without the bytes ever passing through
// the model's output stream as base64 tokens. See CLAUDE.md for the full
// rationale. The returned URL is passed to the existing `media.url` field on
// send_photo/send_document/etc.

import { putUpload, uploadBaseUrl, verifyUploadToken } from "@/lib/upload";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // Telegram's send-size cap (any method)

export async function POST(req: Request) {
  const url = new URL(req.url);
  if (!verifyUploadToken(url.searchParams.get("u"))) {
    return Response.json({ error: "Unauthorized: missing or invalid 'u' token." }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Missing 'file' field (multipart/form-data)." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json(
      { error: `File is ${file.size} bytes; Telegram's send limit is 50 MB.` },
      { status: 413 }
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  let id: string;
  try {
    id = putUpload(bytes, mime, file.name || "file");
  } catch (err: any) {
    return Response.json({ error: err.message ?? "Upload failed." }, { status: 503 });
  }

  // Filename goes in the URL path itself, not just Content-Disposition -
  // Telegram's sendDocument/sendPhoto URL fetcher rejects extension-less URLs
  // outright with "failed to get HTTP URL content" (confirmed by testing
  // arbitrary extension-less URLs, not just ours - see CLAUDE.md).
  const safeName = encodeURIComponent(file.name || "file");
  return Response.json({
    url: `${uploadBaseUrl(req)}/api/file/${id}/${safeName}`,
    id,
    expires_in: 300,
    mime,
    size: bytes.length,
  });
}
