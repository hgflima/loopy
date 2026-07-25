/**
 * PROTOTYPE — throwaway. The canned devy roteiro for variant E.
 *
 * Mirrors the real commands in `.claude/commands/devy/`:
 *  - `/devy:spec`   → objetivo+usuários, features+aceite, stack, boundaries
 *  - `/devy:refine` → entrevista ramo a ramo, SEMPRE com resposta recomendada;
 *                     "if a question can be answered by exploring the codebase,
 *                     explore the codebase instead" → daí os nós `note`
 *  - `/devy:plan`   → fatia vertical, grafo de deps, checkpoints
 *  - `/devy:debug`  → hand-off com a descrição do issue
 */

export type Track = "feature" | "bug" | "debt";

export type Phase =
  | "projeto"
  | "triagem"
  | "descricao"
  | "spec"
  | "refine"
  | "plan"
  | "salvar"
  | "debug";

export const PHASE_LABEL: Record<Phase, string> = {
  projeto: "Projeto",
  triagem: "Triagem",
  descricao: "Demanda",
  spec: "Spec",
  refine: "Refine",
  plan: "Plan",
  salvar: "Salvar",
  debug: "Debug",
};

/** Which phases each track walks through — drives the footer trail. */
export const TRACK_PHASES: Record<Track | "unknown", readonly Phase[]> = {
  unknown: ["projeto", "triagem", "descricao"],
  feature: [
    "projeto",
    "triagem",
    "descricao",
    "spec",
    "refine",
    "plan",
    "salvar",
  ],
  bug: ["projeto", "triagem", "descricao", "debug"],
  debt: ["projeto", "triagem", "descricao", "debug"],
};

export interface Option {
  readonly label: string;
  /** One line on what picking this means. */
  readonly detail: string;
  /** Exactly one option per question may carry this. */
  readonly recommended?: boolean;
  /** Why it is recommended — shown inline, never hidden behind a tooltip. */
  readonly why?: string;
}

interface Base {
  readonly id: string;
  readonly phase: Phase;
  /** The devy command driving this question, shown as a chip. */
  readonly command: string;
}

export type Node =
  | (Base & {
      readonly kind: "choice";
      readonly prompt: string;
      readonly options: readonly Option[];
      /** Label of the free-text escape hatch. */
      readonly otherLabel?: string;
    })
  | (Base & {
      readonly kind: "text";
      readonly prompt: string;
      readonly hint?: string;
      readonly placeholder: string;
      readonly rows?: number;
    })
  /** The agent answered itself by reading the repo — no question asked. */
  | (Base & {
      readonly kind: "note";
      readonly prompt: string;
      readonly finding: string;
      readonly source: string;
    })
  /** Pick the target directory — everything downstream is written inside it. */
  | (Base & {
      readonly kind: "folder";
      readonly prompt: string;
      readonly hint: string;
    })
  | (Base & { readonly kind: "handoff"; readonly prompt: string })
  | (Base & { readonly kind: "save"; readonly prompt: string });

// ----------------------------------------------------------------- projeto

export interface RecentProject {
  readonly path: string;
  /** What the app can already tell about it — read, not asked. */
  readonly note: string;
  /** No `.harn/devy/changes` yet: the first change of that repo. */
  readonly fresh?: boolean;
}

export const RECENT_PROJECTS: readonly RecentProject[] = [
  {
    path: "~/dev/personal/acp-agentic-loop",
    note: "17 changes · última C-0017 · branch main limpa",
  },
  {
    path: "~/dev/liber/onboarding",
    note: "4 changes · última C-0004 · 2 alterações não commitadas",
  },
  {
    path: "~/dev/lab/kanban-example",
    note: "sem changes ainda — esta seria a primeira",
    fresh: true,
  },
];

export const PICK_FOLDER: Node = {
  kind: "folder",
  id: "project",
  phase: "projeto",
  command: "loopy",
  prompt: "Em qual projeto?",
  hint: "É onde spec.md, plan.md e todo.md vão ser gravados — e o diretório que o loop vai rodar depois.",
};

// ---------------------------------------------------------------- triagem

export const TRIAGE: Node = {
  kind: "choice",
  id: "track",
  phase: "triagem",
  command: "loopy",
  prompt: "O que vamos desenvolver hoje?",
  options: [
    {
      label: "Nova feature",
      detail: "Algo que ainda não existe. Vai passar por spec → refine → plan.",
      recommended: true,
      why: "É o caminho que produz os três arquivos que o loop precisa pra rodar (spec.md, plan.md, todo.md).",
    },
    {
      label: "Bug",
      detail:
        "Algo quebrado. Vai direto para /devy:debug — investigar antes de planejar.",
    },
    {
      label: "Débito técnico",
      detail:
        "Algo que funciona mas dói. Também começa investigando com /devy:debug.",
    },
  ],
  otherLabel: "Outro tipo de demanda…",
};

