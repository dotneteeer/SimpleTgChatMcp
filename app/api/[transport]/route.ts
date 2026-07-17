import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { callApi, callApiWithMedia, type MediaInput } from "@/lib/telegram";

export const maxDuration = 60;

// --- Shared schema fragments -------------------------------------------------

const parseModeSchema = z
  .enum(["MarkdownV2", "HTML", "Markdown", "none"])
  .default("MarkdownV2")
  .describe("Text formatting mode. 'none' sends plain text.");

const mediaInputSchema = z
  .union([
    z.object({ url: z.string().url() }).describe("Fetch the file from a public URL"),
    z
      .object({
        base64: z.string(),
        filename: z.string().optional(),
        mime: z.string().optional(),
      })
      .describe("Upload raw file content, base64-encoded"),
    z.object({ file_id: z.string() }).describe("Reuse a file_id already known to Telegram"),
  ])
  .describe("The file/photo/media content, given one of three ways");

const commonSendFields = {
  reply_to_message_id: z.number().int().optional(),
  disable_notification: z.boolean().optional(),
};

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

// --- Route handler ------------------------------------------------------------

async function buildHandler(token: string, chat: string) {
  return createMcpHandler(
    (server) => {
      server.registerTool(
        "get_me",
        {
          title: "Get Bot Info",
          description: "Verify the bot token works and return basic bot info.",
          inputSchema: {},
        },
        async () => toResult(await callApi(token, "getMe", {}))
      );

      server.registerTool(
        "send_message",
        {
          title: "Send Message",
          description: "Send a text message to the configured chat.",
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
            title,
            description,
            inputSchema: {
              media: mediaInputSchema,
              ...(withCaption
                ? { caption: z.string().optional(), parse_mode: parseModeSchema }
                : {}),
              ...commonSendFields,
            },
          },
          async (args: any) =>
            toResult(
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
            )
        );
      };

      mediaTool("send_photo", "sendPhoto", "photo", "Send Photo", "Send a photo to the configured chat.");
      mediaTool(
        "send_document",
        "sendDocument",
        "document",
        "Send Document",
        "Send a file/document to the configured chat."
      );
      mediaTool("send_video", "sendVideo", "video", "Send Video", "Send a video to the configured chat.");
      mediaTool("send_audio", "sendAudio", "audio", "Send Audio", "Send an audio file to the configured chat.");
      mediaTool(
        "send_voice",
        "sendVoice",
        "voice",
        "Send Voice",
        "Send a voice message (ogg/opus) to the configured chat.",
        false
      );
      mediaTool(
        "send_animation",
        "sendAnimation",
        "animation",
        "Send Animation",
        "Send a GIF/animation to the configured chat."
      );

      server.registerTool(
        "send_media_group",
        {
          title: "Send Media Group",
          description: "Send an album of 2-10 photos/videos in one message.",
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
                media: items.map((i) => clean({ ...i, parse_mode: pm(parse_mode) })),
                reply_to_message_id,
                disable_notification,
              })
            )
          )
      );

      server.registerTool(
        "send_location",
        {
          title: "Send Location",
          description: "Send a geographic location to the configured chat.",
          inputSchema: {
            latitude: z.number(),
            longitude: z.number(),
            ...commonSendFields,
          },
        },
        async ({ latitude, longitude, reply_to_message_id, disable_notification }) =>
          toResult(
            await callApi(
              token,
              "sendLocation",
              clean({ chat_id: chat, latitude, longitude, reply_to_message_id, disable_notification })
            )
          )
      );

      server.registerTool(
        "send_venue",
        {
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
          title: "Send Poll",
          description: "Send a poll to the configured chat.",
          inputSchema: {
            question: z.string(),
            options: z.array(z.string()).min(2).max(10),
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
          title: "Edit Message Text",
          description: "Edit the text of a previously sent message.",
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
          title: "Edit Message Caption",
          description: "Edit the caption of a previously sent media message.",
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
          title: "Delete Message",
          description: "Delete a message from the configured chat.",
          inputSchema: { message_id: z.number().int() },
        },
        async ({ message_id }) => toResult(await callApi(token, "deleteMessage", { chat_id: chat, message_id }))
      );

      server.registerTool(
        "pin_message",
        {
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
          title: "Unpin All Messages",
          description: "Unpin every pinned message in the configured chat.",
          inputSchema: {},
        },
        async () => toResult(await callApi(token, "unpinAllChatMessages", { chat_id: chat }))
      );

      server.registerTool(
        "forward_message",
        {
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

  const handler = await buildHandler(token, chat);
  return handler(req);
}

export { handle as GET, handle as POST, handle as DELETE };
