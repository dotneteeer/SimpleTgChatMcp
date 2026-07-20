// Serves files staged via POST /api/upload. Unauthenticated (Telegram fetches
// this anonymously by URL) but the id is an unguessable 128-bit random token
// that expires 5 minutes after upload - see lib/upload.ts.
//
// Legacy path (no filename segment) - kept for any URL issued before the
// /[id]/[filename] route existed. New uploads get a URL with the filename in
// the path; see app/api/file/[id]/[filename]/route.ts and lib/serveUpload.ts
// for why that's required.

import { serveUpload } from "@/lib/serveUpload";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return serveUpload(req, id);
}
