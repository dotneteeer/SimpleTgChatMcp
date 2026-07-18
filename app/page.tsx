"use client";

import { useMemo, useState } from "react";

const REPO_URL = "https://github.com/dotneteeer/SimpleTgChatMcp";
const BASE_URL = "https://simple-tg-chat-mcp.vercel.app";

type Annotation = "read" | "write" | "destructive";

const TOOL_GROUPS: { title: string; tools: { name: string; kind: Annotation }[] }[] = [
  {
    title: "Reading",
    tools: [
      { name: "get_updates", kind: "read" },
      { name: "get_file", kind: "read" },
    ],
  },
  {
    title: "Sending",
    tools: [
      { name: "get_me", kind: "read" },
      { name: "send_message", kind: "write" },
      { name: "send_photo", kind: "write" },
      { name: "send_document", kind: "write" },
      { name: "send_video", kind: "write" },
      { name: "send_audio", kind: "write" },
      { name: "send_voice", kind: "write" },
      { name: "send_animation", kind: "write" },
      { name: "send_media_group", kind: "write" },
      { name: "send_location", kind: "write" },
      { name: "send_venue", kind: "write" },
      { name: "send_contact", kind: "write" },
      { name: "send_poll", kind: "write" },
      { name: "send_dice", kind: "write" },
      { name: "send_chat_action", kind: "write" },
    ],
  },
  {
    title: "Managing",
    tools: [
      { name: "edit_message_text", kind: "write" },
      { name: "edit_message_caption", kind: "write" },
      { name: "delete_message", kind: "destructive" },
      { name: "pin_message", kind: "write" },
      { name: "unpin_message", kind: "write" },
      { name: "unpin_all_messages", kind: "write" },
      { name: "forward_message", kind: "write" },
      { name: "copy_message", kind: "write" },
    ],
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy-btn"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

export default function Home() {
  const [token, setToken] = useState("");
  const [chat, setChat] = useState("");

  const url = useMemo(() => {
    const t = token.trim() ? encodeURIComponent(token.trim()) : "<BOT_TOKEN>";
    const c = chat.trim() ? encodeURIComponent(chat.trim()) : "<CHAT_ID>";
    return `${BASE_URL}/api/mcp?token=${t}&chat=${c}`;
  }, [token, chat]);

  const claudeCodeCmd = `claude mcp add --transport http -s user Telegram "${url}"`;

  return (
    <>
      <header className="hero">
        <div className="container">
          <img src="/icon.svg" alt="SimpleTgChat MCP" className="hero-logo" />
          <div className="badge">Remote MCP Server</div>
          <h1>SimpleTgChat MCP</h1>
          <p>Let Claude send messages, photos, polls and more to one Telegram chat - no install, no server to run.</p>
          <div className="hero-actions">
            <a href="#builder" className="btn btn-primary">
              Build your URL
            </a>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="btn btn-ghost">
              View on GitHub
            </a>
          </div>
        </div>
      </header>

      <section>
        <div className="container">
          <h2>What is this?</h2>
          <p className="section-sub">A minimal MCP server built for exactly one job.</p>
          <div className="features">
            <div className="feature-card">
              <div className="icon">☁️</div>
              <h3>Fully remote</h3>
              <p>Hosted on Vercel. Nothing to install or run locally.</p>
            </div>
            <div className="feature-card">
              <div className="icon">💬</div>
              <h3>One chat</h3>
              <p>Every call targets a single, pre-configured Telegram chat.</p>
            </div>
            <div className="feature-card">
              <div className="icon">🔒</div>
              <h3>Stateless</h3>
              <p>Your token and chat ID live only in the URL. Nothing is stored.</p>
            </div>
            <div className="feature-card">
              <div className="icon">🧰</div>
              <h3>20+ tools</h3>
              <p>Send, read, and manage messages via the full Telegram Bot API.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="soft" id="builder">
        <div className="container">
          <h2>Get your connector URL</h2>
          <p className="section-sub">Paste your bot token and chat ID - the link updates as you type.</p>
          <div className="builder-card">
            <div className="field">
              <label htmlFor="token">Bot token</label>
              <input
                id="token"
                type="text"
                placeholder="123456789:AAExampleTokenValue-abcDEF"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="chat">Chat ID</label>
              <input
                id="chat"
                type="text"
                placeholder="123456789"
                value={chat}
                onChange={(e) => setChat(e.target.value)}
              />
            </div>

            <div className="output">
              <div className="output-label">Connector URL</div>
              <div className="output-row">
                <code>{url}</code>
                <CopyButton text={url} />
              </div>
            </div>

            <div className="output">
              <div className="output-label">Claude Code command</div>
              <div className="output-row">
                <code>{claudeCodeCmd}</code>
                <CopyButton text={claudeCodeCmd} />
              </div>
            </div>

            <p className="builder-note">
              Keep this URL private - anyone who has it can send messages through your bot. No sign-up or
              account needed; the server is stateless and multi-tenant.
            </p>
          </div>
        </div>
      </section>

      <section>
        <div className="container">
          <h2>Available tools</h2>
          <p className="section-sub">All of it runs remote - every call goes straight to the Telegram Bot API.</p>
          {TOOL_GROUPS.map((group) => (
            <div className="tool-group" key={group.title}>
              <h3>{group.title}</h3>
              <div className="pill-row">
                {group.tools.map((t) => (
                  <span key={t.name} className={`pill pill-${t.kind}`} title={t.kind}>
                    {t.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
          <div className="legend">
            <span>
              <i className="dot dot-read" /> read-only
            </span>
            <span>
              <i className="dot dot-write" /> write
            </span>
            <span>
              <i className="dot dot-destructive" /> destructive
            </span>
          </div>
        </div>
      </section>

      <section className="soft">
        <div className="container">
          <h2>Setup</h2>
          <p className="section-sub">Four steps, five minutes.</p>
          <ol className="setup-steps">
            <li>
              <div>
                <strong>Create a bot</strong>
                <p>
                  Message{" "}
                  <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">
                    @BotFather
                  </a>{" "}
                  on Telegram, send <code>/newbot</code>, and save the API token it gives you.
                </p>
              </div>
            </li>
            <li>
              <div>
                <strong>Get your chat ID</strong>
                <p>
                  Message your bot (or add it to a group/channel), then open{" "}
                  <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> in a browser and read{" "}
                  <code>chat.id</code> from the response.
                </p>
              </div>
            </li>
            <li>
              <div>
                <strong>Build your connector URL</strong>
                <p>Use the form above to generate your personal MCP URL.</p>
              </div>
            </li>
            <li className="setup-step-connect">
              <div>
                <strong>Connect it to Claude</strong>
                <p>Add it as a custom connector in Claude.ai, or via the CLI in Claude Code.</p>

                <div className="connect-variants">
                  <div className="connect-option">
                    <h4>Claude.ai / Claude Desktop</h4>
                    <ol>
                      <li>Settings → Connectors → Add custom connector</li>
                      <li>Name it (e.g. "Telegram")</li>
                      <li>Paste your connector URL</li>
                      <li>Save</li>
                    </ol>
                  </div>
                  <div className="connect-option">
                    <h4>Claude Code (CLI)</h4>
                    <div className="output-row">
                      <pre>{claudeCodeCmd}</pre>
                      <CopyButton text={claudeCodeCmd} />
                    </div>
                  </div>
                </div>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <footer>
        <div className="container">
          MIT License
          <span className="sep">·</span>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub repository
          </a>
          <span className="sep">·</span>
          Built with Next.js on Vercel
          <span className="sep">·</span>
          <a href={`${BASE_URL}/api/mcp`} target="_blank" rel="noreferrer">
            /api/mcp
          </a>
        </div>
      </footer>
    </>
  );
}
