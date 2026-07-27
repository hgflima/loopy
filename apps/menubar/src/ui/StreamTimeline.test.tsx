/**
 * Tests for the timeline dispatcher and the three blocks it introduces
 * (ThoughtBlock, PlanBlock, RawUpdateRow).
 *
 * Covers the acceptance points:
 *  - the thought is born CLOSED and opens on click, with the right paragraph count;
 *  - RawUpdateRow shows the `kind` and hides the JSON behind a closed `<details>`;
 *  - a `StreamItem` with an unknown `item` does NOT break the list (degrades to raw);
 *  - `elided` renders its count;
 *  - the rendered order is the array order.
 *
 * Run: `npm test -w apps/menubar -- StreamTimeline`
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { StreamItem, PlanEntryState } from "loopy/tui/store";
import type { MarkdownStreamProps } from "./MarkdownStream";
import { StreamTimeline } from "./StreamTimeline";
import { ThoughtBlock, countThoughtParagraphs } from "./ThoughtBlock";
import { PlanBlock } from "./PlanBlock";
import { RawUpdateRow } from "./RawUpdateRow";
import * as barrel from "./index";

/**
 * Record the `streaming` prop every MarkdownStream render receives, while
 * delegating to the REAL component (so every other test still renders real
 * markdown — the mock only observes). This is how the O(n²)-regression guard
 * proves the timeline forwards phase liveness to the text/thought MarkdownStream:
 * there is no DOM signal for `streaming` (it toggles an internal reparse split),
 * so the prop itself is what must be asserted.
 */
const streamingSeen: (boolean | undefined)[] = [];
vi.mock("./MarkdownStream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./MarkdownStream")>();
  return {
    ...actual,
    MarkdownStream: (props: MarkdownStreamProps) => {
      streamingSeen.push(props.streaming);
      return actual.MarkdownStream(props);
    },
  };
});

/**
 * Open a `<details>` the way a real browser would. jsdom flips `.open` on a
 * summary click but never dispatches the `toggle` event, so a lazy-mount handler
 * bound to `onToggle` never fires from a click alone — set `open` and dispatch
 * `toggle` explicitly to drive the disclosure open.
 */
function openDetails(el: HTMLDetailsElement): void {
  el.open = true;
  fireEvent(el, new Event("toggle"));
}

describe("countThoughtParagraphs", () => {
  it("counts a single block as one paragraph", () => {
    expect(countThoughtParagraphs("just one block of text")).toBe(1);
  });

  it("counts blocks split by a blank line", () => {
    expect(countThoughtParagraphs("first\n\nsecond\n\nthird")).toBe(3);
  });

  it("collapses blank-line runs of any width", () => {
    expect(countThoughtParagraphs("a\n\n\nb\n \nc")).toBe(3);
  });

  it("drops empty/whitespace-only blocks and trailing blank lines", () => {
    expect(countThoughtParagraphs("a\n\n\n\n")).toBe(1);
    expect(countThoughtParagraphs("")).toBe(0);
  });

  it("treats a non-string thought as empty rather than throwing (D3)", () => {
    // The wire is untrusted; a malformed `thought`/`text` update must degrade,
    // not crash the counter (and, in turn, the timeline).
    expect(() =>
      countThoughtParagraphs(null as unknown as string),
    ).not.toThrow();
    expect(countThoughtParagraphs(null as unknown as string)).toBe(0);
  });
});

describe("ThoughtBlock", () => {
  it("is born CLOSED (D7 — the default, not a preference)", () => {
    const { container } = render(<ThoughtBlock text={"a\n\nb"} />);
    const details = container.querySelector("details") as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
  });

  it("shows the right paragraph count in the summary", () => {
    const { container } = render(<ThoughtBlock text={"one\n\ntwo\n\nthree"} />);
    expect(container.querySelector("summary")?.textContent).toContain(
      "Pensando · 3 parágrafos",
    );
  });

  it("uses the singular noun for exactly one paragraph", () => {
    const { container } = render(<ThoughtBlock text="single block" />);
    const summary = container.querySelector("summary")?.textContent ?? "";
    expect(summary).toContain("Pensando · 1 parágrafo");
    expect(summary).not.toContain("parágrafos");
  });

  it("opens on click, revealing the thought prose", () => {
    const { container } = render(
      <ThoughtBlock text={"the hidden reasoning"} />,
    );
    // Closed: the prose is not mounted yet.
    expect(container.textContent).not.toContain("the hidden reasoning");

    // A click flips `.open` in jsdom; the lazy-mount fires on the toggle event.
    openDetails(container.querySelector("details") as HTMLDetailsElement);
    expect(container.textContent).toContain("the hidden reasoning");
  });

  it("keeps the tool hue on the glyph ONLY (C1)", () => {
    const { container } = render(<ThoughtBlock text="x" />);
    const glyph = container.querySelector<HTMLElement>(".thought-block__glyph");
    expect(glyph?.getAttribute("style")).toContain("--tool-think");
    // The think hue touches nothing but that glyph.
    expect((container.innerHTML.match(/--tool-/g) ?? []).length).toBe(1);
  });

  it("does not crash on a non-string text (degrades to zero paragraphs)", () => {
    const { container } = render(
      <ThoughtBlock text={undefined as unknown as string} />,
    );
    expect(container.querySelector("summary")?.textContent).toContain(
      "Pensando · 0 parágrafos",
    );
  });

  it("is reachable from the ui barrel", () => {
    expect(barrel.ThoughtBlock).toBe(ThoughtBlock);
  });
});

