/**
 * Tests for ActivityLine: proof of life while the agent works (D14).
 *
 * A live one-line activity readout, plus a **collapsible transcript** that
 * reuses the app's MarkdownStream and is **born closed** — the spike measured
 * 328 s to the first question, so the live line has to prove the run is alive
 * without turning into a chat.
 *
 * Run: `npm test -w apps/menubar -- specs`
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

afterEach(cleanup);

const { ActivityLine } = await import("./ActivityLine");

// ---------------------------------------------------------------------------

describe("ActivityLine", () => {
  it("renders the live activity line", () => {
    const { getByText } = render(
      <ActivityLine line="Explorando src/telemetry…" busy />,
    );
    expect(getByText("Explorando src/telemetry…")).not.toBeNull();
  });

  it("is born with the transcript closed", () => {
    const { container } = render(
      <ActivityLine
        line="Lendo o backlog…"
        transcript="# Passos\n\nLi os arquivos."
        busy
      />,
    );
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    // The disclosure defaults to closed — no `open` attribute.
    expect((details as HTMLDetailsElement).open).toBe(false);
  });

  it("reveals the transcript markdown when opened", () => {
    const { container, getByText } = render(
      <ActivityLine
        line="Lendo o backlog…"
        transcript={"# Passos\n\nLi os arquivos."}
      />,
    );
    // Reuses MarkdownStream — its wrapper is present inside the disclosure.
    expect(container.querySelector(".md-stream")).not.toBeNull();

    const summary = container.querySelector("summary")!;
    fireEvent.click(summary);
    // The heading rendered by MarkdownStream is reachable.
    expect(getByText("Passos")).not.toBeNull();
  });

  it("omits the disclosure when there is no transcript", () => {
    const { container } = render(<ActivityLine line="Começando…" busy />);
    expect(container.querySelector("details")).toBeNull();
  });

  it("falls back to a waiting label when there is no live line yet", () => {
    const { container } = render(<ActivityLine line={null} busy />);
    // Still renders a live region — never an empty box.
    expect(container.querySelector(".spec-activity")).not.toBeNull();
    expect(container.textContent).not.toBe("");
  });
});
