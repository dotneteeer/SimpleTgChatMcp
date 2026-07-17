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

function describeError(body: any): string {
  const code = body?.error_code ?? "unknown";
  const desc = body?.description ?? "Unknown error";
  const retryAfter = body?.parameters?.retry_after;
  let msg = `Telegram error ${code}: ${desc}`;
  if (retryAfter) msg += ` (retry after ${retryAfter}s)`;
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

async function mediaToPart(input: MediaInput): Promise<{ value: string | Blob; filename?: string }> {
  if ("url" in input) return { value: input.url };
  if ("file_id" in input) return { value: input.file_id };
  const buf = Buffer.from(input.base64, "base64");
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
