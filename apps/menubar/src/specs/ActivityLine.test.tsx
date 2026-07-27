/**
 * Tests for ActivityLine: proof of life while the agent works (D14).
 *
 * A pulsing header plus the running Phase's **timeline** (T-014): the same
 * `StreamTimeline` the Run mounts, fed the Interview's `transcript`
 * (`readonly StreamItem[]`). The spike measured 328 s to the first question, so
 * the header proves the run is alive while tool cards stream below it; the
 * turn's prose still arrives once, at end of turn, as a `text` item (R1).
 *
 * Run: `npm test -w apps/menubar -- specs`
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { StreamItem, StreamUpdate } from "loopy/tui/store";
import { advance, initialInterviewState } from "./interview-state";

afterEach(cleanup);

const { ActivityLine, headerLabel } = await import("./ActivityLine");

/** A tool item as the Interview's `agent_stream` produces it. */
function toolItem(id: string, title: string): StreamItem {
  return {
    item: "tool",
    call: {
      toolCallId: id,
      title,
      kind: "read",
      status: "in_progress",
      locations: [],
      content: [],
    },
  };
}

/**
 * Open a `<details>` the way a real browser would: jsdom flips `.open` on a
 * click but never dispatches the `toggle` event, so the lazy-mount body bound to
 * `onToggle` (RawUpdateRow) never renders from a click alone.
 */
function openDetails(el: HTMLDetailsElement): void {
  el.open = true;
  fireEvent(el, new Event("toggle"));
}

// ---------------------------------------------------------------------------

