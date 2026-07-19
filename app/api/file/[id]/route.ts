// Serves files staged via POST /api/upload. Unauthenticated (Telegram fetches
// this anonymously by URL) but the id is an unguessable 128-bit random token
// that expires 5 minutes after upload - see lib/upload.ts.

import { getUpload } from "@/lib/upload";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // TEMPORARY: diagnosing whether Telegram's URL-fetcher reaches this origin
  // at all, or is stopped upstream (e.g. by Render's Cloudflare edge). Remove
  // once the "failed to get HTTP URL content" issue is resolved.
  console.log(
    `[file-fetch] ${new Date().toISOString()} id=${id} ua=${req.headers.get("user-agent")} range=${req.headers.get("range")} ip=${req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")}`
  );
  const entry = getUpload(id);
  if (!entry) {
    console.log(`[file-fetch] ${id} -> 404 not found/expired`);
    return new Response("Not found or expired.", { status: 404 });
  }

  const total = entry.bytes.length;
  const range = req.headers.get("range");
  // Telegram (and other media fetchers) may probe with a Range request before
  // downloading in full - answering with a plain 200 instead of a proper 206
  // can cause the fetcher to reject the response as not being valid media.
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : total - 1;
      if (start <= end && end < total) {
        const slice = entry.bytes.subarray(start, end + 1);
        console.log(`[file-fetch] ${id} -> 206 bytes ${start}-${end}/${total} mime=${entry.mime}`);
        return new Response(new Uint8Array(slice), {
          status: 206,
          headers: {
            "Content-Type": entry.mime,
            "Content-Length": String(slice.length),
            "Content-Range": `bytes ${start}-${end}/${total}`,
            "Accept-Ranges": "bytes",
          },
        });
      }
      console.log(`[file-fetch] ${id} -> 416 range not satisfiable (${range}, total=${total})`);
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${total}`, "Accept-Ranges": "bytes" },
      });
    }
  }

  console.log(`[file-fetch] ${id} -> 200 total=${total} mime=${entry.mime} filename=${entry.filename}`);
  return new Response(new Uint8Array(entry.bytes), {
    headers: {
      "Content-Type": entry.mime,
      "Content-Length": String(total),
      "Accept-Ranges": "bytes",
    },
  });
}
