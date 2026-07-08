# Backlog: C-0009 — Native UI (menu bar app, macOS)

> Consumido pelo motor (`- [ ]` pendente / `- [x]` concluída; id `T-\d+`; corpo indentado).
> A linha `Deps:` é canônica (`task.deps`) — mantida **isolada** (sem texto após os ids).
> Invariantes em toda task: **AD-1** (app só observa; Transport aditivo/gated por
> `--emit-events`; `RunLoopResult` byte-idêntico com/sem a flag) e **AD-6**
> (apresentação pura — reusa `reduce`/`computeDagreLayout`, nunca forka).
> Narrativa, dependency graph, checkpoints e riscos: ver `plan.md` (mesma pasta).

## Fase 0 — Fundação (T-001)

- [ ] T-001: Monorepo npm workspaces + subpath exports (`loopy/tui/store`, `loopy/tui/view`)
    Root `package.json` ganha `"workspaces": ["apps/*"]` e um mapa `"exports"` com
    `"."` (bin atual), `"./tui/store"` → `./dist/tui/store.js` (+ `types`) e
    `"./tui/view"` → `./dist/tui/view.js` (+ `types`). `tsup.config` ganha esses dois
    entry points (múltiplos entries, `dts:true`). `store.ts`/`view.ts` já são puros
    (zero React) — o export não arrasta Ink. Nada do comportamento do motor muda.
    Aceite: `npm run build` emite `dist/tui/store.js`/`dist/tui/view.js` + `.d.ts`;
    `import { reduce } from "loopy/tui/store"` e `import { computeDagreLayout } from "loopy/tui/view"`
    resolvem (script/teste node de smoke); `loopy --version` e o bin seguem funcionando.
    Verificação: `npm run build` && `npm run typecheck` && node -e "import('loopy/tui/store')".
    Deps: nenhuma
    Files: package.json, tsup.config.ts, tsconfig.json, teste de smoke de import. Scope: S.

## Fase 1 — Engine seams (T-002 ∥ T-003 ∥ T-004 ∥ T-005 → T-006)

- [ ] T-002: Extrair `computeDagreLayout` puro (fonte única de layout; `layoutGraph` vira wrapper)
    Em `view.ts` (`layoutGraph` `:325-517`): extrair a construção dagre + snap +
    compactação vertical + montagem de arestas para `computeDagreLayout(edges, statusById, order): GraphGeometry`.
    `layoutGraph` passa a **delegar** a ele (wrapper fino, assinatura pública intacta).
    `renderGraph` inalterado. Exportar `computeDagreLayout`, `COLORS`, `pulseFrame`
    (já exportados) pelo subpath `loopy/tui/view`. Pura (AD-6, zero React/I/O).
    Aceite: teste **dourado byte-idêntico** — `layoutGraph(...)` e `renderGraph(...)`
    produzem a mesma saída antes/depois da extração (diamante A→{B,C}→D + cadeia
    linear + nó isolado); `computeDagreLayout` chamável direto e determinístico.
    Verificação: `npm test -- tui` && `npm run typecheck`.
    Deps: nenhuma
    Files: src/tui/view.ts, src/tui/view.test.ts. Scope: M. RISCO ALTO.

- [ ] T-003: `StoreState.pipeline` + evento `pipeline_declared` + orquestrador o emite
    `StoreState` ganha `pipeline: readonly { id: string; type: StepType }[]` (default `[]`
    em `initialState`). União `StoreEvent` ganha `{ type: "pipeline_declared"; steps: readonly {id;type}[] }`;
    o `reduce` (switch **exaustivo**, sem `default`) grava `state.pipeline`. O
    orquestrador emite `pipeline_declared` (dos `config.pipeline` na ordem declarada,
    id+type) logo após `edges_set` (`orchestrator.ts:1331`). Aditivo — nenhuma view
    do motor consome `pipeline` ainda.
    Aceite: `reduce` continua exaustivo por `StoreEvent` (compila sem `default`);
    `pipeline_declared` grava a lista ordenada; evento duplicado é idempotente;
    `edges_set`/`task_*`/`stream_chunk` inalterados; `RunLoopResult` byte-idêntico.
    Verificação: `npm test -- tui` && `npm test -- orchestrator` && `npm run typecheck`.
    Deps: nenhuma
    Files: src/tui/store.ts, src/loop/orchestrator.ts, testes. Scope: M.

