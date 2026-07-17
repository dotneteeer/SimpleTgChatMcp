# SimpleTgChatMcp

A remote MCP server that lets Claude send messages, photos, documents, and other
media to a single Telegram chat via the Bot API.

The server is **stateless and multi-tenant**: your bot token and chat ID live in
the connector URL itself (set once when you add the connector), not on the
server. Nothing is stored.

## 1. Get a bot token and chat ID

1. Open Telegram, message **@BotFather**, send `/newbot`, follow the prompts.
   BotFather gives you a token like `123456789:AAExampleTokenValue`.
2. Send any message to your new bot (or add it to a group/channel).
3. Open this URL in a browser, replacing `<TOKEN>`:
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. Find `"chat":{"id": ...}` in the response - that number is your `chat_id`.
   - For groups: add the bot to the group first, then send a message there.
   - For channels: add the bot as admin; `chat_id` can be `@channelusername`
     or the numeric channel id.

## 2. Deploy to Vercel

Import this repository into Vercel (or run `vercel deploy` from this
directory). No environment variables are required to deploy.

Optional: to restrict who can call your deployed endpoint, set an environment
variable in the Vercel project:

- `MCP_ACCESS_KEY` - any secret string of your choosing. If set, every request
  must include a matching `key` query parameter or the server returns 401.
  Leave unset if you're fine with the endpoint being reachable by anyone who
  knows the URL (they'd still need a valid bot token to do anything with it).

## 3. Connect it to Claude

Your connector URL is:

```
https://<your-deployment>.vercel.app/api/mcp?token=<BOT_TOKEN>&chat=<CHAT_ID>
```

Add `&key=<MCP_ACCESS_KEY>` at the end if you set that variable.

**Claude.ai / Claude Desktop**: Settings -> Connectors -> Add custom connector,
paste the URL above.

**Claude Code**:
```
claude mcp add --transport http tg "https://<your-deployment>.vercel.app/api/mcp?token=<BOT_TOKEN>&chat=<CHAT_ID>"
```

## Tools

Sending: `send_message`, `send_photo`, `send_document`, `send_video`,
`send_audio`, `send_voice`, `send_animation`, `send_media_group`,
`send_location`, `send_venue`, `send_contact`, `send_poll`, `send_dice`,
`send_chat_action`.

Managing: `edit_message_text`, `edit_message_caption`, `delete_message`,
`pin_message`, `unpin_message`, `unpin_all_messages`, `forward_message`,
`copy_message`.

Utility: `get_me` (checks the bot token is valid).

Photo/document/video/audio/voice/animation tools accept `media` as one of:
- `{ "url": "https://..." }` - Telegram fetches it directly
- `{ "base64": "...", "filename": "...", "mime": "..." }` - uploaded as raw bytes
- `{ "file_id": "..." }` - reuse a file already known to Telegram

Text and captions default to `MarkdownV2` formatting. If Telegram rejects the
formatting (e.g. unescaped special characters), the server automatically
retries as plain text so the message still gets delivered, and says so in the
result.

## Local development

```
npm install
npm run dev
```

The endpoint is `http://localhost:3000/api/mcp?token=<BOT_TOKEN>&chat=<CHAT_ID>`.
