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
