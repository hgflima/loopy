/**
 * PROTOTYPE — throwaway. Canned data for the authoring variants.
 *
 * Nothing here talks to a real agent or touches disk. The "agent" is a
 * lookup table: every question has a pre-written follow-up and every step
 * has a pre-written chunk of `spec.md` / `plan.md` / `todo.md`.
 */

/** The imaginary change every variant is authoring. */
export const SEED_IDEA =
  "Quero uma aba de histórico: ver os runs passados de um projeto, com duração, quantas tasks passaram e quais escalaram.";

export interface Question {
  readonly id: string;
  /** Which document this answer feeds. */
  readonly doc: "spec" | "plan" | "todo";
  readonly prompt: string;
  /** Short label for the wizard's step header / the review chips. */
  readonly label: string;
  readonly placeholder: string;
  /** Suggested answers — click to fill (chips in B/D, radio-ish in A). */
  readonly suggestions: readonly string[];
  /** Canned answer used to pre-fill "what it looks like when done". */
  readonly cannedAnswer: string;
}

export const QUESTIONS: readonly Question[] = [
  {
    id: "problem",
    doc: "spec",
    label: "Problema",
    prompt: "Que dor isso resolve hoje?",
    placeholder: "Depois de um run eu perco tudo…",
    suggestions: [
      "Depois que o run termina eu não sei mais o que aconteceu",
      "Preciso comparar dois runs do mesmo projeto",
      "Quero achar qual task sempre escala",
    ],
    cannedAnswer:
      "Quando o run acaba, o Kanban zera. Não dá pra responder 'esse projeto tá melhorando?' sem abrir o SQLite na mão.",
  },
  {
    id: "users",
    doc: "spec",
    label: "Quem usa",
    prompt: "Quem abre essa tela, e em que momento?",
    placeholder: "Eu, logo depois de um run…",
    suggestions: [
      "Só eu, dogfooding",
      "Qualquer usuário do loopy",
      "Time olhando junto",
    ],
    cannedAnswer:
      "Eu, logo depois de um run — e no começo da semana pra ver a tendência.",
  },
  {
    id: "scope-out",
    doc: "spec",
    label: "Fora de escopo",
    prompt: "O que essa change explicitamente NÃO faz?",
    placeholder: "Não exporta, não compara projetos…",
    suggestions: [
      "Não exporta CSV",
      "Não compara projetos diferentes",
      "Não edita nada",
    ],
    cannedAnswer:
      "Não exporta, não compara projetos diferentes, não edita fato nenhum.",
  },
  {
    id: "accept",
    doc: "spec",
    label: "Critérios de aceite",
    prompt: "Como você sabe que ficou pronto?",
    placeholder: "Abro a aba e vejo…",
    suggestions: [
      "Lista os últimos 20 runs com duração e desfecho",
      "Clico num run e vejo as tasks dele",
      "Funciona sem nenhum run em andamento",
    ],
    cannedAnswer:
      "Abro a aba num projeto com `.db`, vejo os últimos 20 runs ordenados, clico num e vejo as tasks daquele run.",
  },
  {
    id: "where",
    doc: "plan",
    label: "Onde encaixa",
    prompt: "Onde isso mora no código?",
    placeholder: "src/insights/… ou uma aba nova?",
    suggestions: [
      "5ª aba do ViewSwitcher",
      "Um sub-modo dentro de Insights",
      "Janela separada",
    ],
    cannedAnswer:
      "Um sub-modo dentro da aba Insights — não vale gastar um 5º segmento.",
  },
  {
    id: "data",
    doc: "plan",
    label: "Dados",
    prompt: "De onde vêm os dados?",
    placeholder: "Views do .db/telemetry.db…",
    suggestions: [
      "View nova no SQLite",
      "Reusar v_change_baseline",
      "Ler o state.json",
    ],
    cannedAnswer:
      "View nova `v_run_history` no `.db/telemetry.db`, lida pelo comando Rust SELECT-only.",
  },
  {
    id: "risk",
    doc: "plan",
    label: "Risco",
    prompt: "O que pode dar errado?",
    placeholder: "Projeto sem .db, run em andamento…",
    suggestions: [
      "Projeto sem telemetria habilitada",
      "Schema muda e a view quebra",
      "Run em andamento polui a lista",
    ],
    cannedAnswer:
      "Projeto sem `metrics:` não tem `.db` — precisa de empty-state, não de erro.",
  },
];

