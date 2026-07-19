# CLAUDE.md

## What this is

Remote MCP server (Next.js App Router, `mcp-handler`) exposing Telegram Bot
API methods for a single chat. Stateless multi-tenant: bot token and chat ID
come from the connector's URL query params (`token`, `chat`), not from env
vars or storage. See README.md for user-facing setup.

Hosted on [Render](https://render.com) as a persistent Node server (`next
start`), not serverless - deliberately, since serverless hosts like Vercel cap
request bodies at ~4.5 MB, which truncates (corrupts) base64-encoded photo/
document uploads above that size. Render's free tier has no such cap and
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
  for methods that send a file (chooses JSON when the media is a URL/file_id,
  multipart/FormData when it's base64 content). Both auto-retry once as plain
  text if Telegram rejects the message due to bad `parse_mode` entities.
- `lib/mdv2.ts` - `escapeMarkdownV2()` helper (not used by tools directly, but
  exported for callers who want to send literal text safely).
- `lib/upload.ts` + `app/api/upload/route.ts` + `app/api/file/[id]/route.ts` -
  out-of-band file upload, deliberately plain HTTP, not an MCP tool. Rationale:
  base64 in a tool call costs output tokens (the model generates the whole
  file as text), independent of hosting - a hypothetical "upload" MCP tool
  would have the same problem, since the bytes still have to enter the
  model's output. Instead, a shell-capable client (Claude Code) runs
  `curl -F file=@<path> .../api/upload` to move bytes straight from disk,
  gets back a URL, and passes that to the existing `media.url` field - no
  send-side schema change needed. Storage is an in-memory `Map` (5-min TTL,
  200 MB total cap) since files only need to survive until Telegram fetches
  them; not persisted, no external object store. Upload auth is an
  HMAC-SHA256(`MCP_ACCESS_KEY`, "upload-v1") token (`?u=`), not `token`/`chat`,
  because the model never sees those - they live in the connector URL, hidden
  from the model. The upload URL+token reaches the model via the MCP
  `instructions` field (set from `uploadInstructions()` in `route.ts`,
  `serverOptions.instructions` - `mcp-handler` passes it through to the SDK).
  Only works in shell-capable clients; base64 remains the only option in
  shell-less ones (Claude.ai web/Desktop) - a client-capability limit, not
  fixable server-side. Telegram's send cap (any method) is 50 MB.

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
  (`url` | `base64` | `file_id`) - keep new media tools consistent with this.
- `mediaTool()` in `route.ts` hard-rejects `base64` payloads over
  `BASE64_INLINE_LIMIT` (400k chars) with a corrective error pointing at the
  upload flow above - prose-only guidance in descriptions isn't reliable
  enough on its own, so this backs it with an enforced failure.

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
