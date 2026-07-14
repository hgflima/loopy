# src (React) — a ponte de estado, as janelas e as views do Run

## Purpose & Scope
O frontend do app: roteia as 3 janelas, transforma linhas NDJSON do sidecar em estado React (`BridgeState`) e renderiza Kanban, grafo de deps, streams e gate de aprovação. **Não redefine o domínio**: `StoreState`/`TaskState`/`StepState`/`StoreEvent` vêm de `loopy/tui/store` e o reducer é o **do motor** — este módulo só adiciona estado *de UI*. Não decide nada do Run (AD-1): as únicas escritas de volta são a decisão de aprovação e as flags de launch.

## Entry Points & Contracts
- `main.tsx` — bootstrap. Uma única `index.html` serve as 3 janelas; a discriminação é por `getCurrentWindow().label` (`main`/`popover`/`about`). **`about` ramifica ACIMA do `Root`**, de propósito: sob o `Root` os effects (badge do tray, listeners do sidecar) rodariam duplicados nessa janela. Escuta `sidecar://line|stderr|exit` e roteia para `applyLine`/`applySidecarStderr`/`applySidecarExit`.
- `state/store-bridge.ts` — o coração, **puro**. `applyLine(state, line)`: frame `event` → `reduce()` do motor; `control` → `applyControl` (estado só-de-UI: `runStatus`, fila de aprovações, falhas); `command`/malformado → **mesma referência** (structural sharing, para o React não re-renderizar). Tipos UI-only (`UIState`, `ApprovalRequest`, `SidecarFailure`, `BridgeState`) nascem aqui.
- `state/stream-history.ts` — transcript **append-only** por task, taggeado pelo `currentStepId`; existe porque `task.stream` do store **reseta a cada step**. `overlayStepUsage` corrige um bug real: o `usage_sample` chega no **fim** do turno, depois dos chunks, então o snapshot do transcript tem `usedTokens: undefined` — a telemetria viva do step é a autoritativa.
- `state/notify.ts` — `shouldNotify`: exatamente **4 gatilhos** (`approval_requested`, `run_finished`, `task_finished`+`escalated`, `task_finished`+`paused`). **Nunca** notifica em `done`/`skipped` — é disciplina de sinal, não esquecimento.
- Aprovação: fila FIFO em `ui.pendingApprovals`; o gate abre o drawer **forçadamente** na task do head. A decisão vira NDJSON via `send_command` e é removida **otimisticamente** — o motor não dá ack.

## Usage Patterns
- **Kanban** (`kanban/`): `groupByStep` → colunas `Backlog → um por Step do pipeline (ordem declarada) → Fim`. `detectGotoCards` compara índices de coluna entre snapshots: índice que **diminui** = Desvio (goto), destacado por ~2,2 s. É a peça visual do fix-loop.
- **Grafo** (`graph/`): ReactFlow renderiza, mas as **posições vêm de `computeDagreLayout` de `loopy/tui/view`** — o mesmo dagre da TUI Ink — escaladas por `CELL_PX_*`. Auto-layout do ReactFlow é proibido; pan/zoom/drag/select desligados.
- **Pulso**: um **único** `setInterval` no `App.tsx` alimenta todos os nós (`pulseFrame(tick)`). Não crie timer por componente.
- **Streams** (`panes/StreamPanel.tsx`): no máximo 4 painéis + chip "＋N rodando"; auto-stick no scroll; altura por divisor arrastável persistido em localStorage.
- `npm run dev:web` roda sem Tauri: `isTauri()` é false e o `MOCK_FEED` injeta 22 linhas NDJSON a cada 300 ms, exercitando o `applyLine` inteiro. É o caminho rápido para mexer em UI sem subir o Rust.

## Anti-patterns
- **Não capturar `isTauri()` no escopo do módulo.** `main.tsx` e `LaunchConfig.tsx` fazem `const IS_TAURI = isTauri()` no topo — **não é mockável em teste**. O padrão-alvo é o do `popover/Glance.tsx`: chamar `isTauri()` no ponto de uso. (E nunca testar `"__TAURI__" in window`.)
- Não redefinir tipos do domínio do loop aqui — importe de `loopy/tui/store`. Duplicar `TaskStatus` é como o app e o motor divergem em silêncio.
- Não usar cores literais: tudo vem de `ui/tokens.css`. `LaunchConfig.tsx` viola isso hoje (~50 linhas de hex inline) — é o único pane assim, e não é o padrão a copiar.
- Não pôr lógica em componente: redutores/projeções (`applyLine`, `segmentsFor`, `groupByStep`, `detectGotoCards`, `streamColumns`) são **puros e testados isolados** (AD-6).
- `MarkdownStream` é seguro por construção (sem `rehype-raw` → HTML embutido vira texto). Não adicione `rehype-raw`: o conteúdo vem do output de um agente.

## Dependencies & Edges
- Pai: `../CLAUDE.md` (build, aliases, sidecar). Shell nativo: `../src-tauri/CLAUDE.md`.
- Motor (tipos + lógica pura, via alias `loopy/*` → `../../../src/*`): `loopy/tui/store` (reduce, `StoreEvent`, selectors), `loopy/tui/transport` (`parseTransportLine`, frames), `loopy/tui/view` (`computeDagreLayout`, `COLORS`, `SYMBOLS`, `pulseFrame`).

## Patterns & Pitfalls
- **`DESIGN.md` do app é TARGET, não o código atual** (ele diz isso no header). Ao mexer em estilo, o vigente é `ui/tokens.css` + `base.css`. > TODO(intent): DESIGN.md é a direção a seguir num refactor, ou referência morta? E o hex inline do `LaunchConfig` é dívida conhecida?
- **Ordem dos eventos**: Kanban e grafo dependem de `pipeline_declared` e `edges_set` chegarem **antes** dos `task_registered` (o MOCK_FEED assume essa ordem). > TODO(intent): é contrato do motor ou coincidência do emissor?
- `applySidecarExit` classifica o exit **pelo `runStatus`**: `idle` → `start-fail`, `running` → `death-mid-run`, `finished` → ignora. Sem isso, o encerramento normal do sidecar viraria erro na cara do usuário.
- `ui/context-window.ts` **não** é re-exportado pelo barril de propósito, e carrega um `WINDOW_FALLBACK` hardcoded por modelo — envelhece a cada modelo novo.
- `onStartRun(yesFlag)` recebe um argumento que o handler real **ignora**. > TODO(intent): resíduo ou feature incompleta?
- Erros do webview não deixam rastro: por isso `ErrorBoundary` + `window.onerror` + `unhandledrejection` mandam tudo para o comando `log_error` (stderr do processo Rust). Não remova esse funil.