describe("PlanBlock", () => {
  const entries: readonly PlanEntryState[] = [
    { content: "Ler os tipos", priority: "high", status: "completed" },
    { content: "Escrever o teste", priority: "medium", status: "in_progress" },
    { content: "Rodar o build", priority: "low", status: "pending" },
  ];

  it("renders one entry per plan item, in order", () => {
    const { container } = render(<PlanBlock entries={entries} />);
    const rows = [...container.querySelectorAll(".plan-block__entry")];
    expect(rows).toHaveLength(3);
    expect(
      rows.map((r) => r.querySelector(".plan-block__content")?.textContent),
    ).toEqual(["Ler os tipos", "Escrever o teste", "Rodar o build"]);
  });

  it("shows each entry's status via a labelled dot", () => {
    const { container } = render(<PlanBlock entries={entries} />);
    const labels = [...container.querySelectorAll(".status-dot")].map((d) =>
      d.getAttribute("aria-label"),
    );
    expect(labels).toEqual(["Concluído", "Em progresso", "Pendente"]);
  });

  it("shows each entry's priority in pt-BR", () => {
    const { container } = render(<PlanBlock entries={entries} />);
    const prios = [...container.querySelectorAll(".plan-block__priority")].map(
      (p) => p.textContent,
    );
    expect(prios).toEqual(["Alta", "Média", "Baixa"]);
  });

  it("marks a completed entry with a modifier class (strikethrough channel)", () => {
    const { container } = render(<PlanBlock entries={entries} />);
    expect(
      container.querySelector(".plan-block__entry--completed"),
    ).not.toBeNull();
  });

  it("degrades an unknown status to pending without crashing", () => {
    const rogue = [
      { content: "?", priority: "high", status: "bogus" },
    ] as unknown as readonly PlanEntryState[];
    expect(() => render(<PlanBlock entries={rogue} />)).not.toThrow();
  });

  it("degrades a non-array `entries` to an empty plan without crashing (D3)", () => {
    // A malformed `plan` update on the untrusted wire (e.g. `entries: null`)
    // must not take the whole timeline down — a dumb block paints nothing.
    const rogue = null as unknown as readonly PlanEntryState[];
    const { container } = render(<PlanBlock entries={rogue} />);
    expect(container.querySelector(".plan-block")).not.toBeNull();
    expect(container.querySelectorAll(".plan-block__entry")).toHaveLength(0);
  });

  it("is reachable from the ui barrel", () => {
    expect(barrel.PlanBlock).toBe(PlanBlock);
  });
});

describe("RawUpdateRow", () => {
  it("shows the kind WITHOUT opening", () => {
    const { container } = render(
      <RawUpdateRow kind="session_info_update" payload={{ a: 1 }} />,
    );
    expect(container.querySelector(".raw-row__kind")?.textContent).toBe(
      "session_info_update",
    );
  });

  it("is born with the JSON behind a CLOSED <details>", () => {
    const { container } = render(
      <RawUpdateRow kind="config_option_update" payload={{ secret: "X" }} />,
    );
    const details = container.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    // Closed: the JSON is not in the DOM yet (lazy — invisible to a glance).
    expect(container.textContent).not.toContain("secret");
  });

  it("reveals the JSON only once the disclosure is opened", () => {
    const { container } = render(
      <RawUpdateRow kind="user_message_chunk" payload={{ envelope: "PING" }} />,
    );
    expect(container.textContent).not.toContain("PING");
    openDetails(container.querySelector("details") as HTMLDetailsElement);
    expect(container.textContent).toContain("PING");
    expect(container.textContent).toContain("envelope");
  });

  it("does not throw on a payload that cannot be JSON-serialized", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const { container } = render(
      <RawUpdateRow kind="plan_removed" payload={cyclic} />,
    );
    expect(() =>
      openDetails(container.querySelector("details") as HTMLDetailsElement),
    ).not.toThrow();
  });

  it("is reachable from the ui barrel", () => {
    expect(barrel.RawUpdateRow).toBe(RawUpdateRow);
  });
});

