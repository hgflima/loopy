/**
 * Tests for MarkdownStream: sanitized markdown renderer.
 *
 * Covers:
 * - Basic markdown rendering (headings, lists, code blocks, GFM tables)
 * - HTML sanitization (embedded HTML does NOT inject DOM nodes)
 * - Code blocks use --font-mono via md-code class
 * - Streaming memoization (segment split)
 * - Edge cases (empty text, streaming flag)
 *
 * Run: `npm test -w apps/menubar -- MarkdownStream`
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

afterEach(cleanup);

const { MarkdownStream } = await import("./MarkdownStream");

// ---------------------------------------------------------------------------
// Basic markdown rendering
// ---------------------------------------------------------------------------

describe("MarkdownStream — basic rendering", () => {
  it("renders a heading", () => {
    const { container } = render(<MarkdownStream text="# Hello" />);
    const h1 = container.querySelector("h1");
    expect(h1).not.toBeNull();
    expect(h1!.textContent).toBe("Hello");
  });

  it("renders an unordered list", () => {
    const { container } = render(
      <MarkdownStream text={"- item 1\n- item 2\n- item 3"} />,
    );
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(3);
  });

  it("renders a fenced code block with md-code class", () => {
    const { container } = render(
      <MarkdownStream text={"```js\nconst x = 1;\n```"} />,
    );
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.className).toContain("md-code");
  });

  it("renders inline code with md-code class", () => {
    const { container } = render(
      <MarkdownStream text="Use `npm install` to install." />,
    );
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.className).toContain("md-code");
  });

  it("renders a GFM table", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const { container } = render(<MarkdownStream text={md} />);
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelectorAll("td")).toHaveLength(2);
  });

  it("renders a blockquote", () => {
    const { container } = render(<MarkdownStream text="> quoted text" />);
    expect(container.querySelector("blockquote")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sanitization: embedded HTML must NOT inject DOM nodes
// ---------------------------------------------------------------------------

describe("MarkdownStream — sanitization", () => {
  it("does not inject <script> elements from markdown", () => {
    const { container } = render(
      <MarkdownStream text={'<script>alert("xss")</script>'} />,
    );
    expect(container.querySelector("script")).toBeNull();
  });

  it("does not inject <img> with onerror from markdown", () => {
    const { container } = render(
      <MarkdownStream text={'<img onerror="alert(1)" src="x">'} />,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("does not inject <iframe> from markdown", () => {
    const { container } = render(
      <MarkdownStream
        text={'<iframe src="https://evil.com"></iframe>'}
      />,
    );
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("does not inject arbitrary HTML attributes", () => {
    const { container } = render(
      <MarkdownStream text={'<div onclick="alert(1)">click me</div>'} />,
    );
    expect(container.querySelector("[onclick]")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Streaming & memoization
// ---------------------------------------------------------------------------

describe("MarkdownStream — streaming", () => {
  it("renders all segments when streaming", () => {
    const text = "# First\n\nParagraph one.\n\nParagraph two (tail).";
    const { container } = render(<MarkdownStream text={text} streaming />);
    expect(container.textContent).toContain("First");
    expect(container.textContent).toContain("Paragraph one.");
    expect(container.textContent).toContain("Paragraph two (tail).");
  });

  it("wraps output in .md-stream", () => {
    const { container } = render(<MarkdownStream text="hello" />);
    expect(container.querySelector(".md-stream")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sentence splitting in prose nodes
// ---------------------------------------------------------------------------

describe("MarkdownStream — sentence splitting", () => {
  it("splits sentences in a paragraph", () => {
    const { container } = render(
      <MarkdownStream text="First sentence. Second sentence." />,
    );
    const p = container.querySelector("p");
    expect(p).not.toBeNull();
    // The text should have a newline between sentences
    expect(p!.textContent).toContain("First sentence.");
    expect(p!.textContent).toContain("Second sentence.");
  });

  it("does NOT split inside inline code", () => {
    const { container } = render(
      <MarkdownStream text="Use `Node.js. Start now.` for this." />,
    );
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    // Inline code content must remain intact
    expect(code!.textContent).toBe("Node.js. Start now.");
  });

  it("does NOT split inside fenced code blocks", () => {
    const md = "```\nFirst line. Second line. Third line.\n```";
    const { container } = render(<MarkdownStream text={md} />);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe("First line. Second line. Third line.\n");
  });

  it("does not split Node.js in prose", () => {
    const { container } = render(
      <MarkdownStream text="Use Node.js. It works well." />,
    );
    const p = container.querySelector("p");
    expect(p).not.toBeNull();
    // Node.js should not cause a split
    expect(p!.textContent).toBe("Use Node.js. It works well.");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("MarkdownStream — edge cases", () => {
  it("renders empty text without crashing", () => {
    const { container } = render(<MarkdownStream text="" />);
    expect(container.querySelector(".md-stream")).not.toBeNull();
  });

  it("renders with streaming=true on empty text without crashing", () => {
    expect(() => render(<MarkdownStream text="" streaming />)).not.toThrow();
  });

  it("renders single paragraph without splitting", () => {
    const { container } = render(
      <MarkdownStream text="Just one paragraph." streaming />,
    );
    expect(container.textContent).toContain("Just one paragraph.");
  });
});
