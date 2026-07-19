import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { callApi, callApiWithMedia, downloadFile, type MediaInput } from "@/lib/telegram";
import { uploadBaseUrl, uploadToken } from "@/lib/upload";

export const maxDuration = 60;

// --- Shared schema fragments -------------------------------------------------

const parseModeSchema = z
  .enum(["MarkdownV2", "HTML", "Markdown", "none"])
  .default("MarkdownV2")
  .describe("Text formatting mode. 'none' sends plain text.");

// Built per-request (in buildHandler) so the base64 field's description can
// embed the concrete upload URL/curl command directly - not every MCP client
// surfaces the server-level `instructions` field, so this is the fallback
// that's always visible wherever the tool schema itself is shown.
function buildMediaInputSchema(uploadUrl: string) {
  return z
    .union([
      z.object({ url: z.string().url() }).describe("Fetch the file from a public URL"),
      z
        .object({
          base64: z.string(),
          filename: z.string().optional(),
          mime: z.string().optional(),
        })
        .describe(
          "Upload raw file content, base64-encoded. Only for small files (under ~300 KB) - " +
            "for anything larger, this is slow (it makes the model generate the whole file as " +
            "output tokens). Instead, if you have shell/file access, run " +
            `\`curl -F file=@<local-path> "${uploadUrl}"\`, which returns { "url": "..." }, ` +
            "and pass that via the 'url' field instead."
        ),
      z.object({ file_id: z.string() }).describe("Reuse a file_id already known to Telegram"),
    ])
    .describe("The file/photo/media content, given one of three ways");
}

// Above this, base64 is rejected in favor of the out-of-band upload flow -
// prose guidance alone is unreliable, so this is enforced as a hard runtime
// guard with a corrective error (see mediaTool below).
const BASE64_INLINE_LIMIT = 400_000; // chars, ~300 KB of binary

const commonSendFields = {
  reply_to_message_id: z.number().int().optional(),
  disable_notification: z.boolean().optional(),
};

// MCP tool annotation presets - see https://modelcontextprotocol.io for the spec.
// These describe tool behavior (not the Anthropic Connectors Directory, which is unrelated).
const READ_ONLY = { annotations: { readOnlyHint: true, destructiveHint: false } };
const WRITE = { annotations: { readOnlyHint: false, destructiveHint: false } };
const DESTRUCTIVE = { annotations: { readOnlyHint: false, destructiveHint: true } };

function toResult(r: { ok: boolean; text: string }) {
  return {
    content: [{ type: "text" as const, text: r.text }],
    isError: !r.ok,
  };
}

function pm(mode: z.infer<typeof parseModeSchema>): string | undefined {
  return mode === "none" ? undefined : mode;
}

function clean<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

