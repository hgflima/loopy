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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

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
// Syntax highlighting (rehype-highlight over the OKLCH tokens)
// ---------------------------------------------------------------------------

describe("MarkdownStream — code highlighting", () => {
  it("emits hljs-* token classes for a languaged fenced block", () => {
    const { container } = render(
      <MarkdownStream text={"```ts\nconst x: number = 1;\n```"} />,
    );
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    // rehype-highlight marks the block itself with `hljs`...
    expect(code!.className).toContain("hljs");
    // ...and wraps at least one token in a `hljs-*` span.
    expect(container.querySelector('[class*="hljs-"]')).not.toBeNull();
  });

  it("keeps the md-code class alongside the highlight classes", () => {
    const { container } = render(
      <MarkdownStream text={"```ts\nconst x = 1;\n```"} />,
    );
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.className).toContain("md-code");
  });

  it("does not highlight prose — no hljs artifacts leak into plain text", () => {
    // "Byte-identical to today" proxy: prose (no code block) must gain no
    // hljs class or token span from the plugin.
    const { container } = render(
      <MarkdownStream text="Just some prose about the keyword const and a return value." />,
    );
    expect(container.querySelector(".hljs")).toBeNull();
    expect(container.querySelector('[class*="hljs-"]')).toBeNull();
  });

  it("does not highlight an un-languaged fenced block (detect stays off)", () => {
    // Default detect:false — a plain ``` block is left as inert text so its
    // content stays byte-identical (matches the sentence-split test below).
    const { container } = render(
      <MarkdownStream text={"```\nconst x = 1;\n```"} />,
    );
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.className).not.toContain("hljs");
    expect(code!.textContent).toBe("const x = 1;\n");
  });

  it("still renders embedded HTML as text (rehype-raw absent, XSS barrier)", () => {
    const { container } = render(
      <MarkdownStream text={"```html\n<b>bold</b>\n```"} />,
    );
    // The HTML inside the code block is highlighted markup, never live DOM.
    expect(container.querySelector("code b")).toBeNull();
    expect(container.textContent).toContain("<b>bold</b>");
  });

  it("highlights a closed languaged block in the streaming tail", () => {
    // rehype-highlight is synchronous by design (task R7e / plan): the tail is
    // re-highlighted every chunk, so a closed block is highlighted under the
    // streaming path too, not only on the final render.
    const { container } = render(
      <MarkdownStream
        text={"```ts\nconst a = 1;\nconst b = 2;\n```"}
        streaming
      />,
    );
    expect(container.querySelector("code.hljs")).not.toBeNull();
    expect(container.querySelector('[class*="hljs-"]')).not.toBeNull();
  });

  it("highlights a closed languaged block when not streaming", () => {
    const { container } = render(
      <MarkdownStream text={"```ts\nconst x: number = 1;\n```"} />,
    );
    expect(container.querySelector("code.hljs")).not.toBeNull();
  });

  it("re-highlights a fence still open in the streaming tail, every chunk", () => {
    // rehype-highlight is synchronous (task R7e / plan), so the tail is
    // re-highlighted on every chunk with no MarkdownHooks/debounce. An unclosed
    // ```ts fence is parsed as a code-block-until-EOF that still carries its
    // language, so it highlights as it grows — not only once its closing ```
    // arrives (matching the final render throughout).
    const grow = (src: string) =>
      render(<MarkdownStream text={src} streaming />);

    // Chunk 1: fence just opened — already highlighted.
    const { container, rerender } = grow("```ts\nconst a = 1;");
    expect(container.querySelector("code.hljs")).not.toBeNull();
    expect(container.querySelector('[class*="hljs-"]')).not.toBeNull();

    // Chunk 2: still open (no closing ```), still highlighted as it grows.
    act(() => {
      rerender(
        <MarkdownStream text={"```ts\nconst a = 1;\nconst b = 2;"} streaming />,
      );
    });
    expect(container.querySelector("code.hljs")).not.toBeNull();

    // Chunk 3: closing fence arrives — still highlighted.
    act(() => {
      rerender(
        <MarkdownStream
          text={"```ts\nconst a = 1;\nconst b = 2;\n```"}
          streaming
        />,
      );
    });
    expect(container.querySelector("code.hljs")).not.toBeNull();
    expect(container.querySelector('[class*="hljs-"]')).not.toBeNull();
  });

  it("highlights the acceptance's ```ts block under the streaming path, open or closed", () => {
    // The acceptance ("a ```ts block emits hljs-* classes in the DOM") holds on
    // the streaming path from the first chunk: because rehype-highlight is
    // synchronous, even an unclosed ```ts fence — parsed as a languaged
    // code-block-until-EOF — carries hljs-* classes, and keeps them once the
    // closing ``` lands. This pins the exact partial payload.
    const open = "```ts\nconst x = 1;";
    const { container, rerender } = render(
      <MarkdownStream text={open} streaming />,
    );
    // Open fence: already carries hljs-* classes.
    expect(container.querySelector("code.hljs")).not.toBeNull();
    expect(container.querySelector('[class*="hljs-"]')).not.toBeNull();

    // Closing fence arrives — the ```ts block keeps its hljs-* classes.
    act(() => {
      rerender(<MarkdownStream text={`${open}\n\`\`\``} streaming />);
    });
    expect(container.querySelector("code.hljs")).not.toBeNull();
    expect(container.querySelector('[class*="hljs-"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Syntax theme: dedicated --syntax-* tokens, never the restricted vocabularies
// ---------------------------------------------------------------------------

describe("MarkdownStream — syntax theme tokens", () => {
  const css = readFileSync(join(import.meta.dirname, "MarkdownStream.css"), "utf8");

  it("maps hljs-* onto a dedicated --syntax-* vocabulary", () => {
    expect(css).toContain("--syntax-");
    // A representative selector must resolve to a --syntax-* token.
    expect(css).toMatch(/\.hljs-string[\s\S]*?var\(--syntax-string\)/);
  });

  it("never borrows the --state-* or --tool-* vocabularies for syntax color", () => {
    // DESIGN.md §2 / tokens.css restrict --state-* to task status and --tool-*
    // to tool-icon strokes. Painting a string with --state-done-ink would read
    // as "done". The renderer's stylesheet must not touch either.
    expect(css).not.toMatch(/var\(--state-/);
    expect(css).not.toMatch(/var\(--tool-/);
  });
});

// ---------------------------------------------------------------------------
// Syntax token contrast — Success Criterion 3: legible and AA in both themes.
// The spec delegates the visual sign-off to T-016 (DESIGN.md), but the token
// values are set here, so a value that is measurably below 4.5:1 is a defect
// this task ships. This guard converts the OKLCH tokens to WCAG contrast and
// fails if any foreground syntax color falls under AA on its own background.
// ---------------------------------------------------------------------------

describe("MarkdownStream — syntax token AA contrast", () => {
  const tokens = readFileSync(join(import.meta.dirname, "tokens.css"), "utf8");
  const darkAt = tokens.indexOf("@media (prefers-color-scheme: dark)");
  const themes = {
    light: tokens.slice(0, darkAt),
    dark: tokens.slice(darkAt),
  } as const;

  /** Read an `oklch(L C H)` custom property as a [L, C, H] tuple. */
  function readOklch(src: string, name: string): [number, number, number] {
    const m = new RegExp(`--${name}:\\s*oklch\\(([^)]+)\\)`).exec(src);
    if (!m) throw new Error(`token --${name} not found`);
    const [L, C, H] = m[1].trim().split(/\s+/).map(Number);
    return [L, C, H];
  }

  // OKLCH -> linear sRGB -> WCAG relative luminance -> contrast ratio.
  function luminance([L, C, hDeg]: [number, number, number]): number {
    const h = (hDeg * Math.PI) / 180;
    const a = C * Math.cos(h);
    const b = C * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const clamp = (x: number) => Math.min(Math.max(x, 0), 1);
    const r = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
    const g = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
    const bl = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  }
  function contrast(
    fg: [number, number, number],
    bg: [number, number, number],
  ): number {
    const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  // Plain foreground tokens sit on the code surface (--surface); the diff inks
  // sit on their own tinted backgrounds.
  const onSurface = [
    "comment",
    "keyword",
    "string",
    "number",
    "function",
    "type",
    "variable",
    "tag",
    "meta",
    "link",
  ];

  for (const [theme, src] of Object.entries(themes)) {
    it(`foreground syntax tokens clear 4.5:1 AA on --surface (${theme})`, () => {
      const surface = readOklch(src, "surface");
      for (const name of onSurface) {
        const ratio = contrast(readOklch(src, `syntax-${name}`), surface);
        expect(
          ratio,
          `--syntax-${name} (${theme}) = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`diff add/del ink clears 4.5:1 AA on its tint (${theme})`, () => {
      for (const kind of ["addition", "deletion"]) {
        const ratio = contrast(
          readOklch(src, `syntax-${kind}-ink`),
          readOklch(src, `syntax-${kind}-bg`),
        );
        expect(
          ratio,
          `--syntax-${kind}-ink (${theme}) = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
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

  it("renders the sentence boundary as a real <br>, not a bare newline", () => {
    // Regression: a bare `\n` collapses under `white-space: normal`, so the
    // sentences would render on one line. The boundary must be a <br> (#7).
    const { container } = render(
      <MarkdownStream text="First sentence. Second sentence. Third one." />,
    );
    const p = container.querySelector("p");
    expect(p).not.toBeNull();
    expect(p!.querySelectorAll("br")).toHaveLength(2);
  });

  it("breaks a period glued to an uppercase word (dropped space)", () => {
    // Streaming artifact: `implementado.Vou` has no space but is a boundary (#7).
    const { container } = render(
      <MarkdownStream text="Li os arquivos.Vou criar os stubs.Agora rodo os checks." />,
    );
    const p = container.querySelector("p");
    expect(p).not.toBeNull();
    expect(p!.querySelectorAll("br")).toHaveLength(2);
  });

  it("emits no <br> when there is no sentence boundary", () => {
    const { container } = render(
      <MarkdownStream text="Just one sentence with no split." />,
    );
    const p = container.querySelector("p");
    expect(p).not.toBeNull();
    expect(p!.querySelectorAll("br")).toHaveLength(0);
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
