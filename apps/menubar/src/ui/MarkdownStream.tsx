/**
 * MarkdownStream — renders markdown text with sanitized HTML.
 *
 * Safe by default: react-markdown does not use dangerouslySetInnerHTML,
 * and without rehype-raw, embedded HTML becomes text (not DOM nodes).
 * Code blocks use --font-mono from the design system tokens.
 *
 * Streaming perf: completed segments (split on \n\n) are memoized via
 * React.memo; only the tail in growth re-parses (avoids O(n²) live).
 */
import type { HTMLAttributes, ReactNode } from "react";
import { memo, useMemo } from "react";
import _Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { splitSentences } from "./sentence-split";
import "./MarkdownStream.css";

// react-markdown v10 types target React 19; this project uses React 18.
// Runtime behavior is correct — only the type declarations conflict.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Markdown = _Markdown as any as React.FC<{
  readonly children: string;
  readonly remarkPlugins?: readonly unknown[];
  readonly components?: Record<string, unknown>;
}>;

export interface MarkdownStreamProps {
  /** The full accumulated markdown text. */
  readonly text: string;
  /** Whether the stream is still receiving data (enables segment memoization). */
  readonly streaming?: boolean;
}

const remarkPlugins = [remarkGfm];

/**
 * Apply splitSentences to plain-text children only; non-string children
 * (e.g. inline code, links) pass through unchanged.
 */
function splitProseChildren(children: ReactNode): ReactNode {
  if (typeof children === "string") return splitSentences(children);
  if (!Array.isArray(children)) return children;
  return children.map((child) =>
    typeof child === "string" ? splitSentences(child) : child,
  );
}

/** Custom components — code blocks get the md-code class for --font-mono. */
const mdComponents = {
  code({
    className,
    children,
    ...props
  }: HTMLAttributes<HTMLElement>) {
    return (
      <code
        className={`md-code${className ? ` ${className}` : ""}`}
        {...props}
      >
        {children}
      </code>
    );
  },
  p({ children, ...props }: HTMLAttributes<HTMLParagraphElement>) {
    return <p {...props}>{splitProseChildren(children)}</p>;
  },
  li({ children, ...props }: HTMLAttributes<HTMLLIElement>) {
    return <li {...props}>{splitProseChildren(children)}</li>;
  },
};

/** A single markdown segment, memoized to avoid re-parsing completed blocks. */
const MemoSegment = memo(function MemoSegment({
  text,
}: {
  readonly text: string;
}) {
  return (
    <Markdown remarkPlugins={remarkPlugins} components={mdComponents}>
      {text}
    </Markdown>
  );
});

export function MarkdownStream({
  text,
  streaming = false,
}: MarkdownStreamProps) {
  const { completed, tail } = useMemo(() => {
    if (streaming && text) {
      const parts = text.split("\n\n");
      if (parts.length > 1) {
        return { completed: parts.slice(0, -1), tail: parts.at(-1) ?? "" };
      }
    }
    return { completed: [] as string[], tail: text };
  }, [text, streaming]);

  return (
    <div className="md-stream">
      {completed.map((seg, i) => (
        <MemoSegment key={i} text={seg} />
      ))}
      {tail ? (
        <Markdown remarkPlugins={remarkPlugins} components={mdComponents}>
          {tail}
        </Markdown>
      ) : null}
    </div>
  );
}