describe("StreamTimeline", () => {
  it("dispatches each item type to its component", () => {
    const items: readonly StreamItem[] = [
      { item: "text", text: "hello **world**" },
      { item: "thought", text: "a\n\nb" },
      {
        item: "tool",
        call: {
          toolCallId: "tc-1",
          title: "Ler arquivo",
          kind: "read",
          status: "in_progress",
          locations: [],
          content: [],
        },
      },
      {
        item: "plan",
        entries: [{ content: "Fazer X", priority: "high", status: "pending" }],
      },
      { item: "mode", modeId: "acceptEdits" },
      { item: "raw", kind: "session_info_update", payload: { a: 1 } },
      { item: "elided", count: 12 },
    ];
    const { container } = render(<StreamTimeline items={items} />);

    expect(container.querySelector(".md-stream")).not.toBeNull(); // text
    expect(container.querySelector(".thought-block")).not.toBeNull(); // thought
    expect(container.querySelector(".tool-card")).not.toBeNull(); // tool
    expect(container.querySelector(".plan-block")).not.toBeNull(); // plan
    expect(container.querySelector(".stream-timeline__mode")).not.toBeNull(); // mode
    expect(container.querySelector(".raw-row")).not.toBeNull(); // raw
    expect(container.querySelector(".stream-timeline__elided")).not.toBeNull(); // elided
  });

  it("renders a mode switch as a simple line naming the modeId", () => {
    const { container } = render(
      <StreamTimeline items={[{ item: "mode", modeId: "plan" }]} />,
    );
    const line = container.querySelector(".stream-timeline__mode");
    expect(line?.textContent).toContain("Modo alterado para");
    expect(
      container.querySelector(".stream-timeline__mode-id")?.textContent,
    ).toBe("plan");
  });

  it("renders the elided marker with its count (R6)", () => {
    const { container } = render(
      <StreamTimeline items={[{ item: "elided", count: 137 }]} />,
    );
    expect(
      container.querySelector(".stream-timeline__elided")?.textContent,
    ).toBe("137 itens anteriores omitidos");
  });

  it("uses the singular for a single elided item", () => {
    const { container } = render(
      <StreamTimeline items={[{ item: "elided", count: 1 }]} />,
    );
    expect(
      container.querySelector(".stream-timeline__elided")?.textContent,
    ).toBe("1 item anterior omitido");
  });

  it("degrades an item with an UNKNOWN `item` to raw — never breaks the list", () => {
    const rogue = {
      item: "quantum_flux",
      weird: true,
    } as unknown as StreamItem;
    const items: readonly StreamItem[] = [
      { item: "text", text: "before" },
      rogue,
      { item: "text", text: "after" },
    ];
    const { container } = render(<StreamTimeline items={items} />);

    // The unknown item lands in a raw row tagged by its discriminant...
    const raw = container.querySelector(".raw-row__kind");
    expect(raw?.textContent).toBe("quantum_flux");
    // ...and the items around it still render (the list did not break).
    expect(container.querySelectorAll(".md-stream")).toHaveLength(2);
  });

  it("does not throw when the unknown item has no `item` discriminant", () => {
    const rogue = { call: {} } as unknown as StreamItem;
    expect(() => render(<StreamTimeline items={[rogue]} />)).not.toThrow();
  });

  it("preserves the array order — the timeline is arrival order", () => {
    const items: readonly StreamItem[] = [
      { item: "text", text: "alpha" },
      {
        item: "tool",
        call: {
          toolCallId: "tc-1",
          title: "beta-tool",
          kind: "edit",
          status: "completed",
          locations: [],
          content: [],
        },
      },
      { item: "text", text: "gamma" },
    ];
    const { container } = render(<StreamTimeline items={items} />);
    const timeline = container.querySelector(".stream-timeline") as HTMLElement;

    // Order-preserving proof: the visible markers appear in array order.
    const idxAlpha = timeline.textContent?.indexOf("alpha") ?? -1;
    const idxBeta = timeline.textContent?.indexOf("beta-tool") ?? -1;
    const idxGamma = timeline.textContent?.indexOf("gamma") ?? -1;
    expect(idxAlpha).toBeGreaterThanOrEqual(0);
    expect(idxAlpha).toBeLessThan(idxBeta);
    expect(idxBeta).toBeLessThan(idxGamma);
  });

  it("keeps a disclosure with its item after the ring drops older items", () => {
    // The ring (stream-history) drops the oldest items and prepends an `elided`
    // marker whose `count` is exactly how many vanished. When survivors shift
    // index, a bare array-index key would hand an opened `<details>` to a
    // DIFFERENT surviving item — so an item the user never touched would appear
    // open, violating "born closed". The stable identity derived from
    // `elided.count` must keep each disclosure glued to its own item.
    const state1: readonly StreamItem[] = [
      { item: "elided", count: 1 },
      { item: "raw", kind: "q", payload: { tag: "QQQ" } },
      { item: "raw", kind: "r", payload: { tag: "RRR" } },
    ];
    const { container, rerender } = render(<StreamTimeline items={state1} />);

    // Open the LAST raw row (kind "r", array index 2).
    const rows = [
      ...container.querySelectorAll<HTMLDetailsElement>(".raw-row"),
    ];
    openDetails(rows[rows.length - 1]!);
    expect(container.textContent).toContain("RRR");

    // A further cut drops "q": count 1 → 2, "r" shifts from index 2 to index 1,
    // and a fresh "s" lands at index 2.
    const state2: readonly StreamItem[] = [
      { item: "elided", count: 2 },
      { item: "raw", kind: "r", payload: { tag: "RRR" } },
      { item: "raw", kind: "s", payload: { tag: "SSS" } },
    ];
    rerender(<StreamTimeline items={state2} />);

    // "r" carried its open disclosure across the shift...
    expect(container.textContent).toContain("RRR");
    // ...and the newcomer "s" is born CLOSED (no leaked open state).
    expect(container.textContent).not.toContain("SSS");
  });

  it("renders an empty timeline without crashing", () => {
    const { container } = render(<StreamTimeline items={[]} />);
    expect(container.querySelector(".stream-timeline")?.childElementCount).toBe(
      0,
    );
  });

  it("is reachable from the ui barrel", () => {
    expect(barrel.StreamTimeline).toBe(StreamTimeline);
  });
});