// Trims an update object down to the fields that matter for reading messages/files.
function summarizeUpdate(u: any) {
  const m = u.message ?? u.channel_post ?? u.edited_message;
  if (!m) return { update_id: u.update_id, raw: u };

  const media: Record<string, unknown> = {};
  if (m.document) media.document = { file_id: m.document.file_id, file_name: m.document.file_name, mime_type: m.document.mime_type, file_size: m.document.file_size };
  if (m.photo?.length) media.photo = { file_id: m.photo[m.photo.length - 1].file_id, file_size: m.photo[m.photo.length - 1].file_size };
  if (m.video) media.video = { file_id: m.video.file_id, mime_type: m.video.mime_type, file_size: m.video.file_size };
  if (m.audio) media.audio = { file_id: m.audio.file_id, mime_type: m.audio.mime_type, file_size: m.audio.file_size };
  if (m.voice) media.voice = { file_id: m.voice.file_id, mime_type: m.voice.mime_type, file_size: m.voice.file_size };
  if (m.animation) media.animation = { file_id: m.animation.file_id, mime_type: m.animation.mime_type, file_size: m.animation.file_size };
  if (m.video_note) media.video_note = { file_id: m.video_note.file_id, file_size: m.video_note.file_size };
  if (m.sticker) media.sticker = { file_id: m.sticker.file_id, emoji: m.sticker.emoji };

  const extras: Record<string, unknown> = {};
  if (m.location) extras.location = { latitude: m.location.latitude, longitude: m.location.longitude };
  if (m.venue) extras.venue = { title: m.venue.title, address: m.venue.address, location: m.venue.location };
  if (m.contact) extras.contact = { phone_number: m.contact.phone_number, first_name: m.contact.first_name, last_name: m.contact.last_name };
  if (m.poll) extras.poll = { question: m.poll.question, options: m.poll.options?.map((o: any) => ({ text: o.text, voter_count: o.voter_count })) };
  if (m.dice) extras.dice = { emoji: m.dice.emoji, value: m.dice.value };
  if (m.reply_to_message) extras.reply_to_message_id = m.reply_to_message.message_id;

  return {
    update_id: u.update_id,
    message_id: m.message_id,
    date: m.date,
    from: m.from ? { id: m.from.id, username: m.from.username, first_name: m.from.first_name } : undefined,
    text: m.text,
    caption: m.caption,
    ...(Object.keys(media).length ? { media } : {}),
    ...extras,
  };
}

// --- Route handler ------------------------------------------------------------

// The concrete URL (with signed token, if MCP_ACCESS_KEY is set) clients with
// shell/file access (e.g. Claude Code) should curl a local file to, to upload
// it out-of-band instead of embedding it as base64 in a tool call.
function uploadUrlFor(req: Request): string {
  const base = uploadBaseUrl(req);
  const t = uploadToken();
  return `${base}/api/upload${t ? `?u=${t}` : ""}`;
}

// Server-level `instructions` (MCP `initialize` response) - a secondary
// channel to the same guidance embedded directly in tool/schema descriptions
// below, for clients that don't surface `instructions` prominently.
function uploadInstructions(uploadUrl: string): string {
  return (
    "For files larger than ~300 KB, do NOT pass raw bytes via the 'base64' media field - " +
    "that forces you to generate the whole file as output tokens, which is slow. Instead, " +
    "if you have shell/file access, upload the file out-of-band first:\n\n" +
    `  curl -F file=@<local-path> "${uploadUrl}"\n\n` +
    "This returns { \"url\": \"...\" }. Pass that URL via the media 'url' field on " +
    "send_photo/send_document/send_video/etc. Uploaded files expire after 5 minutes and " +
    "are capped at 50 MB (Telegram's send limit). This trick only works when you can run " +
    "shell commands against a local file - in shell-less clients, base64 is unavoidable."
  );
}