export const DESCRIBE: Record<Track, Node> = {
  feature: {
    kind: "text",
    id: "describe",
    phase: "descricao",
    command: "loopy",
    prompt: "Me conta mais sobre a demanda.",
    hint: "Escreva solto. Isso vira o argumento de /devy:spec — o resto eu pergunto.",
    placeholder: "Quero uma aba de histórico para ver os runs passados…",
    rows: 5,
  },
  bug: {
    kind: "text",
    id: "describe",
    phase: "descricao",
    command: "loopy",
    prompt: "O que está quebrado?",
    hint: "Sintoma, quando acontece, o que você já tentou. Isso vira o argumento de /devy:debug.",
    placeholder: "Ao merjar T-003 o app fecha sozinho e o run morre junto…",
    rows: 5,
  },
  debt: {
    kind: "text",
    id: "describe",
    phase: "descricao",
    command: "loopy",
    prompt: "Que débito é esse, e por que dói agora?",
    hint: "O que está torto e o custo de conviver com isso. Vira o argumento de /devy:debug.",
    placeholder:
      "O parseDeps engole a última dep quando a linha tem texto depois dos ids…",
    rows: 5,
  },
};

// ------------------------------------------------------- trilha da feature

export const FEATURE_SCRIPT: readonly Node[] = [
  {
    kind: "choice",
    id: "objective",
    phase: "spec",
    command: "/devy:spec",
    prompt: "Qual é o objetivo, em uma frase?",
    options: [
      {
        label: "Responder “esse projeto está melhorando?”",
        detail: "O foco é tendência ao longo do tempo, não o run isolado.",
        recommended: true,
        why: "É o que a sua descrição enfatiza (“quantas passaram, quais escalaram”) — métrica comparada, não log.",
      },
      {
        label: "Auditar um run específico depois que ele acaba",
        detail: "O foco é forense: reconstruir o que aconteceu numa execução.",
      },
      {
        label: "Ambos, com a tendência como tela inicial",
        detail: "Escopo maior — duas telas, não uma.",
      },
    ],
    otherLabel: "Escrever meu próprio objetivo…",
  },
  {
    kind: "choice",
    id: "acceptance",
    phase: "spec",
    command: "/devy:spec",
    prompt: "Qual é o critério de aceite mínimo?",
    options: [
      {
        label: "Lista os últimos 20 runs com duração, concluídas e escaladas",
        detail:
          "Verificável sem ambiguidade: abro num projeto com `.db` e conto as linhas.",
        recommended: true,
        why: "Critério fechado e testável — o loop precisa saber quando a task terminou, e “ficou bom” não fecha task.",
      },
      {
        label: "Mostra a evolução em um gráfico",
        detail: "Mais difícil de verificar objetivamente.",
      },
      {
        label: "Exporta os dados para análise externa",
        detail: "Você marcou exportação como fora de escopo antes.",
      },
    ],
  },
  {
    kind: "choice",
    id: "boundaries",
    phase: "spec",
    command: "/devy:spec",
    prompt: "Quais os limites — o que o agente NUNCA deve fazer aqui?",
    options: [
      {
        label: "Nunca escrever no `.db`; a tela é read-only",
        detail: "O leitor Rust continua SELECT-only, como o resto do Insights.",
        recommended: true,
        why: "A telemetria é insert-only por design (ADR-0011) — deixar a UI escrever quebraria a garantia dos fatos.",
      },
      {
        label: "Nunca alterar o schema existente",
        detail: "Só views novas, nenhuma migração de tabela.",
      },
      {
        label: "Sem limites especiais",
        detail: "O agente decide conforme for.",
      },
    ],
  },

  {
    kind: "note",
    id: "explored-schema",
    phase: "refine",
    command: "/devy:refine",
    prompt: "Não perguntei de onde vêm os dados — o código respondeu.",
    finding:
      "A telemetria já grava `run`, `task` e `step` por Tentativa, e o leitor Rust é SELECT-only. Dá pra servir a tela com uma view nova (`v_run_history`), sem migração.",
    source: "src/telemetry/schema.sql · apps/menubar/src-tauri/src/insights.rs",
  },
  {
    kind: "choice",
    id: "where",
    phase: "refine",
    command: "/devy:refine",
    prompt: "Onde essa tela mora na GUI?",
    options: [
      {
        label: "Sub-modo dentro da aba Insights",
        detail:
          "Insights ganha um seletor interno; o ViewSwitcher continua com 4 segmentos.",
        recommended: true,
        why: "O ViewSwitcher já tem 4 segmentos e o Insights já lê o mesmo `.db` — um 5º segmento paga custo de chrome por dado que já está ali.",
      },
      {
        label: "5ª aba no ViewSwitcher",
        detail: "Mais descobrível, mas aperta a barra de segmentos.",
      },
      {
        label: "Janela separada",
        detail: "Fora do fluxo; some da vista assim que você fecha.",
      },
    ],
  },
  {
    kind: "choice",
    id: "empty",
    phase: "refine",
    command: "/devy:refine",
    prompt: "E num projeto que nunca habilitou `metrics:`?",
    options: [
      {
        label: "Empty-state explicando como habilitar",
        detail:
          "Sem `.db` não é erro — é um projeto que ainda não optou pela telemetria.",
        recommended: true,
        why: "O app já trata arquivo ausente como `None`, não como falha; um erro aqui contradiz o resto da GUI.",
      },
      {
        label: "Esconder a aba inteira",
        detail: "Some sem explicar — o usuário não descobre que existe.",
      },
      {
        label: "Mostrar erro",
        detail: "Trata ausência de opt-in como defeito.",
      },
    ],
  },

  {
    kind: "choice",
    id: "slicing",
    phase: "plan",
    command: "/devy:plan",
    prompt: "Como fatiar as tasks?",
    options: [
      {
        label: "Vertical: cada task entrega um caminho completo",
        detail: "T-001 vai do SQL à tela, ainda que com uma coluna só.",
        recommended: true,
        why: "Cada task precisa passar os checks sozinha pra ser merjada; fatia horizontal deixa metade do caminho sem como verificar.",
      },
      {
        label: "Por camada: SQL, depois Rust, depois React",
        detail: "Tasks menores, mas nenhuma verificável isolada.",
      },
    ],
  },
  {
    kind: "choice",
    id: "parallel",
    phase: "plan",
    command: "/devy:plan",
    prompt: "As tasks de tela podem rodar em paralelo?",
    options: [
      {
        label: "Não — declarar Deps entre elas",
        detail: "Serializa T-004 e T-005 depois de T-003.",
        recommended: true,
        why: "As duas mexem nos mesmos arquivos do Insights; sem aresta de dependência elas conflitam no merge e o rebase não resolve.",
      },
      {
        label: "Sim — deixar as duas prontas juntas",
        detail: "Mais rápido no relógio, conflito provável no merge.",
      },
    ],
  },
  {
    kind: "save",
    id: "save",
    phase: "salvar",
    command: "/devy:plan",
    prompt: "Gravando a change.", // not rendered — the save screen is self-explanatory
  },
];

