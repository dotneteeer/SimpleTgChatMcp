// Same as ../route.ts but with a filename in the URL path. Telegram's
// sendDocument/sendPhoto URL fetcher rejects extension-less URLs with
// "failed to get HTTP URL content" - confirmed by testing arbitrary
// extension-less URLs, not just ours (see CLAUDE.md). `filename` itself is
// unused (the real name comes from the stored upload entry via
// Content-Disposition) - its only job is to give the URL path an extension.

import { serveUpload } from "@/lib/serveUpload";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return serveUpload(req, id);
}
