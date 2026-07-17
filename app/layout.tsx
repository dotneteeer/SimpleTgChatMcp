import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SimpleTgChat MCP - Telegram for Claude",
  description:
    "A simple, remote MCP server that lets Claude send and manage messages in a single Telegram chat.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