// ------------------------------------------------------------ trilha bug

export const DEBUG_SCRIPT: readonly Node[] = [
  {
    kind: "choice",
    id: "repro",
    phase: "debug",
    command: "/devy:debug",
    prompt: "Isso reproduz de forma consistente?",
    options: [
      {
        label: "Sim, todo run",
        detail: "Reprodução determinística — dá pra bissectar.",
        recommended: true,
        why: "Se reproduz sempre, a investigação começa por evidência em vez de hipótese — é o caminho mais curto até a causa raiz.",
      },
      {
        label: "Às vezes",
        detail:
          "Intermitente: a investigação vai precisar de logs de várias execuções.",
      },
      {
        label: "Aconteceu uma vez só",
        detail: "Sem repro, começa por coleta de evidência.",
      },
    ],
  },
  {
    kind: "text",
    id: "evidence",
    phase: "debug",
    command: "/devy:debug",
    prompt: "Que evidência você já tem?",
    hint: "Mensagem de erro, exit code, trecho de log, o que mudou pouco antes. Vai junto no /devy:debug.",
    placeholder: "O sidecar sai com código 143 e o stderr fica vazio…",
    rows: 4,
  },
  {
    kind: "handoff",
    id: "handoff",
    phase: "debug",
    command: "/devy:debug",
    prompt: "Pronto pra investigar.",
  },
];

// --------------------------------------------------------- output canned

export const CHANGE_DIR = ".harn/devy/changes/C-0018-historico-de-runs";

/** Names only — the save screen reports what was written, never its contents. */
export const SAVED_FILE_NAMES: readonly string[] = [
  "spec.md",
  "plan.md",
  "todo.md",
];

export const SAVED_FILES: readonly {
  readonly name: string;
  readonly body: string;
}[] = [
  {
    name: "spec.md",
    body: `# Spec — Histórico de runs

## Objetivo

Responder "esse projeto está melhorando?" a partir dos runs já executados.

## Critérios de aceite

1. Num projeto com \`.db\`, lista os últimos 20 runs (mais recente primeiro).
2. Cada linha mostra duração, tasks concluídas e quantas escalaram.
3. Projeto sem \`metrics:\` mostra empty-state, não erro.

## Boundaries

- NUNCA escrever no \`.db\` — a tela é read-only.`,
  },
  {
    name: "plan.md",
    body: `# Plan — Histórico de runs

## Onde encaixa

Sub-modo da aba **Insights**. O \`ViewSwitcher\` continua com 4 segmentos.

## Dados

View nova \`v_run_history\`; leitor Rust SELECT-only já existente.

## Fatiamento

Vertical — cada task vai do SQL à tela. T-004 e T-005 dependem de T-003
(mesmos arquivos: paralelizar geraria conflito de merge).`,
  },
  {
    name: "todo.md",
    body: `- [ ] T-001 View v_run_history no schema da telemetria
- [ ] T-002 Comando Rust read_run_history (SELECT-only)
  Deps: T-001
- [ ] T-003 Lista de runs no sub-modo de Insights
  Deps: T-002
- [ ] T-004 Detalhe de um run (tasks + desfecho)
  Deps: T-003
- [ ] T-005 Empty-state para projeto sem .db
  Deps: T-004`,
  },
];