describe("StreamTimeline — streaming forwarding (O(n²) guard)", () => {
  it("forwards `streaming` to a text item's MarkdownStream", () => {
    streamingSeen.length = 0;
    render(
      <StreamTimeline
        streaming
        items={[
          { item: "text", text: "para one\n\ngrowing tail", messageId: "m1" },
        ]}
      />,
    );
    expect(streamingSeen).toContain(true);
  });

  it("defaults a text item to non-streaming when the timeline is idle", () => {
    streamingSeen.length = 0;
    render(<StreamTimeline items={[{ item: "text", text: "static prose" }]} />);
    // Omitting `streaming` must NOT arrive as `true` — an idle timeline reparses
    // once, never in a live loop.
    expect(streamingSeen).not.toContain(true);
  });

  it("forwards `streaming` to an opened thought's MarkdownStream (born closed)", () => {
    streamingSeen.length = 0;
    const { container } = render(
      <StreamTimeline
        streaming
        items={[{ item: "thought", text: "reasoning\n\nmore reasoning" }]}
      />,
    );
    // Born CLOSED (D7): the inner MarkdownStream is not mounted, so nothing is
    // recorded until the disclosure opens.
    expect(streamingSeen).toHaveLength(0);
    openDetails(container.querySelector("details") as HTMLDetailsElement);
    expect(streamingSeen).toContain(true);
  });

  it("keeps forwarding `streaming` as a same-messageId text item grows", () => {
    // The regression: the reducer concatenates same-`messageId` chunks into ONE
    // growing item (stream-history rule c) so MarkdownStream can memoize the
    // completed segments and reparse only the tail. If the timeline drops
    // `streaming`, every chunk reparses the whole markdown — O(n²) on long
    // output. Prove the prop survives the growth and the tail keeps updating.
    streamingSeen.length = 0;
    const first: readonly StreamItem[] = [
      {
        item: "text",
        text: "# Head\n\nfirst para.\n\ntail start",
        messageId: "m1",
      },
    ];
    const { rerender, container } = render(
      <StreamTimeline streaming items={first} />,
    );
    expect(streamingSeen).toContain(true);
    expect(container.textContent).toContain("tail start");

    streamingSeen.length = 0;
    const grown: readonly StreamItem[] = [
      {
        item: "text",
        text: "# Head\n\nfirst para.\n\ntail start and then more",
        messageId: "m1",
      },
    ];
    rerender(<StreamTimeline streaming items={grown} />);
    expect(streamingSeen).toContain(true);
    expect(container.textContent).toContain("tail start and then more");
  });
});
