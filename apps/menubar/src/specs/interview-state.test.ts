import { describe, it, expect } from "vitest";
import type { StreamUpdate } from "loopy/tui/store";
import {
  advance,
  gateOptions,
  initialInterviewState,
  trackOf,
  type InterviewState,
  type PendingQuestion,
} from "./interview-state";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const QUESTION: PendingQuestion = {
  questionId: "objetivo",
  phase: "spec",
  prompt: "Qual o objetivo desta feature?",
  options: [
    { label: "Tendência", detail: "…", recommended: true, why: "porque…" },
    { label: "Forense", detail: "…" },
  ],
  otherLabel: "Escrever a minha…",
};

/** Drives the reducer from the initial state through a list of events. */
function run(...events: Parameters<typeof advance>[1][]): InterviewState {
  return events.reduce(advance, initialInterviewState());
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("initialInterviewState", () => {
  it("começa na triagem, sem trilha, sem respostas", () => {
    const s = initialInterviewState();
    expect(s.stage).toBe("triage");
    expect(s.track).toBeNull();
    expect(s.answers).toEqual([]);
    expect(s.warnings).toEqual([]);
    expect(s.pending).toBeNull();
    expect(s.transcript).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// trackOf — the triage → track mapping (D24)
// ---------------------------------------------------------------------------

describe("trackOf", () => {
  it("mapeia os rótulos conhecidos", () => {
    expect(trackOf("Nova feature")).toBe("feature");
    expect(trackOf("Bug")).toBe("bug");
    expect(trackOf("Débito técnico")).toBe("debt");
  });

  it('"Outro tipo de demanda…" cai na trilha feature (D24), não no caminho estéril', () => {
    expect(trackOf("Outro tipo de demanda…")).toBe("feature");
    expect(trackOf("qualquer coisa desconhecida")).toBe("feature");
  });
});

// ---------------------------------------------------------------------------
// Acceptance 1 — avanço triagem → demanda → fase → gate → salvo
// ---------------------------------------------------------------------------

describe("avanço da trilha feature", () => {
  it("triagem → descrição", () => {
    const s = run({ kind: "triaged", track: "feature" });
    expect(s.stage).toBe("describe");
    expect(s.track).toBe("feature");
  });

  it("descrição → fase spec (rodando), guardando a demanda", () => {
    const s = run(
      { kind: "triaged", track: "feature" },
      { kind: "described", text: "quero uma aba de histórico" },
    );
    expect(s.stage).toBe("phase");
    expect(s.phase).toBe("spec");
    expect(s.activity).toBe("running");
    expect(s.demand).toBe("quero uma aba de histórico");
  });

  it("fase spec termina → gate; gate → plano → fase termina → salvo", () => {
    const s = run(
      { kind: "triaged", track: "feature" },
      { kind: "described", text: "demanda" },
      {
        kind: "phase_finished",
        phase: "spec",
        changeDir: ".harn/devy/changes/C-0018-x",
        files: ["spec.md"],
      },
    );
    expect(s.stage).toBe("gate");
    expect(s.phase).toBe("spec");
    expect(s.changeDir).toBe(".harn/devy/changes/C-0018-x");
    expect(s.files).toEqual(["spec.md"]);

    const plan = advance(s, { kind: "gate_decision", next: "plan" });
    expect(plan.stage).toBe("phase");
    expect(plan.phase).toBe("plan");
    expect(plan.activity).toBe("running");
    // muda de fase mas preserva o changeDir já resolvido (D15)
    expect(plan.changeDir).toBe(".harn/devy/changes/C-0018-x");

    const saved = advance(plan, {
      kind: "phase_finished",
      phase: "plan",
      changeDir: ".harn/devy/changes/C-0018-x",
      files: ["spec.md", "plan.md", "todo.md"],
    });
    expect(saved.stage).toBe("saved");
    expect(saved.files).toEqual(["spec.md", "plan.md", "todo.md"]);
  });

  it("gate após spec, escolher Refinar entra na fase refine", () => {
    const s = run(
      { kind: "triaged", track: "feature" },
      { kind: "described", text: "demanda" },
      {
        kind: "phase_finished",
        phase: "spec",
        changeDir: "d",
        files: ["spec.md"],
      },
      { kind: "gate_decision", next: "refine" },
    );
    expect(s.stage).toBe("phase");
    expect(s.phase).toBe("refine");
  });
});

// ---------------------------------------------------------------------------
// Acceptance 2 — o gate oferece Refinar / Ir ao plano / Fechar
// ---------------------------------------------------------------------------

describe("gate (D12)", () => {
  it("oferece refine, plan e close", () => {
    const s = run(
      { kind: "triaged", track: "feature" },
      { kind: "described", text: "demanda" },
      {
        kind: "phase_finished",
        phase: "spec",
        changeDir: "d",
        files: ["spec.md"],
      },
    );
    expect(gateOptions(s).map((o) => o.next)).toEqual([
      "refine",
      "plan",
      "close",
    ]);
  });

  it("fora do gate não oferece nada", () => {
    expect(gateOptions(initialInterviewState())).toEqual([]);
  });

  it('"Fechar" leva a um término local sem nova fase', () => {
    const s = run(
      { kind: "triaged", track: "feature" },
      { kind: "described", text: "demanda" },
      {
        kind: "phase_finished",
        phase: "spec",
        changeDir: "d",
        files: ["spec.md"],
      },
      { kind: "gate_decision", next: "close" },
    );
    expect(s.stage).toBe("closed");
    // o que foi gravado permanece — a Change fica parcial em disco
    expect(s.files).toEqual(["spec.md"]);
  });

  it("gate_decision fora do gate é no-op (mesma referência)", () => {
    const s = initialInterviewState();
    expect(advance(s, { kind: "gate_decision", next: "plan" })).toBe(s);
  });
});

// ---------------------------------------------------------------------------
// Acceptance 3 — trilha bug chega ao hand-off sem passar por fase
// ---------------------------------------------------------------------------

describe("trilhas bug/débito (nunca spawnam processo)", () => {
  it("bug: descrição vai direto para o hand-off, nunca para uma fase", () => {
    const s = run(
      { kind: "triaged", track: "bug" },
      { kind: "described", text: "o app fecha sozinho" },
    );
    expect(s.stage).toBe("handoff");
    expect(s.phase).toBeNull();
    expect(s.demand).toBe("o app fecha sozinho");
  });

  it("débito também termina no hand-off", () => {
    const s = run(
      { kind: "triaged", track: "debt" },
      { kind: "described", text: "parseDeps engole a última dep" },
    );
    expect(s.stage).toBe("handoff");
    expect(s.phase).toBeNull();
  });

  it('"Outro" via trackOf produz feature e alcança uma fase (D24)', () => {
    const s = run(
      { kind: "triaged", track: trackOf("Outro tipo de demanda…") },
      { kind: "described", text: "algo" },
    );
    expect(s.stage).toBe("phase");
    expect(s.phase).toBe("spec");
  });
});

// ---------------------------------------------------------------------------
// Acceptance 4 — resposta a questionId desconhecido devolve a MESMA referência
// ---------------------------------------------------------------------------

describe("answered (structural sharing)", () => {
  const asking = run(
    { kind: "triaged", track: "feature" },
    { kind: "described", text: "demanda" },
    { kind: "question_asked", question: QUESTION },
  );

  it("uma pergunta pendente coloca o fluxo em asking", () => {
    expect(asking.stage).toBe("phase");
    expect(asking.activity).toBe("asking");
    expect(asking.pending).toEqual(QUESTION);
  });

  it("responder o questionId pendente registra a resposta e limpa o pending", () => {
    const s = advance(asking, {
      kind: "answered",
      questionId: "objetivo",
      text: "tendência",
      attachments: [".loopy/attachments/x.png"],
    });
    expect(s.pending).toBeNull();
    expect(s.activity).toBe("running");
    expect(s.answers).toEqual([
      {
        questionId: "objetivo",
        text: "tendência",
        attachments: [".loopy/attachments/x.png"],
      },
    ]);
  });

  it("responder um questionId que NÃO é o pendente é no-op → mesma referência", () => {
    expect(
      advance(asking, { kind: "answered", questionId: "outro-id", text: "x" }),
    ).toBe(asking);
  });

  it("responder quando não há pergunta pendente é no-op → mesma referência", () => {
    const noPending = run({ kind: "triaged", track: "feature" });
    expect(
      advance(noPending, {
        kind: "answered",
        questionId: "objetivo",
        text: "x",
      }),
    ).toBe(noPending);
  });
});

// ---------------------------------------------------------------------------
// wrap_up (D17) — marca a fase como encerrando, mas quem termina é o <loopy-done/>
// ---------------------------------------------------------------------------

describe("wrap_up (D17)", () => {
  const inPhase = run(
    { kind: "triaged", track: "feature" },
    { kind: "described", text: "demanda" },
    { kind: "question_asked", question: QUESTION },
  );

  it("marca wrappingUp mas NÃO encerra a fase — continua em phase", () => {
    const s = advance(inPhase, { kind: "wrap_up" });
    expect(s.stage).toBe("phase");
    expect(s.wrappingUp).toBe(true);
    // a pergunta pendente é dispensada (o humano desistiu dela)
    expect(s.pending).toBeNull();
  });

  it("quem encerra é o phase_finished (→ gate)", () => {
    const wrapped = advance(inPhase, { kind: "wrap_up" });
    const done = advance(wrapped, {
      kind: "phase_finished",
      phase: "spec",
      changeDir: "d",
      files: ["spec.md"],
    });
    expect(done.stage).toBe("gate");
    expect(done.wrappingUp).toBe(false);
  });

  it("fora de uma fase é no-op (mesma referência)", () => {
    const s = initialInterviewState();
    expect(advance(s, { kind: "wrap_up" })).toBe(s);
  });
});

// ---------------------------------------------------------------------------
// Acceptance 5 — cancelar não zera o que foi gravado
// ---------------------------------------------------------------------------

describe("cancel (D25)", () => {
  const mid = run(
    { kind: "triaged", track: "feature" },
    { kind: "described", text: "demanda" },
    { kind: "change_resolved", changeDir: ".harn/devy/changes/C-0018-x" },
    { kind: "question_asked", question: QUESTION },
    { kind: "answered", questionId: "objetivo", text: "tendência" },
  );

  it("cancelar move para cancelled mas preserva respostas, changeDir e demanda", () => {
    const s = advance(mid, { kind: "cancel" });
    expect(s.stage).toBe("cancelled");
    expect(s.answers).toHaveLength(1);
    expect(s.changeDir).toBe(".harn/devy/changes/C-0018-x");
    expect(s.demand).toBe("demanda");
    expect(s.pending).toBeNull();
  });

  it("um frame tardio após cancel não corrompe o fluxo (no-op → mesma referência)", () => {
    const cancelled = advance(mid, { kind: "cancel" });
    // uma pergunta que chega depois do cancel é absorvida
    expect(
      advance(cancelled, { kind: "question_asked", question: QUESTION }),
    ).toBe(cancelled);
    // idem uma resposta tardia
    expect(
      advance(cancelled, {
        kind: "answered",
        questionId: "objetivo",
        text: "x",
      }),
    ).toBe(cancelled);
    // e um phase_finished tardio
    expect(
      advance(cancelled, {
        kind: "phase_finished",
        phase: "spec",
        changeDir: "d",
        files: ["spec.md"],
      }),
    ).toBe(cancelled);
  });
});

// ---------------------------------------------------------------------------
// warning — acumula sem interromper
// ---------------------------------------------------------------------------

describe("warning (D25)", () => {
  it("acumula sem mudar o estágio nem interromper o fluxo", () => {
    const asking = run(
      { kind: "triaged", track: "feature" },
      { kind: "described", text: "demanda" },
      { kind: "question_asked", question: QUESTION },
    );
    const s = advance(asking, { kind: "warning", text: "dois blocos ask" });
    expect(s.warnings).toEqual(["dois blocos ask"]);
    expect(s.stage).toBe("phase");
    expect(s.activity).toBe("asking");
    expect(s.pending).toEqual(QUESTION);

    const s2 = advance(s, { kind: "warning", text: "json malformado" });
    expect(s2.warnings).toEqual(["dois blocos ask", "json malformado"]);
  });
});

// ---------------------------------------------------------------------------
// Control frames — phase_started, change_resolved, activity, failed
// ---------------------------------------------------------------------------

describe("frames de controle do processo", () => {
  it("phase_started confirma comando e mantém rodando", () => {
    const s = run(
      { kind: "triaged", track: "feature" },
      { kind: "described", text: "demanda" },
      { kind: "phase_started", phase: "spec", command: "/devy:spec demanda" },
    );
    expect(s.stage).toBe("phase");
    expect(s.command).toBe("/devy:spec demanda");
    expect(s.activity).toBe("running");
  });

  it("change_resolved fixa o changeDir; repetir o mesmo é no-op", () => {
    const started = run(
      { kind: "triaged", track: "feature" },
      { kind: "described", text: "demanda" },
    );
    const resolved = advance(started, {
      kind: "change_resolved",
      changeDir: ".harn/devy/changes/C-0018-x",
    });
    expect(resolved.changeDir).toBe(".harn/devy/changes/C-0018-x");
    expect(
      advance(resolved, {
        kind: "change_resolved",
        changeDir: ".harn/devy/changes/C-0018-x",
      }),
    ).toBe(resolved);
  });

  it("activity atualiza a linha viva; a mesma linha é no-op", () => {
    const started = run(
      { kind: "triaged", track: "feature" },
      { kind: "described", text: "demanda" },
    );
    const a = advance(started, { kind: "activity", text: "explorando src/…" });
    expect(a.activityLine).toBe("explorando src/…");
    expect(advance(a, { kind: "activity", text: "explorando src/…" })).toBe(a);
  });

  // A narração antiga não pode sumir quando a próxima chega: cada
  // `agent_activity` é a prosa INTEIRA de um turno, e substituir apagava tudo
  // que o Agente contou antes da pergunta que o humano acabou de responder.
  // Agora a timeline é `StreamItem[]`: cada narração vira um item `text`.
  it("activity empurra um item text por narração, na ordem de chegada", () => {
    const started = run(
      { kind: "triaged", track: "feature" },
      { kind: "described", text: "demanda" },
    );
    const a = advance(started, { kind: "activity", text: "# Passos\n\nLi." });
    expect(a.transcript).toEqual([{ item: "text", text: "# Passos\n\nLi." }]);

    const b = advance(a, { kind: "activity", text: "Agora escrevo a spec." });
    expect(b.transcript).toEqual([
      { item: "text", text: "# Passos\n\nLi." },
      { item: "text", text: "Agora escrevo a spec." },
    ]);
    // a última narração continua no activityLine (o header a usa)
    expect(b.activityLine).toBe("Agora escrevo a spec.");
  });

  it("um frame de activity duplicado é no-op (mesma referência)", () => {
    const started = run(
      { kind: "triaged", track: "feature" },
      { kind: "described", text: "demanda" },
    );
    const a = advance(started, { kind: "activity", text: "olhando o dir" });
    expect(advance(a, { kind: "activity", text: "olhando o dir" })).toBe(a);
  });

  it("cada Fase tem a sua timeline: entrar numa nova Fase zera", () => {
    const started = run(
      { kind: "triaged", track: "feature" },
      { kind: "described", text: "demanda" },
    );
    const narrated = advance(started, {
      kind: "activity",
      text: "prosa da spec",
    });
    const finished = advance(narrated, {
      kind: "phase_finished",
      phase: "spec",
      changeDir: ".harn/devy/changes/C-0018-x",
      files: ["spec.md"],
    });
    expect(finished.transcript).toEqual([]);

    const refining = advance(finished, {
      kind: "gate_decision",
      next: "refine",
    });
    expect(refining.transcript).toEqual([]);
  });

  it("failed leva ao estágio failed com a razão", () => {
    const started = run(
      { kind: "triaged", track: "feature" },
      { kind: "described", text: "demanda" },
    );
    const s = advance(started, { kind: "failed", reason: "processo saiu 1" });
    expect(s.stage).toBe("failed");
    expect(s.failure).toBe("processo saiu 1");
  });
});

// ---------------------------------------------------------------------------
// agent_stream (T-014) — a mesma timeline rica do Run, sem texto ao vivo (R1/R2)
// ---------------------------------------------------------------------------

describe("agent_stream (T-014)", () => {
  const toolUpdate = (id: string, title: string): StreamUpdate => ({
    kind: "tool_call",
    call: {
      toolCallId: id,
      title,
      kind: "read",
      status: "in_progress",
      locations: [],
      content: [],
    },
  });

  const inPhase = (): InterviewState =>
    run(
      { kind: "triaged", track: "feature" },
      { kind: "described", text: "demanda" },
    );

  it("um agent_stream de tool aparece na timeline da Fase corrente", () => {
    const s = advance(inPhase(), {
      kind: "agent_stream",
      update: toolUpdate("t1", "Lendo src/auth.ts"),
    });
    expect(s.transcript).toHaveLength(1);
    const item = s.transcript[0]!;
    expect(item.item).toBe("tool");
    expect(item.item === "tool" && item.call.toolCallId).toBe("t1");
  });

  it("um agent_activity vira item text DEPOIS dos itens de tool anteriores", () => {
    const withTool = advance(inPhase(), {
      kind: "agent_stream",
      update: toolUpdate("t1", "Lendo"),
    });
    const s = advance(withTool, { kind: "activity", text: "Li os arquivos." });
    expect(s.transcript.map((it) => it.item)).toEqual(["tool", "text"]);
    expect(s.transcript[1]).toEqual({ item: "text", text: "Li os arquivos." });
  });

  it("tool_delta intercalado volta ao card certo (a mergeToolCall do Run, R2)", () => {
    const withTool = advance(inPhase(), {
      kind: "agent_stream",
      update: toolUpdate("t1", "Lendo"),
    });
    const narrated = advance(withTool, { kind: "activity", text: "olhando" });
    const s = advance(narrated, {
      kind: "agent_stream",
      update: {
        kind: "tool_delta",
        delta: { toolCallId: "t1", status: "completed" },
      },
    });
    // não fabricou card novo; o texto continua entre eles, o card foi mesclado
    expect(s.transcript.map((it) => it.item)).toEqual(["tool", "text"]);
    const tool = s.transcript[0]!;
    expect(tool.item === "tool" && tool.call.status).toBe("completed");
  });

  it("um delta órfão (sem card) é no-op → mesma referência", () => {
    const base = inPhase();
    const s = advance(base, {
      kind: "agent_stream",
      update: {
        kind: "tool_delta",
        delta: { toolCallId: "fantasma", status: "completed" },
      },
    });
    expect(s).toBe(base);
  });

  it("phase_finished zera a timeline mesmo com itens de tool acumulados", () => {
    const narrated = run(
      { kind: "triaged", track: "feature" },
      { kind: "described", text: "demanda" },
      { kind: "agent_stream", update: toolUpdate("t1", "Lendo") },
      { kind: "activity", text: "prosa" },
    );
    expect(narrated.transcript).toHaveLength(2);

    const finished = advance(narrated, {
      kind: "phase_finished",
      phase: "spec",
      changeDir: "d",
      files: ["spec.md"],
    });
    expect(finished.transcript).toEqual([]);
  });

  it("um agent_stream após um estágio terminal é absorvido (mesma referência)", () => {
    const cancelled = advance(inPhase(), { kind: "cancel" });
    expect(
      advance(cancelled, {
        kind: "agent_stream",
        update: toolUpdate("t1", "x"),
      }),
    ).toBe(cancelled);
  });

  it("descarta o Envelope ecoado (raw user_message_chunk com <loopy-…>) → mesma referência", () => {
    // O motor ecoa o NOSSO Envelope de volta como um raw `user_message_chunk`
    // (a barreira T-013 só cobre `agent_message_chunk`). É plumbing, não
    // conteúdo do agente: T-014 proíbe um bloco <loopy-…> na tela em estado
    // nenhum. Nada apendado → mesma referência (structural sharing).
    const base = inPhase();
    const echoed: StreamUpdate = {
      kind: "raw",
      updateKind: "user_message_chunk",
      payload: {
        sessionUpdate: "user_message_chunk",
        content: {
          type: "text",
          text: 'Regras: uma pergunta por turno, no bloco <loopy-ask>{"id":"x"}</loopy-ask>; <loopy-done/> ao terminar.',
        },
      },
    };
    const s = advance(base, { kind: "agent_stream", update: echoed });
    expect(s).toBe(base);
    expect(s.transcript).toEqual([]);
  });

  it("um raw legítimo (sem Envelope) continua entrando na timeline", () => {
    const base = inPhase();
    const raw: StreamUpdate = {
      kind: "raw",
      updateKind: "config_option_update",
      payload: { sessionUpdate: "config_option_update", value: "high" },
    };
    const s = advance(base, { kind: "agent_stream", update: raw });
    expect(s.transcript).toHaveLength(1);
    const item = s.transcript[0]!;
    expect(item.item).toBe("raw");
    expect(item.item === "raw" && item.kind).toBe("config_option_update");
  });
});
