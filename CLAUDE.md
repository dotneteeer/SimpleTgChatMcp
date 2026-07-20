# CLAUDE.md

## What this is

Remote MCP server (Next.js App Router, `mcp-handler`) exposing Telegram Bot
API methods for a single chat. Stateless multi-tenant: bot token and chat ID
come from the connector's URL query params (`token`, `chat`), not from env
vars or storage. See README.md for user-facing setup.

Hosted on [Render](https://render.com) as a persistent Node server (`next
start`), not serverless - deliberately, since serverless hosts like Vercel cap
request bodies at ~4.5 MB, which truncates (corrupts) large file uploads to
`/api/upload` above that size. Render's free tier has no such cap and
auto-deploys from GitHub on push (`render.yaml`). `app/api/health/route.ts`
exists for Render's health check and for an external keep-alive cron (avoids
the free tier's ~15-min idle spin-down). `export const maxDuration = 60` in
`route.ts` is a leftover Vercel-ism; Render ignores it, harmless to keep.

## Architecture

- `app/api/[transport]/route.ts` - the only route. Parses `token`/`chat`/`key`
  from the request URL, optionally gates on `MCP_ACCESS_KEY` (env), then
  builds a fresh `createMcpHandler` per request with `token`/`chat` captured
  in tool closures.
- `lib/telegram.ts` - Bot API client. `callApi` for JSON calls, `callApiWithMedia`
  for methods that send a file by URL/`file_id` (thin wrapper around `callApi`),
  `callApiWithMediaBytes` for sending file bytes directly as multipart instead
  of a URL. All three auto-retry once as plain text if Telegram rejects the
  message due to bad `parse_mode` entities.
- `lib/mdv2.ts` - `escapeMarkdownV2()` helper (not used by tools directly, but
  exported for callers who want to send literal text safely).
- `lib/upload.ts` + `app/api/upload/route.ts` +
  `app/api/file/[id]/route.ts` + `app/api/file/[id]/[filename]/route.ts` -
  out-of-band file upload, deliberately plain HTTP, not an MCP tool, and the
  *only* way to send a local file - inline base64 was removed from the media
  schema entirely (it costs output tokens regardless of file size, since the
  model has to generate the whole file as text; a hypothetical "upload" MCP
  tool would have the same problem, since the bytes still have to enter the
  model's output). The upload URL includes the filename (`/api/file/<id>/<name>`;
  the bare `/api/file/<id>` route still works for back-compat) and the response
  carries a `Content-Disposition` header (`lib/serveUpload.ts`, shared by both
  routes) - both needed because Telegram's sendDocument/sendPhoto URL-fetch path
  rejects some Content-Types (`application/octet-stream`, `application/x-msdownload`,
  `text/plain`, and others) outright with "failed to get HTTP URL content",
  confirmed by testing arbitrary extension-less/generic-mime URLs, not just
  ours - fatal for arbitrary binaries like `.bin`/`.exe`/`.dll`. Because of that,
  `route.ts`'s media tools (`ownUploadId` in `lib/upload.ts`) detect when
  `media.url` is one of our own upload URLs and, if the entry hasn't expired,
  send the bytes straight to Telegram via `callApiWithMediaBytes` instead of
  handing Telegram a URL to fetch - sidesteps the Content-Type gate entirely.
  Only our own uploads get this treatment; other public URLs still go through
  Telegram's URL fetch as before. A shell-capable client (Claude Code) runs
  `curl -F file=@<path> .../api/upload` to move bytes straight from disk,
  gets back a URL, and passes that to the existing `media.url` field. Storage
  is an in-memory `Map` (5-min TTL, 200 MB total cap) since files only need to
  survive until Telegram fetches them; not persisted, no external object
  store. Upload auth is an HMAC-SHA256(`MCP_ACCESS_KEY`, "upload-v1") token
  (`?u=`), not `token`/`chat`, because the model never sees those - they live
  in the connector URL, hidden from the model. The upload URL+token reaches
  the model via the MCP `instructions` field (set from `uploadInstructions()`
  in `route.ts`, `serverOptions.instructions` - `mcp-handler` passes it
  through to the SDK). Only works in shell-capable clients; shell-less ones
  (Claude.ai web/Desktop) can only send files via a public `url` or an
  existing `file_id` - a client-capability limit, not fixable server-side.
  Telegram's send cap (any method) is 50 MB.
  `/api/file/[id]` supports HTTP Range requests (206/Content-Range/416) -
  needed because Telegram's media fetcher (and others) can probe with a
  Range request before downloading in full.

  Debugged-and-closed false leads, so they aren't re-investigated cold: a
  `send_photo`/`send_document` URL failure ("failed to get HTTP URL
  content" / "wrong type of the web page content") was NOT a Cloudflare
  edge block in front of Render's shared `onrender.com` domain (verified by
  logging - Telegram's real fetcher, from a genuine Telegram IP, does reach
  this origin) and NOT missing Range support (fixed anyway, since it's
  correct behavior, but didn't resolve the failure). Root cause: Telegram
  itself rejects images whose width + height exceeds ~10,000px, for both
  `sendPhoto` and `sendDocument` (confirmed by testing a flat-color PNG at
  7200x4800, sum=12000 - fails; well under that threshold - succeeds even
  at 1MB+). This is a Telegram API limit on the photo, unrelated to hosting.
  No server-side fix exists without adding image-resizing (out of scope);
  documented in README.md as a caveat.

Bots can't browse arbitrary chat history - they only see messages that
arrive after they start looking. `get_updates` wraps Telegram's `getUpdates`
and filters to the configured `chat`; `get_file` resolves a `file_id` from
those updates to actual bytes via `downloadFile()` in `lib/telegram.ts`.

## Conventions

- Every tool returns `{ content: [{type:"text", text}], isError? }` (or
  `type:"image"` for `get_file` on image mimes) - Telegram API errors are
  turned into readable text (`Telegram error <code>: <description>`), never
  thrown as raw exceptions.
- Every tool has an `annotations` object (`READ_ONLY`/`WRITE`/`DESTRUCTIVE`
  presets in `route.ts`) per the MCP tool annotations spec - `readOnlyHint`
  for read tools, `destructiveHint` only for `delete_message`.
- New "send" tools should support `reply_to_message_id` and
  `disable_notification` where the Bot API allows it, and `parse_mode` where
  there's a text/caption field.
- Media-accepting tools use the shared `mediaInputSchema` union
  (`url` | `file_id`, no inline base64) - keep new media tools consistent
  with this. Every media tool's description and the server `instructions`
  point the AI at the upload flow above for local files.

## Adding a new Bot API method

1. Add a `server.registerTool(...)` call in `route.ts` (reuse `mediaTool()`
   helper if it's a media-send method), with one of the `READ_ONLY`/`WRITE`/
   `DESTRUCTIVE` annotation presets spread in.
2. If it can fail on bad formatting, route it through `callApi`/`callApiWithMedia`
   so the plain-text fallback applies.
3. Update the tool list in README.md.

## Testing locally

```
npm run dev
curl -X POST "http://localhost:3000/api/mcp?token=<TOKEN>&chat=<CHAT_ID>" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

No test suite exists yet; `npm run build` is the main check (typecheck + build).
