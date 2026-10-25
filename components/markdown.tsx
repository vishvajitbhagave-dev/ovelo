"use client";

import { Fragment, type ReactNode } from "react";
import { convertLatexArrows } from "@/lib/latex-arrows";

/**
 * A tiny, SAFE markdown renderer for agent replies.
 *
 * It is written by hand (no new dependency) and it never emits raw HTML:
 * every string is rendered as a React text node, so angle brackets and
 * anything else a model writes are escaped automatically. It only supports
 * the handful of things the agent actually uses: bold, inline code, links,
 * bullet and numbered lists, and line breaks.
 */

const INLINE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s]+)/g;

/** Short middle form, e.g. 0x1234567890…abcdef. */
function shortMiddle(value: string, head = 10, tail = 8): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function isUrlLike(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^0x[0-9a-fA-F]{8,}$/.test(value) || value.length > 42;
}

/** Turn a link into a short, readable label. Basescan links become "tx 0x…". */
function linkLabel(href: string, label: string): string {
  try {
    const url = new URL(href);
    if (url.hostname.endsWith("basescan.org")) {
      const tx = url.pathname.match(/\/tx\/(0x[0-9a-fA-F]+)/);
      if (tx) return `tx ${shortMiddle(tx[1])}`;
      const address = url.pathname.match(/\/address\/(0x[0-9a-fA-F]+)/);
      if (address) return `address ${shortMiddle(address[1])}`;
      return "View on Basescan";
    }
  } catch {
    // Not a full URL; fall through to the plain label.
  }
  return isUrlLike(label) ? shortMiddle(label) : label;
}

function renderLink(href: string, label: string, key: number): ReactNode {
  const safeLabel = linkLabel(href, label);
  return (
    <a
      key={key}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={href}
      className="text-primary font-medium underline underline-offset-2 break-words hover:no-underline"
    >
      {safeLabel}
    </a>
  );
}

/** Parse the inline bits of one line into React nodes (never raw HTML). */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  INLINE.lastIndex = 0;

  while ((match = INLINE.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];

    if (token.startsWith("`")) {
      out.push(
        <code
          key={out.length}
          className="rounded bg-background/70 px-1 py-0.5 font-mono text-[0.85em] break-all"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**")) {
      out.push(
        <strong key={out.length} className="font-semibold">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("[")) {
      const md = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      out.push(md ? renderLink(md[2], md[1], out.length) : token);
    } else {
      // A bare URL: trim trailing punctuation so "https://x.com." stays a link.
      let href = token;
      let trailing = "";
      while (/[.,;:!?)\]}]+$/.test(href)) {
        trailing = href.slice(-1) + trailing;
        href = href.slice(0, -1);
      }
      out.push(renderLink(href, href, out.length));
      if (trailing) out.push(trailing);
    }

    last = match.index + token.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = convertLatexArrows(text).replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushList = () => {
    if (!list) return;
    const { ordered, items } = list;
    list = null;
    const rendered = items.map((item, i) => <li key={i}>{inline(item)}</li>);
    blocks.push(
      ordered ? (
        <ol key={blocks.length} className="ml-4 list-decimal space-y-1">
          {rendered}
        </ol>
      ) : (
        <ul key={blocks.length} className="ml-4 list-disc space-y-1">
          {rendered}
        </ul>
      )
    );
  };

  lines.forEach((raw) => {
    const line = raw.replace(/\s+$/, "");
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);

    if (bullet) {
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
    } else if (numbered) {
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1]);
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      blocks.push(
        <p key={blocks.length} className="whitespace-pre-wrap">
          {inline(line)}
        </p>
      );
    }
  });
  flushList();

  return (
    <div className="flex flex-col gap-1.5 [overflow-wrap:anywhere]">
      {blocks.map((block, i) => (
        <Fragment key={i}>{block}</Fragment>
      ))}
    </div>
  );
}
