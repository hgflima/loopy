import { describe, it, expect } from "vitest";
import type { TaskStatus } from "loopy/tui/store";
import { wavefront, nodeStatusMeta, edgeFlow } from "./flow-state";

/** Build the statusById map the graph feeds these functions. */
function statuses(entries: Record<string, TaskStatus>): ReadonlyMap<string, TaskStatus> {
  return new Map(Object.entries(entries));
}

// ---------------------------------------------------------------------------
// wavefront — quem roda a seguir
// ---------------------------------------------------------------------------

describe("wavefront", () => {
  // O caso do print: T-016 roda; T-017/T-018 esperam só por ela; T-019 espera
  // por T-017/T-018 — está DOIS saltos à frente e não pode acender.
  it("acende só quem espera pelo que roda agora, não o backlog inteiro", () => {
    const front = wavefront(
      statuses({
        "T-015": "done",
        "T-016": "running",
        "T-017": "blocked",
        "T-018": "blocked",
        "T-019": "blocked",
      }),
      [
        ["T-015", "T-016"],
        ["T-016", "T-017"],
        ["T-016", "T-018"],
        ["T-017", "T-019"],
        ["T-018", "T-019"],
      ],
    );

    expect([...front].sort()).toEqual(["T-017", "T-018"]);
  });

  it("task com todas as deps done está na frente (ready, mesmo sem nada rodando)", () => {
    const front = wavefront(
      statuses({ A: "done", B: "done", C: "blocked", D: "blocked" }),
      [
        ["A", "C"],
        ["B", "C"],
        ["C", "D"],
      ],
    );

    expect([...front]).toEqual(["C"]);
  });

  it("uma dep atrasada basta para segurar a task fora da frente", () => {
    const front = wavefront(
      statuses({ A: "done", B: "blocked", C: "blocked" }),
      [
        ["A", "C"],
        ["B", "C"],
      ],
    );

    expect(front.has("C")).toBe(false);
    expect(front.has("B")).toBe(true); // B não tem deps
  });

  it("task sem deps é frente de onda enquanto pendente", () => {
    const front = wavefront(statuses({ A: "pending", B: "pending" }), []);
    expect([...front].sort()).toEqual(["A", "B"]);
  });

  it("quem já saiu da espera (running/done/escalated/paused/skipped) nunca é frente", () => {
    const front = wavefront(
      statuses({
        A: "running",
        B: "done",
        C: "escalated",
        D: "paused",
        E: "skipped",
      }),
      [],
    );
    expect(front.size).toBe(0);
  });

  it("dep de status desconhecido segura a task (fail-closed)", () => {
    const front = wavefront(statuses({ B: "blocked" }), [["A", "B"]]);
    expect(front.has("B")).toBe(false);
  });

  // Sem arestas, TODA task satisfaz a regra vacuamente — o teto (concurrency)
  // é o que impede um backlog linear de acender inteiro.
  it("backlog sem deps: o teto corta a frente às primeiras N do backlog", () => {
    const backlog = statuses({
      "T-001": "pending",
      "T-002": "pending",
      "T-003": "pending",
      "T-004": "pending",
    });

    expect([...wavefront(backlog, [], 1)]).toEqual(["T-001"]);
    expect([...wavefront(backlog, [], 2)]).toEqual(["T-001", "T-002"]);
  });

  it("o teto pula quem já rodou — conta só a frente, na ordem do backlog", () => {
    const front = wavefront(
      statuses({
        "T-001": "done",
        "T-002": "running",
        "T-003": "pending",
        "T-004": "pending",
      }),
      [],
      2,
    );

    expect([...front]).toEqual(["T-003", "T-004"]);
  });

  it("teto acima da frente não corta nada (o caso com Deps: declaradas)", () => {
    const front = wavefront(
      statuses({ "T-016": "running", "T-017": "blocked", "T-018": "blocked" }),
      [
        ["T-016", "T-017"],
        ["T-016", "T-018"],
      ],
      3,
    );

    expect([...front].sort()).toEqual(["T-017", "T-018"]);
  });

  it("sem teto (omitido) não corta — melhor acender demais que apagar a próxima", () => {
    const front = wavefront(statuses({ A: "pending", B: "pending", C: "pending" }), []);
    expect(front.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// nodeStatusMeta — o anel do card
// ---------------------------------------------------------------------------

describe("nodeStatusMeta", () => {
  it("espera na frente de onda → âmbar, rotulada Next", () => {
    for (const status of ["blocked", "pending"] as const) {
      expect(nodeStatusMeta(status, true)).toEqual({
        tone: "blocked",
        label: "Next",
        hollow: true,
      });
    }
  });

  it("espera atrás da frente → cinza neutro, mantendo o rótulo do status", () => {
    expect(nodeStatusMeta("blocked", false)).toEqual({
      tone: "neutral",
      label: "Blocked",
      hollow: true,
    });
    expect(nodeStatusMeta("pending", false)).toEqual({
      tone: "neutral",
      label: "Pending",
      hollow: true,
    });
  });

  it.each<[TaskStatus, string]>([
    ["running", "running"],
    ["done", "done"],
    ["escalated", "failed"],
    ["paused", "blocked"],
    ["skipped", "neutral"],
  ])("status %s tem cor própria — a frente de onda não interfere", (status, tone) => {
    expect(nodeStatusMeta(status, false).tone).toBe(tone);
    expect(nodeStatusMeta(status, true).tone).toBe(tone);
  });
});

// ---------------------------------------------------------------------------
// edgeFlow — o fluxo de cada aresta
// ---------------------------------------------------------------------------

describe("edgeFlow", () => {
  it("entra numa running → running (o antes)", () => {
    const s = statuses({ A: "done", B: "running" });
    expect(edgeFlow("A", "B", s, new Set())).toBe("running");
  });

  it("entra na frente de onda → next (o caminho que destrava a próxima)", () => {
    const s = statuses({ B: "running", C: "blocked" });
    expect(edgeFlow("B", "C", s, new Set(["C"]))).toBe("next");
  });

  it("as duas pontas rodando → running vence o empate (D2)", () => {
    const s = statuses({ A: "running", B: "running" });
    expect(edgeFlow("A", "B", s, new Set())).toBe("running");
  });

  it("liga duas done → done (caminho percorrido)", () => {
    const s = statuses({ A: "done", B: "done" });
    expect(edgeFlow("A", "B", s, new Set())).toBe("done");
  });

  it("done → task não iniciada e fora da frente NÃO é done (trecho ainda não andado)", () => {
    const s = statuses({ A: "done", B: "blocked" });
    expect(edgeFlow("A", "B", s, new Set())).toBeNull();
  });

  it("longe de tudo → null (o grafo fica quieto)", () => {
    const s = statuses({ A: "pending", B: "blocked" });
    expect(edgeFlow("A", "B", s, new Set())).toBeNull();
  });

  // A regressão da tela: a linha âmbar apontava para um card cinza (T-005, que
  // ainda espera outras deps) e o caminho até a verdadeira próxima (T-003)
  // ficava apagado. Linha e card têm de dizer a mesma coisa.
  it("sai de uma running para quem ainda espera OUTRAS deps → fica quieta", () => {
    const s = statuses({
      "T-001": "done",
      "T-002": "running",
      "T-003": "blocked",
      "T-005": "blocked",
    });
    const edges: [string, string][] = [
      ["T-001", "T-002"],
      ["T-001", "T-003"],
      ["T-002", "T-005"],
      ["T-003", "T-005"],
    ];
    const front = wavefront(s, edges);
    expect([...front]).toEqual(["T-003"]);

    // T-002 roda, mas T-005 ainda espera T-003 → a aresta não é "next".
    expect(edgeFlow("T-002", "T-005", s, front)).toBeNull();
    // O caminho até a próxima acende, mesmo saindo de uma done.
    expect(edgeFlow("T-001", "T-003", s, front)).toBe("next");
  });
});
