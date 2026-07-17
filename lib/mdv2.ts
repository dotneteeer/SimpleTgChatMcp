// Escapes special characters for Telegram's MarkdownV2 parse mode.
// https://core.telegram.org/bots/api#markdownv2-style
const SPECIAL_CHARS = /[_*[\]()~`>#+\-=|{}.!\\]/g;

export function escapeMarkdownV2(text: string): string {
  return text.replace(SPECIAL_CHARS, (ch) => `\\${ch}`);
}