async function buildHandler(token: string, chat: string, req: Request) {
  const uploadUrl = uploadUrlFor(req);
  const mediaInputSchema = buildMediaInputSchema(uploadUrl);
  return createMcpHandler(
    (server) => {
      server.registerTool(
        "get_me",
        {
          ...READ_ONLY,
          title: "Get Bot Info",
          description: "Verify the bot token works and return basic bot info.",
          inputSchema: {},
        },
        async () => toResult(await callApi(token, "getMe", {}))
      );

      server.registerTool(
        "get_updates",
        {
          ...READ_ONLY,
          title: "Get Updates",
          description:
            "Read messages sent to the bot (only from the configured chat). Bots can only see messages " +
            "that arrived after they started looking, so call this to check for new incoming messages/files. " +
            "Pass 'offset' as (last update_id seen + 1) to avoid seeing the same updates again; omit it to " +
            "see everything Telegram still has queued.",
          inputSchema: {
            offset: z.number().int().optional(),
            limit: z.number().int().min(1).max(100).optional(),
          },
        },
        async ({ offset, limit }) => {
          const result = await callApi(token, "getUpdates", clean({ offset, limit, timeout: 0 }));
          if (!result.ok) return toResult(result);
          const updates = (result.raw as any[])
            .filter((u) => {
              const m = u.message ?? u.channel_post ?? u.edited_message;
              return m && String(m.chat?.id) === String(chat);
            })
            .map(summarizeUpdate);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(updates, null, 2) }],
          };
        }
      );

      server.registerTool(
        "get_file",
        {
          ...READ_ONLY,
          title: "Get File",
          description:
            "Download a file previously seen via get_updates (by file_id) and return its content. " +
            "Text-like files are returned as readable text, images are returned as viewable images, " +
            "everything else is returned as base64. Telegram limits bot downloads to 20 MB.",
          inputSchema: { file_id: z.string() },
        },
        async ({ file_id }) => {
          const file = await downloadFile(token, file_id);
          if (!file.ok) return toResult(file);

          const mime = file.mime ?? "application/octet-stream";
          if (mime.startsWith("image/")) {
            return {
              content: [{ type: "image" as const, data: file.base64!, mimeType: mime }],
            };
          }
          if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml") {
            const text = Buffer.from(file.base64!, "base64").toString("utf-8");
            return {
              content: [{ type: "text" as const, text: `File: ${file.filename} (${mime})\n\n${text}` }],
            };
          }
          return {
            content: [
              {
                type: "text" as const,
                text: `File: ${file.filename} (${mime}, ${file.size} bytes). Not directly readable as text - base64 content:\n\n${file.base64}`,
              },
            ],
          };
        }
      );

      server.registerTool(
        "send_message",
        {
          ...WRITE,
          title: "Send Message",
          description: "Send a text message to the configured chat. Max 4096 characters.",
          inputSchema: {
            text: z.string(),
            parse_mode: parseModeSchema,
            ...commonSendFields,
          },
        },
        async ({ text, parse_mode, reply_to_message_id, disable_notification }) =>
          toResult(
            await callApi(
              token,
              "sendMessage",
              clean({
                chat_id: chat,
                text,
                parse_mode: pm(parse_mode),
                reply_to_message_id,
                disable_notification,
              })
            )
          )
      );

      const mediaTool = (
        name: string,
        method: string,
        field: string,
        title: string,
        description: string,
        withCaption = true
      ) => {
        server.registerTool(
          name,
          {
            ...WRITE,
            title,
            description:
              `${description}` +
              (withCaption ? " Caption max 1024 characters." : "") +
              ` For files over ~300 KB, don't use base64 - run ` +
              `\`curl -F file=@<local-path> "${uploadUrl}"\` and pass the returned URL via 'media.url' instead.`,
            inputSchema: {
              media: mediaInputSchema,
              ...(withCaption
                ? { caption: z.string().optional(), parse_mode: parseModeSchema }
                : {}),
              ...commonSendFields,
            },
          },
          async (args: any) => {
            if (args.media?.base64 && args.media.base64.length > BASE64_INLINE_LIMIT) {
              return {
                isError: true,
                content: [
                  {
                    type: "text" as const,
                    text:
                      `This base64 payload is ${args.media.base64.length} chars, over the ` +
                      `${BASE64_INLINE_LIMIT}-char inline limit. Upload it out-of-band instead:\n\n` +
                      uploadInstructions(uploadUrl) +
                      `\n\nThen call this tool again with { "media": { "url": "<returned url>" } }.`,
                  },
                ],
              };
            }
            return toResult(
              await callApiWithMedia(
                token,
                method,
                clean({
                  chat_id: chat,
                  caption: args.caption,
                  parse_mode: withCaption ? pm(args.parse_mode) : undefined,
                  reply_to_message_id: args.reply_to_message_id,
                  disable_notification: args.disable_notification,
                }),
                field,
                args.media as MediaInput
              )
            );
          }
        );
      };

      mediaTool(
        "send_photo",
        "sendPhoto",
        "photo",
        "Send Photo",
        "Send a photo to the configured chat. Telegram rejects photos where width + height exceeds " +
          "~10,000px or the aspect ratio exceeds 20:1, and caps size at 10 MB - use send_document instead " +
          "if you need to preserve full resolution/size."
      );
      mediaTool(
        "send_document",
        "sendDocument",
        "document",
        "Send Document",
        "Send a file/document to the configured chat. Max 50 MB."
      );
      mediaTool(
        "send_video",
        "sendVideo",
        "video",
        "Send Video",
        "Send a video to the configured chat. Max 50 MB."
      );
      mediaTool(
        "send_audio",
        "sendAudio",
        "audio",
        "Send Audio",
        "Send an audio file to the configured chat. Max 50 MB."
      );
      mediaTool(
        "send_voice",
        "sendVoice",
        "voice",
        "Send Voice",
        "Send a voice message (ogg/opus) to the configured chat. Max 50 MB."
      );
      mediaTool(
        "send_animation",
        "sendAnimation",
        "animation",
        "Send Animation",
        "Send a GIF/animation to the configured chat. Max 50 MB."
      );

      server.registerTool(
        "send_media_group",
        {
          ...WRITE,
          title: "Send Media Group",
          description:
            "Send an album of 2-10 photos/videos in one message. Photo/video only (no documents/audio); " +
            "caption max 1024 characters per item.",
          inputSchema: {
            items: z
              .array(
                z.object({
                  type: z.enum(["photo", "video"]),
                  url: z.string().url(),
                  caption: z.string().optional(),
                })
              )
              .min(2)
              .max(10),
            parse_mode: parseModeSchema,
            ...commonSendFields,
          },
        },
        async ({ items, parse_mode, reply_to_message_id, disable_notification }) =>
          toResult(
            await callApi(
              token,
              "sendMediaGroup",
              clean({
                chat_id: chat,
                // Telegram's InputMedia expects the file/url under a "media" field, not "url" -
                // translate here so the tool's own schema can keep the clearer "url" name.
                media: items.map((i) =>
                  clean({ type: i.type, media: i.url, caption: i.caption, parse_mode: pm(parse_mode) })
                ),
                reply_to_message_id,
                disable_notification,
              })
            )
          )
      );

      server.registerTool(
        "send_location",
        {
          ...WRITE,
          title: "Send Location",
          description:
            "Send a geographic location to the configured chat. Set live_period to send a live location " +
            "that updates for that many seconds (60-86400).",
          inputSchema: {
            latitude: z.number(),
            longitude: z.number(),
            live_period: z
              .number()
              .int()
              .min(60)
              .max(86400)
              .optional()
              .describe("Seconds the location stays live and updatable (60-86400), or omit for a static location."),
            horizontal_accuracy: z.number().min(0).max(1500).optional(),
            heading: z
              .number()
              .int()
              .min(1)
              .max(360)
              .optional()
              .describe("Direction of movement in degrees (1-360). Only meaningful with live_period."),
            proximity_alert_radius: z
              .number()
              .int()
              .min(1)
              .max(100000)
              .optional()
              .describe("Radius in meters for proximity alerts. Only meaningful with live_period."),
            ...commonSendFields,
          },
        },
        async ({
          latitude,
          longitude,
          live_period,
          horizontal_accuracy,
          heading,
          proximity_alert_radius,
          reply_to_message_id,
          disable_notification,
        }) =>
          toResult(
            await callApi(
              token,
              "sendLocation",
              clean({
                chat_id: chat,
                latitude,
                longitude,
                live_period,
                horizontal_accuracy,
                heading,
                proximity_alert_radius,
                reply_to_message_id,
                disable_notification,
              })
            )
          )
      );

      server.registerTool(
        "send_venue",
        {
          ...WRITE,
          title: "Send Venue",
          description: "Send a venue (location with a name/address) to the configured chat.",
          inputSchema: {
            latitude: z.number(),
            longitude: z.number(),
            title: z.string(),
            address: z.string(),
            ...commonSendFields,
          },
        },
        async ({ latitude, longitude, title, address, reply_to_message_id, disable_notification }) =>
          toResult(
            await callApi(
              token,
              "sendVenue",
              clean({
                chat_id: chat,
                latitude,
                longitude,
                title,
                address,
                reply_to_message_id,
                disable_notification,
              })
            )
          )
      );

      server.registerTool(
        "send_contact",
        {
          ...WRITE,
          title: "Send Contact",
          description: "Send a contact card to the configured chat.",
          inputSchema: {
            phone_number: z.string(),
            first_name: z.string(),
            last_name: z.string().optional(),
            ...commonSendFields,
          },
        },
        async ({ phone_number, first_name, last_name, reply_to_message_id, disable_notification }) =>
          toResult(
            await callApi(
              token,
              "sendContact",
              clean({
                chat_id: chat,
                phone_number,
                first_name,
                last_name,
                reply_to_message_id,
                disable_notification,
              })
            )
          )
      );

      server.registerTool(
        "send_poll",
        {
          ...WRITE,
          title: "Send Poll",
          description: "Send a poll to the configured chat. Question max 300 characters, each option max 100.",
          inputSchema: {
            question: z.string().max(300),
            options: z.array(z.string().max(100)).min(2).max(10),
            is_anonymous: z.boolean().optional(),
            allows_multiple_answers: z.boolean().optional(),
            ...commonSendFields,
          },
        },
        async ({
          question,
          options,
          is_anonymous,
          allows_multiple_answers,
          reply_to_message_id,
          disable_notification,
        }) =>
          toResult(
            await callApi(
              token,
              "sendPoll",
              clean({
                chat_id: chat,
                question,
                options,
                is_anonymous,
                allows_multiple_answers,
                reply_to_message_id,
                disable_notification,
              })
            )
          )
      );

      server.registerTool(
        "send_dice",
        {
          ...WRITE,
          title: "Send Dice",
          description: "Send an animated dice/emoji roll (dice, dart, basketball, football, bowling, slot machine).",
          inputSchema: {
            emoji: z.enum(["🎲", "🎯", "🏀", "⚽", "🎳", "🎰"]).default("🎲"),
            ...commonSendFields,
          },
        },
        async ({ emoji, reply_to_message_id, disable_notification }) =>
          toResult(
            await callApi(
              token,
              "sendDice",
              clean({ chat_id: chat, emoji, reply_to_message_id, disable_notification })
            )
          )
      );

      server.registerTool(
        "send_chat_action",
        {
          ...WRITE,
          title: "Send Chat Action",
          description: "Show a transient status like 'typing' or 'uploading photo' in the chat.",
          inputSchema: {
            action: z.enum([
              "typing",
              "upload_photo",
              "record_video",
              "upload_video",
              "record_voice",
              "upload_voice",
              "upload_document",
              "choose_sticker",
              "find_location",
              "record_video_note",
              "upload_video_note",
            ]),
          },
        },
        async ({ action }) => toResult(await callApi(token, "sendChatAction", { chat_id: chat, action }))
      );

      server.registerTool(
        "edit_message_text",
        {
          ...WRITE,
          title: "Edit Message Text",
          description: "Edit the text of a previously sent message. Max 4096 characters.",
          inputSchema: {
            message_id: z.number().int(),
            text: z.string(),
            parse_mode: parseModeSchema,
          },
        },
        async ({ message_id, text, parse_mode }) =>
          toResult(
            await callApi(
              token,
              "editMessageText",
              clean({ chat_id: chat, message_id, text, parse_mode: pm(parse_mode) })
            )
          )
      );

      server.registerTool(
        "edit_message_caption",
        {
          ...WRITE,
          title: "Edit Message Caption",
          description: "Edit the caption of a previously sent media message. Max 1024 characters.",
          inputSchema: {
            message_id: z.number().int(),
            caption: z.string(),
            parse_mode: parseModeSchema,
          },
        },
        async ({ message_id, caption, parse_mode }) =>
          toResult(
            await callApi(
              token,
              "editMessageCaption",
              clean({ chat_id: chat, message_id, caption, parse_mode: pm(parse_mode) })
            )
          )
      );

      server.registerTool(
        "delete_message",
        {
          ...DESTRUCTIVE,
          title: "Delete Message",
          description: "Delete a message from the configured chat.",
          inputSchema: { message_id: z.number().int() },
        },
        async ({ message_id }) => toResult(await callApi(token, "deleteMessage", { chat_id: chat, message_id }))
      );

      server.registerTool(
        "pin_message",
        {
          ...WRITE,
          title: "Pin Message",
          description: "Pin a message in the configured chat.",
          inputSchema: {
            message_id: z.number().int(),
            disable_notification: z.boolean().optional(),
          },
        },
        async ({ message_id, disable_notification }) =>
          toResult(
            await callApi(token, "pinChatMessage", clean({ chat_id: chat, message_id, disable_notification }))
          )
      );

      server.registerTool(
        "unpin_message",
        {
          ...WRITE,
          title: "Unpin Message",
          description: "Unpin a specific message (or the most recent pinned message if no id is given).",
          inputSchema: { message_id: z.number().int().optional() },
        },
        async ({ message_id }) =>
          toResult(await callApi(token, "unpinChatMessage", clean({ chat_id: chat, message_id })))
      );

      server.registerTool(
        "unpin_all_messages",
        {
          ...WRITE,
          title: "Unpin All Messages",
          description: "Unpin every pinned message in the configured chat.",
          inputSchema: {},
        },
        async () => toResult(await callApi(token, "unpinAllChatMessages", { chat_id: chat }))
      );

      server.registerTool(
        "forward_message",
        {
          ...WRITE,
          title: "Forward Message",
          description: "Forward a message from another chat into the configured chat.",
          inputSchema: {
            from_chat_id: z.string(),
            message_id: z.number().int(),
            disable_notification: z.boolean().optional(),
          },
        },
        async ({ from_chat_id, message_id, disable_notification }) =>
          toResult(
            await callApi(
              token,
              "forwardMessage",
              clean({ chat_id: chat, from_chat_id, message_id, disable_notification })
            )
          )
      );

      server.registerTool(
        "copy_message",
        {
          ...WRITE,
          title: "Copy Message",
          description: "Copy a message from another chat into the configured chat (no forward-from link shown).",
          inputSchema: {
            from_chat_id: z.string(),
            message_id: z.number().int(),
            disable_notification: z.boolean().optional(),
          },
        },
        async ({ from_chat_id, message_id, disable_notification }) =>
          toResult(
            await callApi(
              token,
              "copyMessage",
              clean({ chat_id: chat, from_chat_id, message_id, disable_notification })
            )
          )
      );
    },
    {
      serverInfo: { name: "SimpleTgChatMcp", version: "1.0.0" },
      capabilities: { tools: {} },
      instructions: uploadInstructions(uploadUrl),
    },
    { basePath: "/api", maxDuration: 60 }
  );
}

async function handle(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const chat = url.searchParams.get("chat");
  const key = url.searchParams.get("key");

  const requiredKey = process.env.MCP_ACCESS_KEY;
  if (requiredKey && key !== requiredKey) {
    return new Response(JSON.stringify({ error: "Unauthorized: missing or invalid 'key'." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!token || !chat) {
    return new Response(
      JSON.stringify({
        error:
          "Missing 'token' and/or 'chat' query params. Connector URL must look like: /api/mcp?token=<BOT_TOKEN>&chat=<CHAT_ID>",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const handler = await buildHandler(token, chat, req);
  return handler(req);
}

export { handle as GET, handle as POST, handle as DELETE };
