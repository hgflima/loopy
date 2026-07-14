/**
 * Tests for useAgentCapabilities — the probe bridge (D-0011).
 *
 * O invariante que estes testes protegem: **o resultado pertence ao argv que o
 * produziu**. A sondagem é assíncrona, então entre trocar o preset e a resposta
 * do adapter novo existe uma janela em que o hook ainda tem em mãos as
 * capabilities do adapter ANTERIOR. Entregá-las é pior do que não entregar nada:
 * o `ConfigPane` semeia `model`/`effort` com o default sondado, e semear o
 * default do adapter velho grava no yml um model que o novo não conhece.
 *
 * Run: `npm test -w apps/menubar -- useAgentCapabilities`
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useAgentCapabilities } from "./useAgentCapabilities";

const CLAUDE_ARGV = ["npx", "claude-agent-acp"];
const CODEX_ARGV = ["npx", "codex-acp"];

const CLAUDE_CAPS = {
  modes: ["acceptEdits", "plan"],
  models: ["opus", "sonnet"],
  efforts: ["low", "high"],
  defaultModel: "opus",
  defaultEffort: "high",
};
const CODEX_CAPS = {
  modes: ["agent", "read-only"],
  models: ["gpt-5.5", "gpt-5.4"],
  efforts: ["xhigh"],
  defaultModel: "gpt-5.5",
  defaultEffort: "xhigh",
};

/** Probes ficam pendentes até o teste liberar — é a janela que queremos observar. */
let pending: Array<() => void>;

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  pending = [];
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(
    async (cmd: string, args: { command?: string[] }) => {
      if (cmd === "read_capabilities_cache") return null; // sempre miss → sonda
      if (cmd === "probe_agent") {
        const argv = (args.command ?? []).join(" ");
        const caps = argv.includes("codex") ? CODEX_CAPS : CLAUDE_CAPS;
        return new Promise<string>((resolve) => {
          pending.push(() => resolve(JSON.stringify(caps)));
        });
      }
      throw new Error(`unexpected command: ${cmd}`);
    },
  );
});

/** Libera as sondagens em voo e deixa o React processar as respostas. */
async function settleProbes() {
  const inflight = pending;
  pending = [];
  for (const resolve of inflight) resolve();
}

describe("useAgentCapabilities — o resultado é do argv que o produziu", () => {
  it("entrega as capabilities do agente sondado", async () => {
    const { result } = renderHook(() =>
      useAgentCapabilities("a", CLAUDE_ARGV, "/project"),
    );

    await waitFor(() => expect(pending.length).toBe(1));
    await settleProbes();

    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.caps?.defaultModel).toBe("opus");
  });

  // O bug: trocar o preset re-sonda, mas até a resposta chegar o hook devolvia
  // `{status: "ok", caps}` do adapter ANTIGO — e o ConfigPane semeava com ele.
  it("NÃO entrega as capabilities do argv anterior enquanto o novo é sondado", async () => {
    const { result, rerender } = renderHook(
      ({ argv }: { argv: readonly string[] }) =>
        useAgentCapabilities("a", argv, "/project"),
      { initialProps: { argv: CLAUDE_ARGV as readonly string[] } },
    );

    await waitFor(() => expect(pending.length).toBe(1));
    await settleProbes();
    await waitFor(() => expect(result.current.caps?.defaultModel).toBe("opus"));

    // Troca de preset: o argv muda, a sondagem do novo ainda não respondeu.
    rerender({ argv: CODEX_ARGV });

    expect(result.current.status).not.toBe("ok");
    expect(result.current.caps).toBeUndefined();

    // …e quando ela responde, são as capabilities do adapter novo.
    await waitFor(() => expect(pending.length).toBe(1));
    await settleProbes();
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.caps?.defaultModel).toBe("gpt-5.5");
  });

  it("uma sondagem tardia do argv antigo não sobrescreve a do corrente", async () => {
    const { result, rerender } = renderHook(
      ({ argv }: { argv: readonly string[] }) =>
        useAgentCapabilities("a", argv, "/project"),
      { initialProps: { argv: CLAUDE_ARGV as readonly string[] } },
    );

    await waitFor(() => expect(pending.length).toBe(1));
    const staleProbe = pending;
    pending = [];

    rerender({ argv: CODEX_ARGV });
    await waitFor(() => expect(pending.length).toBe(1));
    await settleProbes(); // o codex responde primeiro
    await waitFor(() => expect(result.current.status).toBe("ok"));

    for (const resolve of staleProbe) resolve(); // o claude responde atrasado
    await new Promise((r) => setTimeout(r, 0));

    expect(result.current.caps?.defaultModel).toBe("gpt-5.5");
  });
});