describe("ActivityLine", () => {
  it("renders the live activity line when there is no transcript yet", () => {
    const { getByText } = render(
      <ActivityLine line="Explorando src/telemetry…" busy />,
    );
    expect(getByText("Explorando src/telemetry…")).not.toBeNull();
  });

  it("renders a text item as markdown, visible without any disclosure", () => {
    const { container, getByText } = render(
      <ActivityLine
        line="Li os arquivos."
        transcript={[{ item: "text", text: "# Passos\n\nLi os arquivos." }]}
        busy
      />,
    );
    // The prose is on screen, not behind a toggle.
    expect(container.querySelector(".spec-activity__narration")).not.toBeNull();
    // The shared StreamTimeline mounted, with MarkdownStream inside it — the
    // heading is a real <h1>, reachable now.
    expect(container.querySelector(".stream-timeline")).not.toBeNull();
    expect(container.querySelector(".md-stream")).not.toBeNull();
    expect(getByText("Passos")).not.toBeNull();
  });

  it("renders a live tool card streamed by agent_stream", () => {
    const { container, getByText } = render(
      <ActivityLine
        line="Lendo…"
        transcript={[toolItem("t1", "Lendo src/auth.ts")]}
        busy
      />,
    );
    // The same tool card the Run mounts, inside the narration box.
    expect(container.querySelector(".tool-card")).not.toBeNull();
    expect(getByText("Lendo src/auth.ts")).not.toBeNull();
  });

  it("keeps prose after the tool items that streamed before it (R1)", () => {
    const { container } = render(
      <ActivityLine
        line="Li tudo."
        transcript={[
          toolItem("t1", "Lendo"),
          { item: "text", text: "Li tudo, agora escrevo a spec." },
        ]}
        busy
      />,
    );
    const timeline = container.querySelector(".stream-timeline")!;
    // Tool card first, prose after — the order of arrival.
    const tool = timeline.querySelector(".tool-card")!;
    const prose = timeline.querySelector(".md-stream")!;
    expect(
      tool.compareDocumentPosition(prose) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("never renders a <loopy-…> envelope block (R1 — the barrier holds upstream)", () => {
    // The Interview's timeline only ever carries stripped prose + tool cards:
    // `agent_message_chunk` is filtered in the engine (T-013), so the raw
    // `<loopy-ask>{json}` the agent typed never reaches this component.
    const { container } = render(
      <ActivityLine
        line="Escolha o objetivo."
        transcript={[
          toolItem("t1", "Lendo"),
          { item: "text", text: "Vamos definir o objetivo desta feature." },
        ]}
        busy
      />,
    );
    expect(container.textContent).not.toContain("loopy-");
  });

  it("nunca revela um bloco <loopy-…>, nem com o disclosure do raw aberto (o reducer filtra o Envelope ecoado)", () => {
    // O motor ecoa o NOSSO Envelope de volta como um raw `user_message_chunk`
    // (a barreira T-013 só cobre `agent_message_chunk`). O reducer o descarta
    // antes da timeline; um raw legítimo continua passando. Dirigindo o fluxo
    // REAL e abrindo TODO disclosure, o payload legítimo aparece — mas nenhum
    // bloco <loopy-…> vaza, em estado nenhum (a Acceptance da T-014).
    const envelope: StreamUpdate = {
      kind: "raw",
      updateKind: "user_message_chunk",
      payload: {
        sessionUpdate: "user_message_chunk",
        content: {
          type: "text",
          text: "no bloco <loopy-ask>{…}</loopy-ask>; encerre com <loopy-done/>",
        },
      },
    };
    const legit: StreamUpdate = {
      kind: "raw",
      updateKind: "config_option_update",
      payload: { sessionUpdate: "config_option_update", value: "VISIVEL" },
    };
    const inPhase = advance(
      advance(initialInterviewState(), { kind: "triaged", track: "feature" }),
      { kind: "described", text: "demanda" },
    );
    const state = advance(
      advance(inPhase, { kind: "agent_stream", update: envelope }),
      { kind: "agent_stream", update: legit },
    );

    const { container } = render(
      <ActivityLine line="Trabalhando…" transcript={state.transcript} busy />,
    );
    container
      .querySelectorAll<HTMLDetailsElement>("details")
      .forEach(openDetails);

    // O raw legítimo aberto prova que o disclosure revela o payload…
    expect(container.textContent).toContain("VISIVEL");
    // …e mesmo assim nenhum bloco do Envelope aparece, disclosure aberto.
    expect(container.textContent).not.toContain("loopy-");
  });

  it("never truncates the narration (no ellipsis clamp)", () => {
    const long = `Vou primeiro olhar o estado atual do diretório antes de decidir o que perguntar.

O diretório está vazio (só há \`.loopy/capabilities.json\`), então é um greenfield.`;
    const { container } = render(
      <ActivityLine
        line="…"
        transcript={[{ item: "text", text: long }]}
        busy
      />,
    );

    const narration = container.querySelector(".spec-activity__narration")!;
    // The clamp utility must not be anywhere in the narration subtree.
    expect(narration.querySelector(".u-truncate")).toBeNull();
    expect(narration.classList.contains("u-truncate")).toBe(false);
    // Both paragraphs are present — the second one is what the ellipsis ate.
    expect(narration.textContent).toContain("antes de decidir o que perguntar");
    expect(narration.textContent).toContain("então é um greenfield");
    // And they are separate blocks, not one glued run.
    expect(narration.querySelectorAll("p").length).toBeGreaterThan(1);
  });

  it("omits the narration box when the timeline is empty", () => {
    const { container } = render(
      <ActivityLine line="Começando…" transcript={[]} busy />,
    );
    expect(container.querySelector(".spec-activity__narration")).toBeNull();
  });

  it("falls back to a waiting label when there is no live line yet", () => {
    const { container } = render(<ActivityLine line={null} busy />);
    // Still renders a live region — never an empty box.
    expect(container.querySelector(".spec-activity")).not.toBeNull();
    expect(container.textContent).not.toBe("");
  });
});

describe("headerLabel", () => {
  it("carries the last narration when there is no transcript", () => {
    expect(headerLabel("Lendo o backlog…", false, true)).toBe(
      "Lendo o backlog…",
    );
    expect(headerLabel(null, false, true)).toBe("Trabalhando…");
  });

  it("states the status when the prose is right below it", () => {
    expect(headerLabel("Lendo o backlog…", true, true)).toBe("Trabalhando…");
    expect(headerLabel("Lendo o backlog…", true, false)).toBe(
      "Narração do agente",
    );
  });
});
