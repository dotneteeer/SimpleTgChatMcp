# SimpleTgChatMcp

[![CI](https://github.com/dotneteeer/SimpleTgChatMcp/actions/workflows/ci.yml/badge.svg)](https://github.com/dotneteeer/SimpleTgChatMcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/dotneteeer/SimpleTgChatMcp)](https://github.com/dotneteeer/SimpleTgChatMcp/releases)

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
2. Paste your connector URL from Step 3.
3. Save. Claude can now call the Telegram tools in any conversation.

**Claude Code (CLI)**
```
claude mcp add --transport http tg "https://simple-tg-chat-mcp.vercel.app/api/mcp?token=<BOT_TOKEN>&chat=<CHAT_ID>"
```

**Verify it's working**: ask Claude to use the `get_me` tool, or just say
"send a test message to Telegram" - you should see it show up in your chat.

## Available tools

**Sending**
`send_message`, `send_photo`, `send_document`, `send_video`, `send_audio`,
`send_voice`, `send_animation`, `send_media_group` (albums), `send_location`,
`send_venue`, `send_contact`, `send_poll`, `send_dice`, `send_chat_action`.

**Managing**
`edit_message_text`, `edit_message_caption`, `delete_message`, `pin_message`,
`unpin_message`, `unpin_all_messages`, `forward_message`, `copy_message`.

**Utility**
`get_me` - checks that your bot token is valid and reachable.

Photo/document/video/audio/voice/animation tools accept `media` as one of:
- `{ "url": "https://..." }` - Telegram fetches the file itself
- `{ "base64": "...", "filename": "...", "mime": "..." }` - raw file bytes, uploaded directly
- `{ "file_id": "..." }` - reuse a file Telegram already has

Text and captions default to **MarkdownV2** formatting. If Telegram rejects
the formatting (e.g. unescaped special characters), the server automatically
retries the send as plain text so the message still goes through, and tells
you it fell back.

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
