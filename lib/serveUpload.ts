// Shared GET handler for both /api/file/[id] (legacy, no filename) and
// /api/file/[id]/[filename] (current - Telegram's sendDocument/sendPhoto URL
// fetcher rejects URLs whose path has no filename/extension with "failed to
// get HTTP URL content", confirmed by testing arbitrary extension-less URLs
// (not just ours) - see CLAUDE.md). Also sets Content-Disposition so the
// delivered file keeps its real name even where the URL path is ignored.

import { getUpload } from "@/lib/upload";

export function serveUpload(req: Request, id: string): Response {
  const entry = getUpload(id);
  if (!entry) {
    return new Response("Not found or expired.", { status: 404 });
  }

  const asciiFallback = entry.filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
  const disposition =
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(entry.filename)}`;

  const total = entry.bytes.length;
  const range = req.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : total - 1;
      if (start <= end && end < total) {
        const slice = entry.bytes.subarray(start, end + 1);
        return new Response(new Uint8Array(slice), {
          status: 206,
          headers: {
            "Content-Type": entry.mime,
            "Content-Length": String(slice.length),
            "Content-Range": `bytes ${start}-${end}/${total}`,
            "Accept-Ranges": "bytes",
            "Content-Disposition": disposition,
          },
        });
      }
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${total}`, "Accept-Ranges": "bytes" },
      });
    }
  }

  return new Response(new Uint8Array(entry.bytes), {
    headers: {
      "Content-Type": entry.mime,
      "Content-Length": String(total),
      "Accept-Ranges": "bytes",
      "Content-Disposition": disposition,
    },
  });
}