/** Growing document content, keyed by the question that produced it. */
export const DOC_CHUNKS: Record<
  string,
  { doc: "spec" | "plan" | "todo"; text: string }
> = {
  problem: {
    doc: "spec",
    text: "## Problema\n\nQuando o run acaba, o Kanban zera. Não há como responder “esse projeto está melhorando?” sem abrir o SQLite na mão.",
  },
  users: {
    doc: "spec",
    text: "## Quem usa\n\nO próprio operador do loopy, logo após um run e no início da semana (tendência).",
  },
  "scope-out": {
    doc: "spec",
    text: "## Fora de escopo\n\n- Exportação (CSV/JSON)\n- Comparação entre projetos\n- Qualquer escrita — a tela é read-only",
  },
  accept: {
    doc: "spec",
    text: "## Critérios de aceite\n\n1. Num projeto com `.db`, a aba lista os últimos 20 runs (mais recente primeiro).\n2. Cada linha mostra duração, tasks concluídas e quantas escalaram.\n3. Clicar num run abre as tasks daquele run.\n4. Projeto sem `metrics:` mostra empty-state, não erro.",
  },
  where: {
    doc: "plan",
    text: "## Onde encaixa\n\nSub-modo da aba **Insights** (`src/insights/`), não um 5º segmento do `ViewSwitcher`.",
  },
  data: {
    doc: "plan",
    text: "## Dados\n\nView nova `v_run_history` em `.db/telemetry.db`, exposta pelo comando Rust SELECT-only já existente.",
  },
  risk: {
    doc: "plan",
    text: "## Riscos\n\n- Projeto sem telemetria: caminho de empty-state obrigatório (`.db` ausente ≠ erro).\n- Run em andamento aparece incompleto — marcar como “em curso”.",
  },
};

export interface DraftTask {
  readonly id: string;
  readonly title: string;
  readonly deps: readonly string[];
}

/** The `todo.md` every variant converges to. */
export const DRAFT_TASKS: readonly DraftTask[] = [
  {
    id: "T-001",
    title: "View v_run_history no schema da telemetria",
    deps: [],
  },
  {
    id: "T-002",
    title: "Comando Rust read_run_history (SELECT-only)",
    deps: ["T-001"],
  },
  {
    id: "T-003",
    title: "Lista de runs no sub-modo de Insights",
    deps: ["T-002"],
  },
  {
    id: "T-004",
    title: "Detalhe de um run (tasks + desfecho)",
    deps: ["T-003"],
  },
  { id: "T-005", title: "Empty-state para projeto sem .db", deps: ["T-003"] },
];

export function renderTodoMd(tasks: readonly DraftTask[]): string {
  return tasks
    .map((t) => {
      const deps = t.deps.length ? `\n  Deps: ${t.deps.join(", ")}` : "";
      return `- [ ] ${t.id} ${t.title}${deps}`;
    })
    .join("\n");
}

/** Assemble a document from the answers given so far. */
export function renderDoc(
  doc: "spec" | "plan" | "todo",
  answered: readonly string[],
): string {
  if (doc === "todo") {
    return answered.length >= QUESTIONS.length ? renderTodoMd(DRAFT_TASKS) : "";
  }
  const title =
    doc === "spec"
      ? "# Spec — Histórico de runs\n"
      : "# Plan — Histórico de runs\n";
  const body = answered
    .map((id) => DOC_CHUNKS[id])
    .filter(
      (c): c is { doc: "spec" | "plan" | "todo"; text: string } =>
        !!c && c.doc === doc,
    )
    .map((c) => c.text)
    .join("\n\n");
  return body ? `${title}\n${body}` : "";
}

/** Gaps the copilot variant (C) nags about, keyed by the answer that fixes them. */
export const GAPS: readonly {
  readonly questionId: string;
  readonly note: string;
}[] = [
  { questionId: "problem", note: "A spec não diz qual dor isso resolve." },
  {
    questionId: "scope-out",
    note: "Sem “fora de escopo”, o agente vai inventar features.",
  },
  {
    questionId: "accept",
    note: "Falta critério de aceite verificável — sem isso não dá pra fechar task.",
  },
  { questionId: "data", note: "O plan não diz de onde vêm os dados." },
  {
    questionId: "risk",
    note: "Nenhum risco listado. O que acontece num projeto sem `.db`?",
  },
];
