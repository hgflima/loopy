# Spec: C-0009 — Native UI (menu bar app, macOS)

> Recomeço limpo. A primeira tentativa desta change foi abandonada (vive só na
> branch `backup/pre-reset-c0009-b51f2ce`); **não** é fonte para este spec.

## Objective

Entregar uma **aplicação desktop nativa de barra de menus (macOS)** que espelha,
ao vivo, o mesmo estado que a TUI do `loopy` mostra — dando ao usuário um painel
sempre-à-mão do Run corrente sem ocupar um terminal.

**Usuário:** o dev que roda o `loopy` sobre um repo-alvo e quer acompanhar o
progresso do loop (e aprovar/reprovar merges) por uma janela nativa em vez da
TUI no terminal.

**Paridade de recursos com a TUI (requisito central):**
- **Grafo de execução** — DAG de tasks com o mesmo layout da TUI.
- **Animação da task ativa** — pulso/realce da(s) task(s) em `running`.
- **Lista de tasks com status** — glifo + id + step atual + status por task.
- **Stream de shell/agente** — tail da saída da(s) task(s) rodando.
- **Kanban** — segunda vista, com **os Steps do pipeline como colunas**; o card
  de cada task vive na coluna do seu Step corrente; um Desvio (`goto`) aparece
  como o card voltando a uma coluna anterior.
- **Gate de Aprovação** — o Step de Aprovação (no Merge) pausa o Run; o app
  mostra o prompt (janela + notificação do sistema) e devolve a decisão.

**Sucesso:** abrir o `.app`, ver o ícone na barra de menus, lançar um Run local
sobre um repo-alvo e acompanhá-lo ponta-a-ponta (grafo + Kanban + streams + gate)
**sem Node instalado na máquina** — tudo self-contained.

## Tech Stack

- **Stack webview:** React 18 + Vite + `@xyflow/react` (React Flow v12) + `@tauri-apps/api` v2.
- **Stack nativa:** Tauri v2 (Rust), plugins `shell` (sidecar), `positioner`, `dialog`, `notification`.
- **Reuso do motor (AD-6, sem fork):** o app importa a **fonte de estado pura**
  do `loopy` via subpath exports — `reduce`/`initialState`/`StoreState`/`StoreEvent`
  de `loopy/tui/store` e `computeDagreLayout`/`COLORS`/`pulseFrame` de `loopy/tui/view`.
  **Nunca** reimplementa `reduce` nem o layout.
- **Monorepo:** npm workspaces (`apps/*`). O **motor** permanece React **19** (Ink);
  o **app** usa React **18** (React Flow) — `node_modules` separados por workspace.
- **Transport (canal motor→app):** NDJSON duplex sobre stdout/stdin do sidecar
  (Events no stdout, Commands no stdin, stderr = diagnóstico). Gated por `--emit-events`.
- **Empacotamento:** o `loopy` compilado num binário self-contained via
  `bun build --compile`, embarcado por `externalBin` do Tauri.

## Commands

```
# Root (motor + agrega o workspace)
Typecheck:   npm run typecheck          # tsc do motor + tsc -p apps/menubar
Lint:        npm run lint               # eslint . (ignora src-tauri/, target/, dist/)
Test:        npm test                   # vitest (motor + webview)
Build motor: npm run build              # tsup → dist/

# App (workspace apps/menubar)
Dev (nativo):  npm run dev -w apps/menubar        # tauri dev (Vite + Rust, hot reload)
Dev (webview): npm run dev:web -w apps/menubar     # Vite standalone, feed NDJSON mockado
Sidecar bin:   npm run build:sidecar -w apps/menubar   # bun --compile → src-tauri/bin/loopy-<triple>
Build .app:    npm run build -w apps/menubar       # build:sidecar && tauri build → .app/.dmg
Atalho root:   npm run menubar                     # = npm run dev -w apps/menubar

# Rust
Clippy: cargo clippy --manifest-path apps/menubar/src-tauri/Cargo.toml
Test:   cargo test   --manifest-path apps/menubar/src-tauri/Cargo.toml
```

## Project Structure

