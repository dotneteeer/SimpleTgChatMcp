// Minimal Telegram Bot API client: JSON calls, multipart uploads, friendly
// error text, and an automatic plain-text retry when parse_mode formatting
// is rejected by Telegram (so the message still gets delivered).

export type MediaInput =
  | { url: string }
  | { base64: string; filename?: string; mime?: string }
  | { file_id: string };

export interface TgResult {
  ok: boolean;
  text: string;
  raw?: unknown;
}

function apiUrl(token: string, method: string): string {
  return `https://api.telegram.org/bot${token}/${method}`;
}

// Known Telegram error descriptions mapped to actionable hints - Telegram's raw
// text is often too terse to self-correct from (e.g. "failed to get HTTP URL
// content" actually means the photo's dimensions exceed Telegram's limit).
const ERROR_HINTS: { pattern: RegExp; hint: string }[] = [
  {
    pattern: /failed to get http url content|wrong type of the web page content|IMAGE_PROCESS_FAILED|PHOTO_INVALID_DIMENSIONS/i,
    hint:
      "Telegram couldn't fetch/process this photo. Two known causes: (1) the url isn't publicly " +
      "reachable or returned a non-image response - verify it loads directly in a browser with no auth; " +
      "(2) the photo's width + height exceeds ~10,000px or its aspect ratio exceeds 20:1 - downscale it, " +
      "or send it with send_document instead (no dimension limit).",
  },
  {
    pattern: /file is too big/i,
    hint: "This file exceeds Telegram's send-size limit (10 MB for photos, 50 MB for other media).",
  },
  {
    pattern: /message is too long|message_too_long/i,
    hint: "Text exceeds Telegram's 4096-character limit for messages.",
  },
  {
    pattern: /message caption is too long|caption_too_long/i,
    hint: "Caption exceeds Telegram's 1024-character limit.",
  },
  {
    pattern: /wrong file identifier|wrong remote file identifier|invalid file_id/i,
    hint: "The file_id is invalid, expired, or from a different bot - fetch a fresh one via get_updates.",
  },
  {
    pattern: /wrong http url|HTTP URL specified/i,
    hint: "The url is invalid or unreachable by Telegram's servers - confirm it's publicly accessible.",
  },
  {
    pattern: /chat not found/i,
    hint: "The configured chat id is wrong, or the bot was never started in / added to that chat.",
  },
  {
    pattern: /not enough rights|have no rights|need administrator/i,
    hint: "The bot lacks permission for this action in the chat (e.g. pinning/deleting needs admin rights).",
  },
  {
    pattern: /message to edit not found|message to delete not found|message to pin not found|message to unpin not found|message to forward not found|message to copy not found/i,
    hint: "The target message_id doesn't exist, is too old, or was already deleted.",
  },
  {
    pattern: /message can't be edited/i,
    hint: "This message type/age can't be edited (e.g. too old, or a service message).",
  },
  {
    pattern: /message can't be deleted/i,
    hint: "This message can't be deleted (e.g. too old for a group without admin rights).",
  },
  {
    pattern: /there is no text in the message to edit/i,
    hint: "This message has no text field to edit - it's a media message, use edit_message_caption instead.",
  },
  {
    pattern: /there is no caption in the message to edit/i,
    hint: "This message has no caption field to edit - it's a plain text message, use edit_message_text instead.",
  },
  {
    pattern: /conflict/i,
    hint: "Another consumer (a webhook, or a second poller) is already receiving updates for this bot - getUpdates can't be used until it's removed.",
  },
];

function describeError(body: any): string {
  const code = body?.error_code ?? "unknown";
  const desc = body?.description ?? "Unknown error";
  const retryAfter = body?.parameters?.retry_after;
  let msg = `Telegram error ${code}: ${desc}`;
  if (retryAfter) msg += ` (retry after ${retryAfter}s)`;
  const hint = ERROR_HINTS.find((h) => h.pattern.test(desc))?.hint;
  if (hint) msg += `\nHint: ${hint}`;
  return msg;
}

function isParseEntitiesError(body: any): boolean {
  const desc: string = body?.description ?? "";
  return body?.error_code === 400 && /can't parse entities/i.test(desc);
}

// Fields that carry markdown-formatted text, keyed by method name.
const TEXT_FIELD: Record<string, string> = {
  sendMessage: "text",
  editMessageText: "text",
};
const CAPTION_METHODS = new Set([
  "sendPhoto",
  "sendDocument",
  "sendVideo",
  "sendAudio",
  "sendAnimation",
  "editMessageCaption",
]);