- [ ] T-004: `tui/transport.ts` — `createEventTransport(sink)` NDJSON duplex + ADR-0007
    NOVO módulo puro (sem React): serializa cada `StoreEvent` + os frames **control**
    (`run_started{...}`, `run_finished{result}`, `approval_requested{requestId,taskId,stepId,summary}`)
    como **uma linha NDJSON** no `sink` (best-effort — engole exceção, **nunca lança**,
    AD-1). Parser dual (`parseTransportLine`) que roteia control vs StoreEvent. Escrever
    ADR-0007 registrando o contrato (duas classes de frame; Events stdout / Commands
    stdin / stderr diagnóstico). Sem wiring aqui.
    Aceite: round-trip **sem perda** de cada variante Event **e** de cada control frame
    (serialize→parse→igual); linha malformada não derruba o parser (retorna erro-valor);
    um `sink` que lança é engolido pelo transport; ADR-0007 criado.
    Verificação: `npm test -- transport` && `npm run typecheck`.
    Deps: nenhuma
    Files: src/tui/transport.ts (novo), src/tui/transport.test.ts, docs/adrs/0007-*.md. Scope: M.

- [ ] T-005: Aprovação via stdin — variante `UiPort` (`approval_requested`→`approval_decision`)
    Em `approval.ts`: nova fábrica `createStdinApproval({ emit, input })` que implementa
    `UiPort.requestApproval(prompt)` emitindo um control `approval_requested{requestId,...}`
    (via `emit`) e resolvendo quando chega a linha `approval_decision{requestId,approved}`
    no `input`. **FIFO** por `requestId` (espelha o `ApprovalController` Ink);
    parsing de `approval_decision` puro e testado. Não altera as fábricas existentes.
    Aceite: request pendente resolve com o `approved` do decision de `requestId` casado;
    dois requests concorrentes resolvem FIFO sem clobber; decision órfão/malformado é
    ignorado (não resolve nada); `parseApprovalDecision` puro testado.
    Verificação: `npm test -- approval` && `npm run typecheck`.
    Deps: nenhuma
    Files: src/tui/approval.ts, src/tui/approval.test.ts. Scope: M.