```
package.json                 → root: workspaces + subpath exports (loopy/tui/store, loopy/tui/view)
src/                         → motor loopy (inalterado exceto o seam do Transport)
  tui/store.ts               → + `pipeline_declared` na união StoreEvent; reducer grava StoreState.pipeline
  tui/view.ts                → + computeDagreLayout puro (fonte única de layout; layoutGraph vira wrapper)
  tui/transport.ts           → NOVO: createEventTransport(sink) — tee NDJSON best-effort, nunca lança
  tui/approval.ts            → + variante UiPort via stdin (approval_requested → approval_decision)
  tui/start.ts, index.ts     → wiring --emit-events (fan-out dispatch, logs→stderr, run_started/finished)
apps/menubar/
  package.json               → Vite + React 18 + @xyflow/react + @tauri-apps/api
  src/main.tsx               → bootstrap; mock feed gated por !isTauri() (dev:web)
  src/App.tsx                → shell do dashboard; IS_TAURI = isTauri()
  src/state/store-bridge.ts  → applyLine(NDJSON) → roteia control vs StoreEvent → reduce
  src/graph/                 → DepsFlow (React Flow, posições de computeDagreLayout) + TaskNode
  src/kanban/                → KanbanBoard (Steps como colunas) + grouper puro
  src/panes/                 → ViewSwitcher, StreamPanel, ApprovalPrompt, LaunchConfig
  src/popover/               → glance + resumo do tray
  src-tauri/
    src/main.rs              → Builder + TrayIcon + janela + comandos (start_sidecar, set_title, approval)
    src/sidecar.rs           → spawn do sidecar, stdout→emit, stdin←commands, nunca unwrap() em I/O
    tauri.conf.json          → janela + tray + externalBin(bin/loopy)
    bin/                      → loopy-<target-triple> (gerado, gitignored)
docs/adrs/0007-*.md          → ADR do Transport NDJSON duplex p/ Native UI
.harn/devy/changes/C-0009-native-ui-menubar/  → este spec, plan, todo, DESIGN
```

## Code Style

TypeScript ESM, componentes puros de `StoreState` (nenhum estado de domínio
duplicado — a fonte é sempre `reduce`). Detecção de runtime **sempre** via helper
oficial:

```ts
import { isTauri } from "@tauri-apps/api/core";

// Tauri v2 NÃO injeta window.__TAURI__ sem app.withGlobalTauri. isTauri() checa
// window.isTauri, sempre presente no webview. NUNCA usar `"__TAURI__" in window`.
const IS_TAURI = isTauri();
```

Rust: nunca `unwrap()`/`expect()` em I/O do sidecar (um sidecar morto não pode
derrubar o app host); erros de I/O viram `Result<_, String>` propagado ao webview.

## Testing Strategy

- **Motor (vitest):** o `reduce` continua **exaustivo** sobre `StoreEvent` (sem
  `default`); teste dourado de `layoutGraph`/`renderGraph` byte-idêntico após a
  extração de `computeDagreLayout`; round-trip NDJSON de cada variante de
  Event/Command sem perda; **`RunLoopResult` byte-idêntico com/sem `--emit-events`** (AD-1).
- **Webview (vitest + Testing Library):** teste de paridade do store-bridge
  (serialize→parse→reduce == in-process); grouper do Kanban puro; TaskNode
  renderiza `COLORS[status]` + pulso no `running` (RTL + `ReactFlowProvider`).
- **Rust (cargo test):** framing de linha do stdout; formatação NDJSON do
  `approval_decision`.
- **Manual:** rodar um Run real sobre um repo-fixture e ver grafo/Kanban/streams
  atualizarem ao vivo; crash do sidecar não derruba o app; gate ponta-a-ponta.

## Boundaries

- **Always:**
  - Reusar `reduce`/`computeDagreLayout` do motor (AD-6) — o app é apresentação pura.
  - Manter o Transport **aditivo e gated** por `--emit-events`; com off, o Run é byte-idêntico (AD-1).
  - `isTauri()` para detecção de runtime.
  - Rust tolerante: nunca `unwrap()` em I/O do sidecar; webview tolera sidecar morto.
- **Ask first:**
  - Mudar o contrato do Transport (novos Events/Commands) ou o schema do `loopy.yml`.
  - Adicionar dependências pesadas (novos plugins Tauri, libs de grafo alternativas).
  - Qualquer coisa que faça o app **mutar** o Run além do gate de aprovação.
- **Never:**
  - Reimplementar/forkar `reduce` ou `computeDagreLayout`.
  - Deixar o React Flow rodar auto-layout (diverge da TUI).
  - Usar `"__TAURI__" in window` para detecção (bug conhecido — esconde a UI).
  - Expor painel de ACP/logs no app (paridade estrita com a TUI).
  - Bloquear o motor quando o app desconecta (Transport é best-effort).

## Success Criteria

1. `npm run typecheck && npm run lint && npm test` verdes na raiz, cobrindo o webview.
2. `import { reduce } from "loopy/tui/store"` resolve no Vite (subpath export vivo).
3. `loopy --no-tui --emit-events <dir>` emite `run_started`→`pipeline_declared`→…progresso…→`run_finished`
   em NDJSON no stdout; `RunLoopResult` **byte-idêntico** com/sem a flag.
4. `npm run menubar` abre o app; ícone aparece na barra de menus; **grafo** reflete
   o mesmo layout dagre da TUI; task ativa pulsa; lista de status correta.
5. **Kanban** com Steps como colunas; card na coluna do Step corrente; um `goto`
   volta o card à coluna anterior.
6. Um Step de Aprovação pausa o Run; o app mostra prompt + notificação; aprovar
   prossegue o merge, reprovar escala — igual ao gate da TUI.
