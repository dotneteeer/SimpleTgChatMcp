// In-memory transient file store for the out-of-band upload flow (see
// app/api/upload and app/api/file/[id]). Files only need to survive long
// enough for Telegram to fetch them by URL, so no persistence is needed -
// entries expire after a short TTL and are evicted lazily.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TTL_MS = 5 * 60_000;
const MAX_STORE_BYTES = 200 * 1024 * 1024;

interface UploadEntry {
  bytes: Buffer;
  mime: string;
  filename: string;
  expiresAt: number;
}

const store = new Map<string, UploadEntry>();

function evictExpired() {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (entry.expiresAt <= now) store.delete(id);
  }
}

function totalBytes(): number {
  let total = 0;
  for (const entry of store.values()) total += entry.bytes.length;
  return total;
}

export function putUpload(bytes: Buffer, mime: string, filename: string): string {
  evictExpired();
  if (totalBytes() + bytes.length > MAX_STORE_BYTES) {
    throw new Error("Upload store is full, try again shortly.");
  }
  const id = randomBytes(16).toString("hex");
  store.set(id, { bytes, mime, filename, expiresAt: Date.now() + TTL_MS });
  return id;
}

export function getUpload(id: string): UploadEntry | undefined {
  const entry = store.get(id);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    store.delete(id);
    return undefined;
  }
  return entry;
}

// Signs upload access with MCP_ACCESS_KEY so the raw key never enters model
// context - only this derived token (embedded in the MCP `instructions`) does.
// Upload is open (no token required) when MCP_ACCESS_KEY is unset, matching
// the existing MCP route's posture.
export function uploadToken(): string | null {
  const key = process.env.MCP_ACCESS_KEY;
  if (!key) return null;
  return createHmac("sha256", key).update("upload-v1").digest("hex");
}

export function verifyUploadToken(provided: string | null): boolean {
  const expected = uploadToken();
  if (!expected) return true; // open mode
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function uploadBaseUrl(req: Request): string {
  return process.env.RENDER_EXTERNAL_URL ?? new URL(req.url).origin;
}
