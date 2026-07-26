/**
 * Tests for ToolCallCard — the dumb, prop-driven tool-call card.
 *
 * Covers the acceptance points: a distinct pill per status; the family hue on
 * the glyph ONLY (C1); content/rawInput/rawOutput born in CLOSED `<details>`;
 * no empty disclosure when there is nothing to disclose; and a diff wired
 * through DiffView.
 *
 * Run: `npm test -w apps/menubar -- ToolCallCard`
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { ToolCallState, ToolCallStatusName } from "loopy/tui/store";
import { ToolCallCard } from "./ToolCallCard";
import * as barrel from "./index";

/**
 * Open a `<details>` the way a click would in a real browser. jsdom flips
 * `.open` on a summary click but does not dispatch the `toggle` event, so the
 * lazy-mount handler never fires from a click alone — set `open` and dispatch
 * `toggle` explicitly to drive the disclosure open.
 */
function openDetails(el: HTMLDetailsElement): void {
  el.open = true;
  fireEvent(el, new Event("toggle"));
}

function makeCall(overrides: Partial<ToolCallState> = {}): ToolCallState {
  return {
    toolCallId: "tc-1",
    title: "Ler arquivo",
    kind: "read",
    status: "pending",
    locations: [],
    content: [],
    ...overrides,
  };
}

const STATUSES: readonly ToolCallStatusName[] = [
  "pending",
  "in_progress",
  "completed",
  "failed",
];

describe("ToolCallCard", () => {
  it("shows a distinct pill for each of the 4 statuses", () => {
    const tones = STATUSES.map((status) => {
      const { container } = render(
        <ToolCallCard call={makeCall({ status })} />,
      );
      const pill = container.querySelector(".status-pill");
      // The tone class (`status-pill--<tone>`) is the visible distinction.
      return [...(pill?.classList ?? [])].find((c) =>
        c.startsWith("status-pill--"),
      );
    });
    expect(new Set(tones).size).toBe(4);
    expect(tones.every(Boolean)).toBe(true);
  });

  it("labels the pill and transitions purely from the status prop (dumb component)", () => {
    const { container, rerender } = render(
      <ToolCallCard call={makeCall({ status: "in_progress" })} />,
    );
    expect(container.querySelector(".status-pill")?.textContent).toContain(
      "Em progresso",
    );
    expect(container.querySelector(".status-pill--running")).not.toBeNull();

    // A fresh state (as a tool_call_update would merge in) flips the pill.
    rerender(<ToolCallCard call={makeCall({ status: "completed" })} />);
    expect(container.querySelector(".status-pill")?.textContent).toContain(
      "Concluído",
    );
    expect(container.querySelector(".status-pill--done")).not.toBeNull();
    expect(container.querySelector(".status-pill--running")).toBeNull();
  });

  it("paints the family hue on the glyph ONLY (C1)", () => {
    const { container } = render(
      <ToolCallCard call={makeCall({ kind: "read" })} />,
    );
    const glyph = container.querySelector<HTMLElement>(".tool-card__glyph");
    // The glyph carries the read family token on its stroke (via currentColor).
    expect(glyph?.getAttribute("style")).toContain("--tool-read");
    // ...and it is the ONLY element in the card touched by a tool hue: no fill,
    // border, or pill is coloured by kind.
    const toolHueHits = container.innerHTML.match(/--tool-/g) ?? [];
    expect(toolHueHits).toHaveLength(1);
  });

  it("names the glyph with the family label for a11y", () => {
    const { container } = render(
      <ToolCallCard call={makeCall({ kind: "delete" })} />,
    );
    const glyph = container.querySelector(".tool-card__glyph");
    expect(glyph?.getAttribute("role")).toBe("img");
    expect(glyph?.getAttribute("aria-label")).toBe("Destrutivo");
  });

  it("renders locations when present", () => {
    const { container } = render(
      <ToolCallCard
        call={makeCall({ locations: [{ path: "src/a.ts", line: 12 }] })}
      />,
    );
    const loc = container.querySelector(".tool-card__location");
    expect(loc?.textContent).toBe("src/a.ts:12");
  });

  it("omits the line suffix when a location has no line", () => {
    const { container } = render(
      <ToolCallCard call={makeCall({ locations: [{ path: "src/a.ts" }] })} />,
    );
    expect(container.querySelector(".tool-card__location")?.textContent).toBe(
      "src/a.ts",
    );
  });

  it("is born with content/rawInput/rawOutput in CLOSED <details>", () => {
    const { container } = render(
      <ToolCallCard
        call={makeCall({
          content: [{ kind: "text", text: "hello" }],
          rawInput: { path: "a.ts" },
          rawOutput: "ok",
        })}
      />,
    );
    const details = [...container.querySelectorAll("details")];
    expect(details).toHaveLength(3);
    // Every disclosure is CLOSED — a giant payload never paints until asked.
    expect(details.every((d) => (d as HTMLDetailsElement).open === false)).toBe(
      true,
    );
  });

  it("mounts disclosure content LAZILY — nothing built until the details opens", () => {
    // C3 (render side): a closed disclosure must not just be unpainted, it must
    // not build its payload at all — no formatPayload / computeDiffHunks run
    // until the user asks. Proxy the "not built" via the payload's absence.
    const { container } = render(
      <ToolCallCard
        call={makeCall({ content: [{ kind: "text", text: "PAYLOAD_HELLO" }] })}
      />,
    );
    // Closed: the summary exists, but the payload is not in the DOM.
    expect(container.querySelector("summary")).not.toBeNull();
    expect(container.textContent).not.toContain("PAYLOAD_HELLO");

    // Opening the disclosure mounts the content.
    openDetails(container.querySelector("details") as HTMLDetailsElement);
    expect(container.textContent).toContain("PAYLOAD_HELLO");
  });

  it("renders NO empty disclosure when there is nothing to disclose", () => {
    const { container } = render(<ToolCallCard call={makeCall()} />);
    expect(container.querySelectorAll("details")).toHaveLength(0);
  });

  it("renders only the disclosures that have content", () => {
    const { container } = render(
      <ToolCallCard call={makeCall({ rawOutput: "done" })} />,
    );
    // content [] and rawInput undefined → only the rawOutput disclosure.
    expect(container.querySelectorAll("details")).toHaveLength(1);
    expect(container.querySelector("summary")?.textContent).toBe("Saída");
  });

  it("wires a diff content item through DiffView once the disclosure is opened", () => {
    const { container } = render(
      <ToolCallCard
        call={makeCall({
          content: [
            { kind: "diff", path: "a.ts", oldText: "x\n", newText: "y\n" },
          ],
        })}
      />,
    );
    // Lazy: the diff (and its computeDiffHunks) is not built while closed.
    expect(container.querySelector(".tool-card__diff-path")).toBeNull();

    openDetails(container.querySelector("details") as HTMLDetailsElement);
    // computeDiffHunks(x → y) yields a real edit; DiffView paints its lines.
    expect(container.querySelector(".tool-card__diff-path")?.textContent).toBe(
      "a.ts",
    );
    expect(container.querySelectorAll(".diff-line").length).toBeGreaterThan(0);
  });

  it("does not throw on an unknown tool kind (degrades to other)", () => {
    expect(() =>
      render(
        <ToolCallCard
          call={makeCall({ kind: "banana" as ToolCallState["kind"] })}
        />,
      ),
    ).not.toThrow();
  });

  it("is reachable from the ui barrel", () => {
    // A `memo` component is an exotic object, not a plain function — assert the
    // barrel re-exports the same reference.
    expect(barrel.ToolCallCard).toBe(ToolCallCard);
  });
});