7. `tauri build` gera um `.app` que lança/observa um Run local ponta-a-ponta
   **sem Node** na máquina.

## Assumptions

1. id da change = `C-0009-native-ui-menubar` (slot livre; a tentativa antiga está só no backup).
2. Este spec vive na pasta da change, **não** na raiz.
3. Motor React 19 (Ink) + app React 18 (React Flow), workspaces isolados.
4. Empacotamento self-contained via `bun build --compile` + `externalBin`.

## Decisões do refino (2026-07-08)

Resolvidas via `/devy:refine`. As três Open Questions originais fecharam (ver 1–3);
o resto emergiu ao aterrissar em `store.ts`/`view.ts`/`approval.ts`.

1. **Multi-Run = um por vez** (Assumption #3 confirmada). O app spawna/observa UM
   sidecar; relançar mata o antigo e troca. `StoreState` único, um binário embarcado.
2. **Tray = popover-glance + janela plena.** Clique no ícone abre um popover compacto
   (`done/total · running · ⚠`, botões Abrir/Parar); "Abrir" expande a janela plena
   (Kanban/Deps + streams). LaunchConfig e glance vivem no popover.
3. **Persistência do LaunchConfig = lembrar último dir + flags**, num JSON simples via
   Rust `fs` no app-config-dir (sem novo plugin). Reabrir pré-preenche.
4. **Quit com Run ativo:** fechar a **janela** só a esconde (app segue na barra, Run
   continua); **sair** de verdade (Cmd+Q / menu do tray) com Run ativo **pede
   confirmação** antes de matar o sidecar (o checkpoint `.loopy/state.json` torna
   resumível, mas um step no meio merece aviso).
5. **Painel de streams = uma coluna por task em `running`** (espelha a região Streams
   da TUI sob paralelo). Em `concurrency 1` colapsa numa coluna. **Sem** pin/seleção
   de task; nós do grafo e cards do Kanban não focam stream.
6. **Kanban = Backlog → Steps → Fim.** Coluna inicial "Backlog" (pending/blocked, sem
   Step corrente); uma coluna por Step do pipeline declarado; coluna terminal "Fim"
   à direita recebe todo card terminal (done/escalated/skipped/paused) com o glifo/cor
   de `COLORS.task`. Um `goto` = card volta a uma coluna anterior. Card **escalated**
   exibe **o Step onde falhou** (senão perde-se "onde quebrou").
7. **Gate de Aprovação:** a notificação do sistema **só alerta**; clicar traz a
   janela/popover à frente com o prompt + botões **Aprovar/Reprovar** explícitos
   (o plugin `notification` do Tauri tem suporte irregular a action-buttons — a
   decisão vive numa superfície confiável). Tray ganha badge ⚠. FIFO, igual ao
   `ApprovalController` Ink. Transport: `approval_requested{requestId,taskId,stepId,
   summary}` (stdout) → `approval_decision{requestId,approved}` (stdin).
8. **Notificações do sistema:** aprovação (**sempre**), `run_finished` (backlog
   zerado) e task **escalated/paused**. **Nunca** por-task-`done` (ruído).
9. **Vista default = Kanban**; o ViewSwitcher alterna pro grafo Deps. Ambas construídas.
10. **Falha do sidecar = banner com tail do stderr, nunca derruba o app.** Falha ao
    iniciar (exit sem `run_started`) → banner "Run não iniciou: <motivo>" + volta ao
    LaunchConfig. Morte no meio → congela o último `StoreState` + banner "Run encerrado
    (exit N)" + badge. Rust propaga `Result<_, String>` ao webview.
11. **LaunchConfig expõe:** picker de diretório-alvo + toggle `--yes` (default **OFF** —
    o gate é recurso-título, SC #6) + campo `--task <id>` + toggle `--verbose`. Ressalva:
    sem painel de logs, `--verbose` só engorda o stderr encaminhado ao console (não cria
    view). O app sempre injeta `--no-tui --emit-events`; `--dry-run` fora do v1.
12. **Identidade macOS = accessory por padrão** (LSUIElement: sem Dock, só barra de
    menus); enquanto a **janela plena** está aberta, troca pra `regular` (Dock + Cmd+Tab,
    focusável) e volta a accessory ao esconder.

### Assumptions de build (não interviewadas)

- **Arch do sidecar:** binário `bun --compile` para o **host** (arm64 macOS); universal
  binary fora do v1.
- **`COLORS` → CSS:** os nomes de cor de `view.ts` (`cyan`/`green`/`red`/`yellow`/
  `magenta`/`gray`) são todos keywords CSS válidas → reuso direto no React Flow, sem
  camada de tradução.
- **Pulso:** um único tick (`setInterval` no `App`) alimenta `pulseFrame(tick)` nos nós;
  não replicar timers por nó (mesma disciplina da TUI).
```

