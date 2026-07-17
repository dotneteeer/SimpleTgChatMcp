# SimpleTgChatMcp

[![CI](https://github.com/dotneteeer/SimpleTgChatMcp/actions/workflows/ci.yml/badge.svg)](https://github.com/dotneteeer/SimpleTgChatMcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A remote **MCP (Model Context Protocol) server** that lets Claude send
messages, photos, documents, and other media to a Telegram chat through the
Telegram Bot API - and manage those messages (edit, delete, pin, forward).

Live instance: **https://simple-tg-chat-mcp.vercel.app/api/mcp**

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
https://simple-tg-chat-mcp.vercel.app/api/mcp?token=<BOT_TOKEN>&chat=<CHAT_ID>
```

Replace `<BOT_TOKEN>` and `<CHAT_ID>` with the values from steps 1-2. That's
the whole configuration - keep this URL private, since anyone who has it can
send messages through your bot.

## Step 4 - Connect it to Claude

**Claude.ai / Claude Desktop**
1. Go to **Settings -> Connectors -> Add custom connector**.
2. Give it a **name**, e.g. `Telegram`.
3. Paste your connector URL from Step 3 into the URL field.
4. Save. Claude can now call the Telegram tools in any conversation.

**Claude Code (CLI)**
```
claude mcp add --transport http Telegram "https://simple-tg-chat-mcp.vercel.app/api/mcp?token=<BOT_TOKEN>&chat=<CHAT_ID>"
```
Here `--transport http` selects the HTTP transport; `Telegram` is just the
local name this server will be registered under (pick anything you like) -
it has nothing to do with `--transport` itself, it's a separate argument.

**Verify it's working**: ask Claude to use the `get_me` tool, or just say
"send a test message to Telegram" - you should see it show up in your chat.

## Available tools

`media` (used by several tools below) accepts one of:
- `{ "url": "https://..." }` - Telegram fetches the file itself
- `{ "base64": "...", "filename": "...", "mime": "..." }` - raw file bytes, uploaded directly
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
- **`send_message`** - `text` (string, required), `parse_mode`, `reply_to_message_id` (number), `disable_notification` (boolean)
- **`send_photo`** - `media` (required), `caption` (string), `parse_mode`, `reply_to_message_id`, `disable_notification`
- **`send_document`** - same parameters as `send_photo`
- **`send_video`** - same parameters as `send_photo`
- **`send_audio`** - same parameters as `send_photo`
- **`send_voice`** - `media` (required), `reply_to_message_id`, `disable_notification` (no caption/parse_mode - voice notes don't support them)
- **`send_animation`** - same parameters as `send_photo`
- **`send_media_group`** - `items` (array of 2-10 `{ type: "photo"|"video", url, caption? }`, required), `parse_mode`, `reply_to_message_id`, `disable_notification`
- **`send_location`** - `latitude` (number, required), `longitude` (number, required), `reply_to_message_id`, `disable_notification`
- **`send_venue`** - `latitude`, `longitude`, `title`, `address` (all required), `reply_to_message_id`, `disable_notification`
- **`send_contact`** - `phone_number` (required), `first_name` (required), `last_name`, `reply_to_message_id`, `disable_notification`
- **`send_poll`** - `question` (required), `options` (array of 2-10 strings, required), `is_anonymous` (boolean), `allows_multiple_answers` (boolean), `reply_to_message_id`, `disable_notification`
- **`send_dice`** - `emoji` (one of `🎲` `🎯` `🏀` `⚽` `🎳` `🎰`, default `🎲`), `reply_to_message_id`, `disable_notification`
- **`send_chat_action`** - `action` (required, one of `typing`, `upload_photo`, `record_video`, `upload_video`, `record_voice`, `upload_voice`, `upload_document`, `choose_sticker`, `find_location`, `record_video_note`, `upload_video_note`)

### Managing

- **`edit_message_text`** - `message_id` (number, required), `text` (required), `parse_mode`
- **`edit_message_caption`** - `message_id` (required), `caption` (required), `parse_mode`
- **`delete_message`** - `message_id` (required)
- **`pin_message`** - `message_id` (required), `disable_notification` (boolean)
- **`unpin_message`** - `message_id` (optional - unpins the most recent pinned message if omitted)
- **`unpin_all_messages`** - no parameters
- **`forward_message`** - `from_chat_id` (required), `message_id` (required), `disable_notification` (boolean)
- **`copy_message`** - `from_chat_id` (required), `message_id` (required), `disable_notification` (boolean)

Errors from Telegram (invalid token, rate limits, bad chat id, etc.) come
back as a readable message like `Telegram error 400: chat not found`, never
as a raw stack trace.

## Deploying your own copy

Want your own instance instead of the shared one above (e.g. to set an
access key, or just to run your own infrastructure)?

1. Fork or clone this repo.
2. Import it into [Vercel](https://vercel.com/new) (Next.js is auto-detected;
   no environment variables are required).
3. *(Optional)* To restrict who can call your endpoint, set an environment
   variable on the Vercel project:
   - `MCP_ACCESS_KEY` - any secret string you choose. If set, every request
     must include a matching `&key=...` query parameter or the server
     returns 401. Leave it unset to allow any request that carries a valid
     bot token (the default for the shared instance above).
4. Use `https://<your-deployment>.vercel.app/api/mcp?token=...&chat=...` (plus
   `&key=...` if you set one) as your connector URL.

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

Next.js (App Router) on Vercel, [`mcp-handler`](https://github.com/vercel/mcp-handler)
(the official Vercel MCP adapter), TypeScript, Zod.

## License

MIT