- [ ] T-006: Wire `--emit-events` (fan-out dispatch, logs→stderr, run_started/finished)
    Commander ganha `--emit-events` (`index.ts:buildProgram` + `toFlags`/`RunFlags`).
    Sob a flag: `startUi`/`defaultRunLive` compõem o `dispatch` como **fan-out** — store
    ou line-reporter **E** `createEventTransport(stdout)`; emite `run_started` no início
    e `run_finished{result}` no fim; troca approval p/ `createStdinApproval` (stdin);
    logs vão **só** p/ stderr (stdout é o canal NDJSON). Flag off = caminho atual intacto.
    Aceite: `loopy --no-tui --emit-events <fixture>` emite
    `run_started`→`pipeline_declared`→…progresso…→`run_finished` em NDJSON no stdout (SC #3);
    stdout **só** NDJSON (logs em stderr); `approval_decision` via stdin decide o gate;
    **`RunLoopResult` byte-idêntico com e sem `--emit-events`** (teste AD-1); flag off =
    saída byte-idêntica ao atual.
    Verificação: `npm test -- index` && `npm run typecheck` && `npm run lint`.
    Deps: T-003, T-004, T-005
    Files: src/index.ts, src/tui/start.ts, src/types.ts, testes. Scope: M. RISCO ALTO.

## Checkpoint 1 — Engine seams

    typecheck/lint/test verdes na raiz; `loopy --no-tui --emit-events <fixture>`
    emite o fluxo NDJSON ponta-a-ponta; `RunLoopResult` byte-idêntico com/sem a flag
    (AD-1); SC #2 e SC #3 verificados. Revisão humana antes de abrir o app.

## Fase 2 — Scaffold + estado vivo (T-007 → T-008; T-009)

- [ ] T-007: Scaffold do app Tauri (`apps/menubar`) — Vite + React 18 + xyflow + tauri api
    Workspace `apps/menubar`: `package.json` (Vite, React 18, `@xyflow/react`,
    `@tauri-apps/api` v2), `vite.config`, `tsconfig`, `src/main.tsx`+`src/App.tsx`
    (shell mínimo), `src-tauri/` (Cargo.toml, `tauri.conf.json`, `main.rs` mínimo com
    Builder). Helper de runtime `IS_TAURI = isTauri()` (**nunca** `"__TAURI__" in window`).
    Scripts: `dev` (tauri dev), `dev:web` (Vite standalone), `build:sidecar`, `build`.
    Root `npm run typecheck`/`lint` incluem `apps/menubar` e ignoram `src-tauri/`/`target/`/`dist/`.
    Aceite: `npm run dev:web -w apps/menubar` abre um shell Vite vazio; `cargo clippy`
    e `cargo test` (manifest do app) rodam; `import { reduce } from "loopy/tui/store"`
    resolve no Vite (SC #2); `isTauri()` retorna false no `dev:web`.
    Verificação: `npm run dev:web -w apps/menubar` (smoke) && `cargo clippy --manifest-path apps/menubar/src-tauri/Cargo.toml`.
    Deps: T-001
    Files: apps/menubar/package.json, apps/menubar/vite.config.ts, apps/menubar/tsconfig.json, apps/menubar/src/{main,App}.tsx, apps/menubar/src-tauri/{Cargo.toml,tauri.conf.json,src/main.rs}. Scope: M. RISCO ALTO.

- [ ] T-008: `store-bridge.ts` — `applyLine(NDJSON)` → roteia control vs StoreEvent → `reduce`
    `src/state/store-bridge.ts`: `applyLine(state, line)` parseia uma linha NDJSON
    (reusa o parser/contrato do Transport, T-004), roteia frame **control** (run_started/
    run_finished/approval_requested → estado de UI) vs **StoreEvent** (→ `reduce` importado
    de `loopy/tui/store`). Feed mockado em `dev:web` (`!isTauri()`) alimenta uma sequência
    NDJSON de exemplo. Nenhum estado de domínio duplicado (AD-6).
    Aceite: **paridade** — aplicar a sequência serializada via `applyLine` produz o
    mesmo `StoreState` que reduzir os eventos in-process (`reduce`); control frames
    atualizam só o estado de UI (não o `StoreState`); linha malformada é ignorada sem
    quebrar; feed mockado do `dev:web` reduz e popula tasks.
    Verificação: `npm test -w apps/menubar -- store-bridge`.
    Deps: T-007, T-003, T-004
    Files: apps/menubar/src/state/store-bridge.ts, apps/menubar/src/main.tsx (mock feed), testes. Scope: M.

- [ ] T-009: Rust `sidecar.rs` — spawn do sidecar, stdout→emit, stdin←commands (tolerante)
    `src-tauri/src/sidecar.rs` + comando `start_sidecar(dir, flags)` em `main.rs`:
    spawna o `externalBin` `loopy` com `--no-tui --emit-events <dir> [flags]`, lê stdout
    **linha-a-linha** e **emite** cada linha ao webview (evento Tauri `sidecar://line`);
    stdin recebe Commands (`approval_decision`, escritos por um comando `send_command`);
    stderr → evento `sidecar://stderr`. **Nunca** `unwrap()`/`expect()` em I/O — erros
    viram `Result<_, String>`. Um sidecar morto emite `sidecar://exit{code}` e não derruba
    o host. Webview conecta os eventos ao `applyLine` (T-008).
    Aceite: `cargo test` do framing de linha (linhas parciais/múltiplas por chunk);
    stdout do sidecar chega ao webview via evento e reduz para `StoreState`;
    `approval_decision` escrito no stdin do sidecar; matar o sidecar emite `exit` sem
    panic no host; erro de spawn vira `Result::Err(String)`.
    Verificação: `cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml` && Run real (manual).
    Deps: T-007, T-006
    Files: apps/menubar/src-tauri/src/sidecar.rs, apps/menubar/src-tauri/src/main.rs, apps/menubar/src/state/store-bridge.ts (wiring), tauri.conf.json (externalBin). Scope: M. RISCO ALTO.

## Checkpoint 2 — Estado vivo

    O app recebe NDJSON de um sidecar real e reduz para `StoreState` (contagem
    done/total correta num Run real); crash do sidecar não derruba o app. Revisão humana.

## Fase 3 — Grafo Deps (T-010)

- [ ] T-010: `DepsFlow` (React Flow, posições de `computeDagreLayout`) + `TaskNode`
    `src/graph/DepsFlow.tsx` + `src/graph/TaskNode.tsx`: nós posicionados **por**
    `computeDagreLayout` (de `loopy/tui/view`) — **jamais** auto-layout do React Flow;
    `TaskNode` colore por `COLORS.task[status]` (keywords CSS diretas) e **pulsa** no
    `running` via `pulseFrame(tick)`, com um **único** tick (`setInterval` no `App`,
    não timer por nó). Arestas Deps do `StoreState.edges`.
    Aceite: posições dos nós batem `computeDagreLayout` (sem auto-layout); `TaskNode`
    renderiza `COLORS[status]` e alterna o pulso por tick no `running` (RTL +
    `ReactFlowProvider`); grafo reflete o mesmo layout dagre da TUI (SC #4).
    Verificação: `npm test -w apps/menubar -- graph` && Run real (manual, SC #4).
    Deps: T-008, T-002
    Files: apps/menubar/src/graph/DepsFlow.tsx, apps/menubar/src/graph/TaskNode.tsx, apps/menubar/src/App.tsx (tick), testes. Scope: M.

## Fase 4 — Kanban (T-011 → T-012)

- [ ] T-011: Grouper do Kanban (puro) — Backlog → Steps → Fim + `goto`
    `src/kanban/grouper.ts`: função pura `groupByStep(state): Column[]` — coluna inicial
    **Backlog** (pending/blocked, sem Step corrente); **uma coluna por Step** do
    `pipeline` declarado (na ordem); coluna terminal **Fim** (done/escalated/skipped/paused).
    Card na coluna do `currentStepId`; card **escalated** exibe **o Step onde falhou**
    (senão perde-se "onde quebrou" — refino #6); um `goto` = card numa coluna **anterior**
    à última visitada. Zero React.
    Aceite: sem `pipeline` → só Backlog+Fim; card em `running` cai na coluna do
    `currentStepId`; terminal → coluna Fim; `escalated` reporta o Step da falha; card que
    voltou por `goto` aparece na coluna anterior; determinístico.
    Verificação: `npm test -w apps/menubar -- kanban`.
    Deps: T-008
    Files: apps/menubar/src/kanban/grouper.ts, testes. Scope: M.

- [ ] T-012: `KanbanBoard` + `ViewSwitcher` (default Kanban → grafo Deps)
    `src/kanban/KanbanBoard.tsx` (colunas do grouper T-011; card com glifo/cor de
    `COLORS.task`; realce/pulso no card que acabou de voltar por `goto` — o fix-loop é a
    estrela, DESIGN §4) + `src/panes/ViewSwitcher.tsx` (default **Kanban**, alterna p/
    `DepsFlow`). Ambas as vistas construídas.
    Aceite: board mostra Backlog→Steps→Fim; card na coluna do Step corrente; um `goto`
    volta o card à coluna anterior com realce (SC #5); ViewSwitcher default Kanban e
    alterna p/ Deps sem perder estado.
    Verificação: `npm test -w apps/menubar -- kanban` && Run real (manual, SC #5).
    Deps: T-011
    Files: apps/menubar/src/kanban/KanbanBoard.tsx, apps/menubar/src/panes/ViewSwitcher.tsx, apps/menubar/src/App.tsx, testes. Scope: M.

## Checkpoint 3 — Vistas vivas

    Grafo Deps + Kanban renderizam ao vivo sobre um Run real; task ativa pulsa; um
    `goto` volta o card de coluna com realce. Revisão humana.

## Fase 5 — Streams + shell nativo (T-013; T-014 → T-015)

- [ ] T-013: `StreamPanel` — uma coluna por task em `running`
    `src/panes/StreamPanel.tsx`: espelha a região Streams da TUI — **uma coluna por task
    em `running`** (tail via `streamTail` de `loopy/tui/view`); em `concurrency 1` colapsa
    numa coluna. **Sem** pin/seleção; nós do grafo e cards do Kanban não focam stream
    (refino #5).
    Aceite: N tasks `running` → N colunas de stream; 1 task → 1 coluna; tail atualiza ao
    vivo; nenhuma interação de seleção; single-agent sem prefixo, multi-agente prefixa `[agent]`.
    Verificação: `npm test -w apps/menubar -- streams` && Run real (manual).
    Deps: T-008
    Files: apps/menubar/src/panes/StreamPanel.tsx, apps/menubar/src/App.tsx, testes. Scope: M.

- [ ] T-014: Tray + popover-glance + janela + identidade macOS accessory↔regular
    `main.rs`: `TrayIcon` (plugin `positioner`) + janela plena; clique no ícone abre um
    **popover** compacto (`src/popover/Glance.tsx`: `done/total · running · ⚠`, botões
    Abrir/Parar); "Abrir" expande a **janela plena**. Identidade macOS: **accessory** por
    padrão (`LSUIElement` — sem Dock); enquanto a janela plena está aberta, troca p/
    **regular** (Dock + Cmd+Tab, focusável) e volta a accessory ao esconder. Fechar a
    janela **só esconde** (app segue na barra, Run continua). Pulso do ícone ecoa
    `pulseFrame` (refino #12).
    Aceite: ícone aparece na barra (SC #4); clique abre o popover com glance correto;
    "Abrir" expande a janela e vira `regular`; esconder volta a `accessory`; fechar a
    janela não mata o Run; nenhum `unwrap()` em I/O.
    Verificação: `cargo clippy --manifest-path apps/menubar/src-tauri/Cargo.toml` && Run real (manual).
    Deps: T-009
    Files: apps/menubar/src-tauri/src/main.rs, apps/menubar/src-tauri/tauri.conf.json, apps/menubar/src/popover/Glance.tsx. Scope: M.

- [ ] T-015: `LaunchConfig` (picker + flags) + persistência + spawn/relaunch (um Run por vez)
    `src/panes/LaunchConfig.tsx`: picker de diretório-alvo (plugin `dialog`) + toggles
    `--yes` (default **OFF**, SC #6), `--task <id>`, `--verbose`. App **sempre** injeta
    `--no-tui --emit-events` (`--dry-run` fora do v1). Persistência = último dir + flags
    num JSON via Rust `fs` no app-config-dir (sem novo plugin); reabrir pré-preenche
    (refino #3). "Abrir" spawna via `start_sidecar` (T-009); **relançar mata o sidecar
    anterior** (um Run por vez, refino #1). Glance mostra `delegação: --yes ON/OFF · N gates`.
    Aceite: picker escolhe dir; flags refletem no comando; `--yes` default OFF; config
    persiste e pré-preenche no reabrir; relançar mata o sidecar antigo antes do novo;
    `--dry-run` ausente.
    Verificação: `cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml` (persist) && Run real (manual).
    Deps: T-014
    Files: apps/menubar/src/panes/LaunchConfig.tsx, apps/menubar/src-tauri/src/{main.rs,config.rs}, apps/menubar/src/popover/Glance.tsx. Scope: M.

## Fase 6 — Aprovação + sinal (T-016 → T-017)

- [ ] T-016: `ApprovalPrompt` + `approval_decision` via stdin + bring-to-front + badge ⚠
    `src/panes/ApprovalPrompt.tsx`: renderiza o `approval_requested` (contexto
    `task · step · summary` + o **custo de reprovar** = escala) com botões **Aprovar/
    Reprovar** explícitos; a decisão vira `approval_decision{requestId,approved}` no stdin
    do sidecar (via `send_command`, T-009). Notificação do sistema **só alerta**; clicar
    traz a janela/popover à frente com o prompt; tray ganha **badge ⚠**. FIFO (espelha o
    `ApprovalController` Ink). É a **única** superfície de mutação (AD-1).
    Aceite: um Step de Aprovação pausa o Run; app mostra prompt + notificação + badge ⚠;
    Aprovar prossegue o merge, Reprovar escala — igual ao gate da TUI (SC #6); FIFO com
    dois gates; notificação não carrega a decisão (só alerta).
    Verificação: `npm test -w apps/menubar -- approval` && Run real ponta-a-ponta (manual, SC #6).
    Deps: T-005, T-014, T-008
    Files: apps/menubar/src/panes/ApprovalPrompt.tsx, apps/menubar/src-tauri/src/main.rs (send_command, focus), apps/menubar/src/App.tsx, testes. Scope: M. RISCO ALTO.

- [ ] T-017: Política de notificação (approval / run_finished / escalated / paused; **nunca** por-task done)
    Plugin `notification`: notifica em **aprovação** (sempre), **`run_finished`** (backlog
    zerado) e task **escalated/paused**. **Nunca** por-task-`done` (ruído — disciplina de
    sinal, refino #8 / DESIGN §5). Centralizar a decisão num helper puro sobre os frames
    control/StoreEvent.
    Aceite: dispara exatamente nos 4 gatilhos; nenhuma notificação por `done`; helper
    puro testado (dado um evento → notifica sim/não).
    Verificação: `npm test -w apps/menubar -- notify`.
    Deps: T-016
    Files: apps/menubar/src/state/notify.ts, apps/menubar/src/App.tsx, testes. Scope: S.

## Fase 7 — Robustez + empacotamento (T-018 → T-019)

- [ ] T-018: Banners de falha do sidecar (start-fail → LaunchConfig; morte no meio → congela + badge)
    `src/panes/Banner.tsx` + estado de UI: falha ao **iniciar** (exit sem `run_started`) →
    banner "Run não iniciou: <motivo>" + volta ao LaunchConfig; **morte no meio** →
    **congela** o último `StoreState` + banner "Run encerrado (exit N)" + badge; banner
    carrega o **tail do stderr** (`sidecar://stderr`). Nunca derruba o app (refino #10).
    Aceite: exit sem `run_started` → banner de start-fail + LaunchConfig; morte no meio →
    último estado congelado + banner + badge + tail do stderr; app segue vivo em ambos.
    Verificação: `npm test -w apps/menubar -- banner` && simular crash (manual).
    Deps: T-009, T-008
    Files: apps/menubar/src/panes/Banner.tsx, apps/menubar/src/App.tsx, apps/menubar/src/state/store-bridge.ts, testes. Scope: M.

- [ ] T-019: `bun --compile` sidecar + `externalBin` + `tauri build` → `.app` sem Node
    Script `build:sidecar` (`bun build --compile` → `src-tauri/bin/loopy-<target-triple>`,
    gitignored) + `externalBin` no `tauri.conf.json`; `build` = `build:sidecar && tauri build`
    → `.app`/`.dmg`. Quit com Run ativo (Cmd+Q / menu do tray) **pede confirmação** antes
    de matar o sidecar (checkpoint torna resumível — refino #4). Binário p/ o host arm64
    (universal fora do v1).
    Aceite: `npm run build:sidecar -w apps/menubar` gera `bin/loopy-<triple>`;
    `npm run build -w apps/menubar` gera um `.app` que lança/observa um Run local
    ponta-a-ponta **sem Node** na máquina (SC #7); Cmd+Q com Run ativo pede confirmação.
    Verificação: `npm run build -w apps/menubar` && lançar o `.app` sem Node (manual, SC #7).
    Deps: T-015, T-016
    Files: apps/menubar/package.json (scripts), apps/menubar/src-tauri/tauri.conf.json, apps/menubar/src-tauri/src/main.rs (quit-confirm), .gitignore. Scope: M. RISCO ALTO.

## Checkpoint 4 — Complete

    SC #1–#7 satisfeitos: typecheck/lint/test verdes cobrindo o webview; `import { reduce }`
    resolve no Vite; `--emit-events` emite o fluxo NDJSON byte-idêntico; app abre com ícone
    na barra; grafo com layout dagre da TUI; Kanban com Steps-como-colunas e `goto`; gate
    de aprovação ponta-a-ponta; `.app` lança e observa um Run local **sem Node**. Revisão final.