async function postJson(token: string, method: string, params: Record<string, unknown>) {
  const res = await fetch(apiUrl(token, method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function callApi(
  token: string,
  method: string,
  params: Record<string, unknown>
): Promise<TgResult> {
  let body: any;
  try {
    body = await postJson(token, method, params);
  } catch (err: any) {
    return { ok: false, text: `Network error calling Telegram: ${err.message ?? err}` };
  }

  if (body.ok) return { ok: true, text: "OK", raw: body.result };

  // If formatting caused the failure and there's a formatted field, retry as plain text.
  if (isParseEntitiesError(body) && params.parse_mode) {
    const textField = TEXT_FIELD[method];
    const hasCaption = CAPTION_METHODS.has(method) && "caption" in params;
    if (textField || hasCaption) {
      const plain = { ...params };
      delete plain.parse_mode;
      let retryBody: any;
      try {
        retryBody = await postJson(token, method, plain);
      } catch (err: any) {
        return { ok: false, text: `Network error calling Telegram: ${err.message ?? err}` };
      }
      if (retryBody.ok) {
        return {
          ok: true,
          text: "OK (formatting was invalid, so it was sent as plain text instead)",
          raw: retryBody.result,
        };
      }
      return { ok: false, text: describeError(retryBody) };
    }
  }

  return { ok: false, text: describeError(body) };
}

// Node's base64 decoder silently ignores non-alphabet characters instead of
// erroring, so a stray "data:image/png;base64," prefix doesn't fail loudly -
// it decodes into garbage bytes. Strip it if present.
function stripDataUriPrefix(b64: string): string {
  const match = /^data:[^;]+;base64,/.exec(b64);
  return match ? b64.slice(match[0].length) : b64;
}

async function mediaToPart(input: MediaInput): Promise<{ value: string | Blob; filename?: string }> {
  if ("url" in input) return { value: input.url };
  if ("file_id" in input) return { value: input.file_id };
  const buf = Buffer.from(stripDataUriPrefix(input.base64), "base64");
  const blob = new Blob([buf], { type: input.mime ?? "application/octet-stream" });
  return { value: blob, filename: input.filename ?? "file" };
}

export async function callApiWithMedia(
  token: string,
  method: string,
  fields: Record<string, unknown>,
  mediaField: string,
  media: MediaInput
): Promise<TgResult> {
  const part = await mediaToPart(media);

  // Simple case: URL or file_id can go through the plain JSON endpoint.
  if (typeof part.value === "string") {
    return callApi(token, method, { ...fields, [mediaField]: part.value });
  }

  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    form.append(key, String(value));
  }
  form.append(mediaField, part.value, part.filename);

  let body: any;
  try {
    const res = await fetch(apiUrl(token, method), { method: "POST", body: form });
    body = await res.json();
  } catch (err: any) {
    return { ok: false, text: `Network error calling Telegram: ${err.message ?? err}` };
  }

  if (body.ok) return { ok: true, text: "OK", raw: body.result };

  if (isParseEntitiesError(body) && fields.parse_mode) {
    const retryForm = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (key === "parse_mode" || value === undefined || value === null) continue;
      retryForm.append(key, String(value));
    }
    retryForm.append(mediaField, part.value, part.filename);
    let retryBody: any;
    try {
      const res = await fetch(apiUrl(token, method), { method: "POST", body: retryForm });
      retryBody = await res.json();
    } catch (err: any) {
      return { ok: false, text: `Network error calling Telegram: ${err.message ?? err}` };
    }
    if (retryBody.ok) {
      return {
        ok: true,
        text: "OK (formatting was invalid, so it was sent as plain text instead)",
        raw: retryBody.result,
      };
    }
    return { ok: false, text: describeError(retryBody) };
  }

  return { ok: false, text: describeError(body) };
}

const EXT_MIME: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
  pdf: "application/pdf",
  zip: "application/zip",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

function guessMime(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? "application/octet-stream";
}

export interface DownloadedFile {
  ok: boolean;
  text: string;
  filename?: string;
  mime?: string;
  size?: number;
  base64?: string;
}

// Resolves a file_id to its bytes via getFile + the Bot API file endpoint.
// Telegram limits bot file downloads to 20 MB.
export async function downloadFile(token: string, fileId: string): Promise<DownloadedFile> {
  const meta = await callApi(token, "getFile", { file_id: fileId });
  if (!meta.ok) return { ok: false, text: meta.text };

  const filePath: string | undefined = (meta.raw as any)?.file_path;
  if (!filePath) return { ok: false, text: "Telegram did not return a file_path for this file_id." };

  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  } catch (err: any) {
    return { ok: false, text: `Network error downloading file: ${err.message ?? err}` };
  }
  if (!res.ok) return { ok: false, text: `Failed to download file: HTTP ${res.status}` };

  const buf = Buffer.from(await res.arrayBuffer());
  const mime = guessMime(filePath);
  const filename = filePath.split("/").pop() ?? filePath;

  return {
    ok: true,
    text: "OK",
    filename,
    mime,
    size: buf.length,
    base64: buf.toString("base64"),
  };
}
