/**
 * MarkdownStream — renders markdown text with sanitized HTML.
 *
 * Safe by default: react-markdown does not use dangerouslySetInnerHTML,
 * and without rehype-raw, embedded HTML becomes text (not DOM nodes).
 * Code blocks use --font-mono from the design system tokens.
 *
 * Streaming perf: completed segments (split on \n\n) are memoized via
 * React.memo; only the tail in growth re-parses. The tail is re-highlighted on
 * every chunk by design — rehype-highlight is synchronous, so no
 * MarkdownHooks/debounce is needed, and a block still streaming (its fence not
 * yet closed) highlights as it grows just like a closed one. (The per-chunk
 * markdown re-parse of the tail predates this file and is out of scope here.)
 */
import type { HTMLAttributes, ReactNode } from "react";
import { Fragment, memo, useMemo } from "react";
import _Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { splitSentences } from "./sentence-split";
import "./MarkdownStream.css";

// react-markdown v10 types target React 19; this project uses React 18.
// Runtime behavior is correct — only the type declarations conflict.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Markdown = _Markdown as any as React.FC<{
  readonly children: string;
  readonly remarkPlugins?: readonly unknown[];
  readonly rehypePlugins?: readonly unknown[];
  readonly components?: Record<string, unknown>;
}>;

export interface MarkdownStreamProps {
  /** The full accumulated markdown text. */
  readonly text: string;
  /** Whether the stream is still receiving data (enables segment memoization). */
  readonly streaming?: boolean;
}

const remarkPlugins = [remarkGfm];

// rehype-highlight is synchronous, so it re-highlights on every streamed chunk
// without MarkdownHooks/debounce. Defaults are deliberate: the `common` language
// set (no curation — R7e) and `detect: false`, so only language-tagged blocks
// are highlighted and inline / un-languaged code stays inert. Theme lives in
// MarkdownStream.css (hljs-* mapped to the dedicated --syntax-* tokens), never a
// highlight.js stylesheet. No rehype-raw — embedded HTML stays text (XSS barrier).
const rehypePlugins = [rehypeHighlight];

/**
 * Split one prose string and render each sentence boundary as a real <br>.
 *
 * splitSentences marks boundaries with `\n`, but a `\n` inside a <p>/<li>
 * collapses to a space under `white-space: normal` — so it must become a
 * <br> to be visible (#7). Returns the raw string when there is no boundary,
 * keeping textContent byte-identical for the no-split case.
 */
function proseToNodes(text: string, keyPrefix: string): ReactNode {
  const lines = splitSentences(text).split("\n");
  if (lines.length === 1) return lines[0];
  return lines.map((line, i) => (
    <Fragment key={`${keyPrefix}-${i}`}>
      {i > 0 ? <br /> : null}
      {line}
    </Fragment>
  ));
}

/**
 * Apply sentence splitting to plain-text children only; non-string children
 * (e.g. inline code, links) pass through unchanged.
 */
function splitProseChildren(children: ReactNode): ReactNode {
  if (typeof children === "string") return proseToNodes(children, "s");
  if (!Array.isArray(children)) return children;
  return children.map((child, i) =>
    typeof child === "string" ? proseToNodes(child, `s${i}`) : child,
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

const markdownProps = {
  remarkPlugins,
  rehypePlugins,
  components: mdComponents,
} as const;

function splitStreamingSegments(text: string): {
  readonly completed: string[];
  readonly tail: string;
} {
  const parts = text.split("\n\n");
  const tail = parts.pop() ?? "";
  return parts.length === 0 ? { completed: [], tail } : { completed: parts, tail };
}

/** A single markdown segment, memoized to avoid re-parsing completed blocks. */
const MemoSegment = memo(function MemoSegment({
  text,
}: {
  readonly text: string;
}) {
  return <Markdown {...markdownProps}>{text}</Markdown>;
});

export function MarkdownStream({
  text,
  streaming = false,
}: MarkdownStreamProps) {
  const { completed, tail } = useMemo(() => {
    if (!streaming || !text) return { completed: [] as string[], tail: text };
    return splitStreamingSegments(text);
  }, [text, streaming]);
  return (
    <div className="md-stream">
      {completed.map((seg, i) => (
        <MemoSegment key={i} text={seg} />
      ))}
      {tail ? <Markdown {...markdownProps}>{tail}</Markdown> : null}
    </div>
  );
}
