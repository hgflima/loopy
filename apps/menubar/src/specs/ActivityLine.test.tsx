/**
 * Tests for ActivityLine: proof of life while the agent works (D14).
 *
 * A pulsing header plus the Agent's narration **rendered in full**. The spike
 * measured 328 s to the first question, so the header has to prove the run is
 * alive — but the narration itself is the turn's whole prose (markdown), so it
 * is never truncated: no ellipsis, no one-line clamp.
 *
 * Run: `npm test -w apps/menubar -- specs`
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

afterEach(cleanup);

const { ActivityLine, headerLabel } = await import("./ActivityLine");

// ---------------------------------------------------------------------------

describe("ActivityLine", () => {
  it("renders the live activity line when there is no transcript yet", () => {
    const { getByText } = render(
      <ActivityLine line="Explorando src/telemetry…" busy />,
    );
    expect(getByText("Explorando src/telemetry…")).not.toBeNull();
  });

  it("renders the narration as markdown, visible without any disclosure", () => {
    const { container, getByText } = render(
      <ActivityLine
        line="Li os arquivos."
        transcript={"# Passos\n\nLi os arquivos."}
        busy
      />,
    );
    // No <details>: the narration is on screen, not behind a toggle.
    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelector(".spec-activity__narration")).not.toBeNull();
    // MarkdownStream rendered it — the heading is a real <h1>, reachable now.
    expect(container.querySelector(".md-stream")).not.toBeNull();
    expect(getByText("Passos")).not.toBeNull();
  });

  it("never truncates the narration (no ellipsis clamp)", () => {
    const long = `Vou primeiro olhar o estado atual do diretório antes de decidir o que perguntar.

O diretório está vazio (só há \`.loopy/capabilities.json\`), então é um greenfield.`;
    const { container } = render(
      <ActivityLine line="…" transcript={long} busy />,
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

  it("omits the narration box when the transcript is empty", () => {
    const { container } = render(
      <ActivityLine line="Começando…" transcript="" busy />,
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
