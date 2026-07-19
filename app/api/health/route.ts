// Lightweight endpoint for Render's health check and external keep-alive pings.
// Kept separate from /api/[transport] so pings don't spin up the full MCP handler.
export async function GET() {
  return new Response("ok");
}
