/**
 * Tests for Handoff: the bug/debt terminal (D4/D24).
 *
 * The trail ends here with a `/devy:debug …` command mounted and copyable, plus
 * the context gathered along the way. **No file is created** — investigating is
 * a different product; this hands the work off to a terminal.
 *
 * Run: `npm test -w apps/menubar -- specs`
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";

afterEach(cleanup);

const { Handoff } = await import("./Handoff");

// ---------------------------------------------------------------------------

describe("Handoff", () => {
  it("mounts the /devy:debug command from the demand", () => {
    const { getByText } = render(
      <Handoff track="bug" demand="o botão de salvar trava com 2 anexos" />,
    );
    expect(
      getByText("/devy:debug o botão de salvar trava com 2 anexos"),
    ).not.toBeNull();
  });

  it("renders the gathered context", () => {
    const { getByText } = render(
      <Handoff
        track="bug"
        demand="trava ao salvar"
        context={[
          { label: "Reprodução", value: "Sempre, com 2+ anexos" },
          { label: "Evidência", value: "erro.log" },
        ]}
      />,
    );
    expect(getByText("Reprodução")).not.toBeNull();
    expect(getByText("Sempre, com 2+ anexos")).not.toBeNull();
    expect(getByText("Evidência")).not.toBeNull();
  });

  it("states plainly that no file is created", () => {
    const { getByText } = render(
      <Handoff track="debt" demand="acoplamento do orquestrador" />,
    );
    expect(getByText(/nenhum arquivo é criado/i)).not.toBeNull();
  });

  describe("copy", () => {
    beforeEach(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
      });
    });

    it("copies the command to the clipboard", async () => {
      const { getByText } = render(
        <Handoff track="bug" demand="trava ao salvar" />,
      );
      fireEvent.click(getByText("Copiar"));
      await waitFor(() =>
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          "/devy:debug trava ao salvar",
        ),
      );
    });
  });
});
