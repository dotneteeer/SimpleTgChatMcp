# SimpleTgChatMcp

[![CI](https://github.com/dotneteeer/SimpleTgChatMcp/actions/workflows/ci.yml/badge.svg)](https://github.com/dotneteeer/SimpleTgChatMcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A remote **MCP (Model Context Protocol) server** that lets Claude send
messages, photos, documents, and other media to a Telegram chat through the
Telegram Bot API - and manage those messages (edit, delete, pin, forward).

No sign-up, no shared account: the server is **stateless and multi-tenant**.
Your bot token and chat ID live only in the connector URL you configure once
in Claude - the server itself stores nothing and doesn't know who you are.
Anyone can point their own bot/chat at the same deployment without ever
seeing anyone else's data.

## Contents

- [How it works](#how-it-works)
- [Step 1 - Create a Telegram bot](#step-1---create-a-telegram-bot)
- [Step 2 - Get your chat ID](#step-2---get-your-chat-id)
- [Step 3 - Build your connector URL](#step-3---build-your-connector-url)
- [Step 4 - Connect it to Claude](#step-4---connect-it-to-claude)
- [Available tools](#available-tools)
- [Deploying your own copy](#deploying-your-own-copy)
- [Local development](#local-development)

## How it works

```
Claude  --(MCP call)-->  /api/mcp?token=<BOT_TOKEN>&chat=<CHAT_ID>  --(Bot API)-->  Telegram  --> your chat
```

Every tool call carries your `token` and `chat` from the URL through to the
Telegram Bot API. There's no database, no user accounts, no session state -
the URL *is* the configuration.

## Step 1 - Create a Telegram bot

1. Open Telegram and start a chat with **[@BotFather](https://t.me/BotFather)**.
2. Send `/newbot` and follow the prompts (choose a name and a username ending in `bot`).
3. BotFather replies with an **API token** that looks like:
   `123456789:AAExampleTokenValue-abcDEF`
   Save it - this is your `BOT_TOKEN`.

## Step 2 - Get your chat ID

Pick the case that matches where you want messages delivered:

**Direct message to yourself/a private chat**
1. Send any message to your new bot (search its username and press Start).
2. Open in a browser, replacing `<BOT_TOKEN>`:
   `https://api.telegram.org/bot<BOT_TOKEN>/getUpdates`
3. In the JSON response, find `"chat":{"id":123456789,...}` - that number is your `CHAT_ID`.

**Group chat**
1. Add the bot to the group.
2. Send any message in the group.
3. Call the same `getUpdates` URL as above; the group's `chat.id` is a
   **negative** number (e.g. `-1001234567890`).

**Channel**
1. Add the bot as an **administrator** of the channel (needs post permission).
2. Use the channel's public `@username` as `CHAT_ID`, or find its numeric id
   the same way via `getUpdates` after posting something.

If `getUpdates` returns an empty `"result":[]`, send a fresh message to the
bot/group/channel first - Telegram only shows recent updates.

## Step 3 - Build your connector URL

```
https://<your-service>.onrender.com/api/mcp?token=<BOT_TOKEN>&chat=<CHAT_ID>
```

Replace `<your-service>` with your deployment's subdomain (see
[Deploying your own copy](#deploying-your-own-copy)), and `<BOT_TOKEN>` /
`<CHAT_ID>` with the values from steps 1-2. That's the whole configuration -
keep this URL private, since anyone who has it can send messages through your
bot.

## Step 4 - Connect it to Claude

**Claude.ai / Claude Desktop**
1. Go to **Settings -> Connectors -> Add custom connector**.
2. Give it a **name**, e.g. `Telegram`.
3. Paste your connector URL from Step 3 into the URL field.
4. Save. Claude can now call the Telegram tools in any conversation.

**Claude Code (CLI)**
```
claude mcp add --transport http -s user Telegram "https://<your-service>.onrender.com/api/mcp?token=<BOT_TOKEN>&chat=<CHAT_ID>"
```
Here `--transport http` selects the HTTP transport; `-s user` registers it
globally (available in every project) instead of just the current one;
`Telegram` is just the local name this server will be registered under (pick
anything you like) - it has nothing to do with `--transport` itself, it's a
separate argument.

**Verify it's working**: ask Claude to use the `get_me` tool, or just say
"send a test message to Telegram" - you should see it show up in your chat.

## Available tools

`media` (used by several tools below) accepts one of:
- `{ "url": "https://..." }` - a public URL, or the URL returned by uploading a local file first
  (see [Sending files](#sending-files) below)
- `{ "file_id": "..." }` - reuse a file Telegram already has

`parse_mode` (used by several tools below) is one of `MarkdownV2` (default),
`HTML`, `Markdown`, `none`. If Telegram rejects the formatting (e.g.
unescaped special characters), the server automatically retries the send as
plain text so the message still goes through, and tells you it fell back.

Tools are also annotated per the [MCP tool annotations spec](https://modelcontextprotocol.io)
(`readOnlyHint`/`destructiveHint`) so clients can show which are safe to run
freely versus which change or remove data - this is a core protocol feature,
available to any MCP server, and unrelated to Anthropic's Connectors
Directory (a separate, optional public listing process).

### Reading

Bots only see messages that arrive *after* they start looking - there's no
API to browse arbitrary chat history. `get_updates` returns the messages
Telegram still has queued for the bot; call it whenever you want to check
for new incoming text, files, locations, polls, etc.

- **`get_updates`** - `offset` (number, optional - pass last `update_id` + 1 to avoid re-seeing old messages), `limit` (number, optional, 1-100). Returns each message's text/caption, sender, and metadata for any attached media, location, venue, contact, poll, dice, or sticker (with `file_id` where applicable).
- **`get_file`** - `file_id` (required, from a `get_updates` result). Downloads the file: images come back viewable, text-like files (txt/md/csv/json/xml) come back as readable text, everything else comes back as base64 (Telegram caps bot downloads at 20 MB).

### Sending

- **`get_me`** - no parameters. Checks that your bot token is valid and reachable.
- **`send_message`** - `text` (string, required, max 4096 chars), `parse_mode`, `reply_to_message_id` (number), `disable_notification` (boolean)
- **`send_photo`** - `media` (required), `caption` (string, max 1024 chars), `parse_mode`, `reply_to_message_id`, `disable_notification`. Telegram rejects photos where width + height > ~10,000px or aspect ratio > 20:1, and caps size at 10 MB - use `send_document` to preserve full resolution/size.
- **`send_document`** - same parameters as `send_photo` (max 50 MB, no dimension limit)
- **`send_video`** - same parameters as `send_photo` (max 50 MB)
- **`send_audio`** - same parameters as `send_photo` (max 50 MB)
- **`send_voice`** - `media` (required), `caption` (string, max 1024 chars), `parse_mode`, `reply_to_message_id`, `disable_notification` (max 50 MB)
- **`send_animation`** - same parameters as `send_photo` (max 50 MB)
- **`send_media_group`** - `items` (array of 2-10 `{ type: "photo"|"video", url, caption? }`, required - photo/video only, no documents/audio), `parse_mode`, `reply_to_message_id`, `disable_notification`
- **`send_location`** - `latitude` (number, required), `longitude` (number, required), `live_period` (number, 60-86400s, sends a live/updatable location), `horizontal_accuracy`, `heading`, `proximity_alert_radius`, `reply_to_message_id`, `disable_notification`
- **`send_venue`** - `latitude`, `longitude`, `title`, `address` (all required), `reply_to_message_id`, `disable_notification`
- **`send_contact`** - `phone_number` (required), `first_name` (required), `last_name`, `reply_to_message_id`, `disable_notification`
- **`send_poll`** - `question` (required, max 300 chars), `options` (array of 2-10 strings, required, max 100 chars each), `is_anonymous` (boolean), `allows_multiple_answers` (boolean), `reply_to_message_id`, `disable_notification`
- **`send_dice`** - `emoji` (one of `🎲` `🎯` `🏀` `⚽` `🎳` `🎰`, default `🎲`), `reply_to_message_id`, `disable_notification`
- **`send_chat_action`** - `action` (required, one of `typing`, `upload_photo`, `record_video`, `upload_video`, `record_voice`, `upload_voice`, `upload_document`, `choose_sticker`, `find_location`, `record_video_note`, `upload_video_note`)

### Managing

- **`edit_message_text`** - `message_id` (number, required), `text` (required, max 4096 chars), `parse_mode`
- **`edit_message_caption`** - `message_id` (required), `caption` (required, max 1024 chars), `parse_mode`
- **`delete_message`** - `message_id` (required)
- **`pin_message`** - `message_id` (required), `disable_notification` (boolean)
- **`unpin_message`** - `message_id` (optional - unpins the most recent pinned message if omitted)
- **`unpin_all_messages`** - no parameters
- **`forward_message`** - `from_chat_id` (required), `message_id` (required), `disable_notification` (boolean)
- **`copy_message`** - `from_chat_id` (required), `message_id` (required), `disable_notification` (boolean)

Errors from Telegram (invalid token, rate limits, bad chat id, etc.) come
back as a readable message like `Telegram error 400: chat not found`, never
as a raw stack trace.

## Sending files

There's no way to inline a local file's bytes into a tool call - the model
would have to generate the whole file as output tokens (a 5 MB photo is
~6.7M characters), which is slow no matter the size. Instead, any MCP client
with shell/file access (e.g. **Claude Code**) uploads the file directly from
disk, outside the model's output stream, and passes the resulting URL:

```
curl -F file=@<local-path> "https://<your-service>.onrender.com/api/upload"
```

This returns `{ "url": "..." }`. Pass that URL via the `url` field of `media`
on `send_photo`/`send_document`/etc. Uploaded files are held in memory for
**5 minutes** (enough time for Telegram to fetch them) and capped at **50 MB**
(Telegram's send-size limit for any method). If you set `MCP_ACCESS_KEY` (see
below), the upload URL needs a `?u=<token>` derived from it - the exact URL,
including the token, is included in the MCP server's `instructions` field
that connected clients receive automatically, and in each media tool's
description as a fallback for clients that don't surface `instructions`.

**Very high-resolution photos** (width + height over ~10,000px - common with
full-size stock/camera photos) get rejected by Telegram itself - this is
Telegram's own media-dimension limit, confirmed by testing at the pixel level,
not a hosting or upload-endpoint issue. `send_photo` now returns a clear hint
about this instead of Telegram's raw `failed to get HTTP URL content` /
`wrong type of the web page content` text. Downscale the image before
uploading (e.g. with `ffmpeg`/`imagemagick`), or use `send_document` instead,
if you hit this.

This only works when the calling Claude can run shell commands against a
local file. Shell-less clients (Claude.ai web/Desktop without Bash) can only
send files already reachable by public `url` or an existing `file_id` - a
client-capability limit, not something this server can fix.

## Deploying your own copy

This runs as a persistent Node server rather than a serverless function -
required so large file uploads to `/api/upload` (photos, documents) aren't
truncated by a serverless request-body cap. [Render](https://render.com)'s free tier fits:
it's a real always-on process (no small body-size limit like Lambda-based
serverless hosts impose), gives you a free `*.onrender.com` subdomain, and
deploys automatically from GitHub.

1. Fork or clone this repo.
2. On [Render](https://render.com), click **New +** → **Blueprint**, connect
   your GitHub account, and select your fork. Render reads `render.yaml` at
   the repo root and creates the web service (free plan, Node, health check
   at `/api/health`) automatically.
   - Alternatively: **New +** → **Web Service** → connect the repo manually,
     with build command `npm install && npm run build` and start command
     `npm run start`.
3. In the service's **Settings**, confirm **Auto-Deploy** is set to `Yes` (on
   by default for GitHub-connected services) - every push to your default
   branch then redeploys automatically.
4. *(Optional)* To restrict who can call your endpoint, set an environment
   variable on the Render service:
   - `MCP_ACCESS_KEY` - any secret string you choose. If set, every request
     must include a matching `&key=...` query parameter or the server
     returns 401. Leave it unset to allow any request that carries a valid
     bot token.
5. Use `https://<your-service>.onrender.com/api/mcp?token=...&chat=...` (plus
   `&key=...` if you set one) as your connector URL.
6. *(Optional but recommended)* Render's free tier spins the service down
   after ~15 minutes of inactivity; the next request then takes ~30-60s to
   wake it back up. To avoid that delay, set up a free external cron (e.g.
   [cron-job.org](https://cron-job.org)) to `GET
   https://<your-service>.onrender.com/api/health` every 10-14 minutes.

## Local development

```
npm install
npm run dev
```

The endpoint is available at:
`http://localhost:3000/api/mcp?token=<BOT_TOKEN>&chat=<CHAT_ID>`

Quick smoke test:
```
curl -X POST "http://localhost:3000/api/mcp?token=<BOT_TOKEN>&chat=<CHAT_ID>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Tech stack

Next.js (App Router) on [Render](https://render.com), [`mcp-handler`](https://github.com/vercel/mcp-handler)
(Vercel's MCP adapter, host-agnostic), TypeScript, Zod.

## License

MIT
