// Serves files staged via POST /api/upload. Unauthenticated (Telegram fetches
// this anonymously by URL) but the id is an unguessable 128-bit random token
// that expires 5 minutes after upload - see lib/upload.ts.

import { getUpload } from "@/lib/upload";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = getUpload(id);
  if (!entry) {
    return new Response("Not found or expired.", { status: 404 });
  }
  return new Response(new Uint8Array(entry.bytes), {
    headers: {
      "Content-Type": entry.mime,
      "Content-Length": String(entry.bytes.length),
    },
  });
}
