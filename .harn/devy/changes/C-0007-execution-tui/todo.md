# Backlog: C-0007 — TUI de execução (dashboard ao vivo do Run)

> Consumido pelo motor (`- [ ]` pendente / `- [x]` concluída; id `T-\d+`; corpo indentado).
> A linha `Deps:` é canônica (`task.deps`). Invariantes: **AD-1** (emit só observa, não
> altera o loop) e **AD-6** (apresentação pura em `view.ts`, React/Ink só em `mount`/`components`).
> Narrativa, dependency graph, âncoras de código, checkpoints e riscos: ver `plan.md`.

## Fase 1 — Foundation pura (T-001 ∥ T-002; T-003 após T-002)

- [x] T-001: Store — evento `acp_traffic` + `acpLog` ring bounded + fallback `--verbose`
    Aditivo à união `StoreEvent` (`store.ts:105-161`): `{ type:"acp_traffic"; taskId; direction:"send"|"recv"; method?; summary }` (linha pronta p/ exibir). `StoreState` (`:89-93`) ganha `acpLog: readonly AcpLogLine[]` (ring **bounded ~200**, inicializado em `initialState` `:168-170`); o `case` no `reduce` (switch exaustivo `:247-338`) **empurra e trunca** — e, por ser **global** (vai no `acpLog`, não numa Task), NÃO passa pelo no-op guard de `updateTask` (`:177-190`): é sempre aplicado. Continua puro/parallel-ready (a linha carrega `taskId`). Fallback: `line-reporter` (que reduz pelo mesmo `reduce`) emite `→/← <method> <summary>` **só** sob `--verbose` — `createLineReporter` ganha a flag `verbose` e `start.ts` a repassa (`:112-123`); sem `--verbose` = no-op (append-only preservado). `SYMBOLS` **inalterados**.
    Aceite: `acp_traffic` empurra e trunca no teto (~200, bounded, sem vazar); linha carrega `taskId`; eventos concorrentes de Tasks paralelas não corrompem o ring; `edges_set`/status/`stream_chunk` inalterados; fallback imprime a linha só sob `--verbose`, sem quebrar o append-only.
    Verificação: `npm test -- tui` && `npm run typecheck`.
    Deps: nenhuma
    Files: src/tui/store.ts, src/tui/line-reporter.ts, src/tui/start.ts, testes. Scope: M.

- [x] T-002: View — remap `COLORS.task` (amarelo=aguardando) + `pulseFrame`
    Remapear `COLORS.task` (`view.ts:39-42`) p/ a tabela da spec §3: `pending`→**yellow**, `blocked`→**yellow** (aguardando), `skipped`→**gray** (dim), `paused`→**magenta**; `running` cyan / `done` green / `escalated` red **mantidos**. `SYMBOLS.task` **inalterados** (o fallback usa só `SYMBOLS` ⇒ não muda). Adicionar `pulseFrame(tick: number): "on" | "off"` (puro; o `.tsx` mapeia p/ `bold`/`dimColor`). `attemptLabel`/`checkText`/`streamTail` intactos.
    Aceite: `COLORS.task` **exaustivo** batendo a nova tabela (teste por `TaskStatus`); amarelo=aguardando e vermelho=falhou; `pulseFrame` alterna determinístico por tick; `SYMBOLS` e formatters intactos.
    Verificação: `npm test -- tui` && `npm run typecheck`.
    Deps: nenhuma
    Files: src/tui/view.ts, src/tui/view.test.ts. Scope: S.

- [x] T-003: View — `layoutGraph` (`@dagrejs/dagre`) + `renderGraph` → `GraphGeometry` PURA
    Adicionar dep `@dagrejs/dagre`. Em `view.ts` (puro, **sem** React/Ink — AD-6): tipo `GraphGeometry` (posição de cada nó em célula + segmentos H/V das arestas, coords inteiras); `layoutGraph(edges, statusById, order): GraphGeometry` — monta grafo dagre (`rankdir:"LR"`, `nodesep`/`ranksep` pequenos; `width=len("<glyph> <id>")`, `height=1`; 1 aresta por par `[dep,dependente]`), roda `layout(g)` síncrono, converte `node.x/.y`+`edge.points` em células snapadas; `renderGraph(geometry, statusById, tick): StyledRow[]` — rasteriza (glyph+id colorido por `COLORS.task[status]`; arestas box-drawing `─│┌┐└┘├┤┬┴` + `▶` na ponta, dim; `pulseFrame(tick)` nas `running`), **clipa** ao tamanho do painel (passivo, sem scroll). **Toda** a matemática fica aqui (a Native UI reaproveita a geometria).
    Aceite: dagre coloca cada nó na camada correta (coluna por camada topológica); arestas ligam camadas via waypoints; desempate por ordem de backlog; diamante A→{B,C}→D fecha; `renderGraph` colore por status, alterna o pulso por tick e clipa ao painel; puro (zero I/O/React).
    Verificação: `npm test -- tui` && `npm run typecheck`.
    Deps: T-002
    Files: src/tui/view.ts, src/tui/view.test.ts, package.json. Scope: M. RISCO ALTO.

## Fase 2 — Emit seam (produtor; T-005 ∥ T-006 após T-004)

- [x] T-004: Orquestrador — `OrchestratorDeps.emit` + `StepContext.emit` (espelha transições)
    Contrato aditivo/opcional: `StepContext.emit?: (event: StoreEvent) => void` (`types.ts:554-576`, import type-only de `tui/store`) e `OrchestratorDeps.emit?` (`orchestrator.ts:617-689`). O orquestrador emite **espelhando as transições que já faz** — nenhuma nova: `edges_set` (de `graph.edges`) + `task_registered` (status `blocked` se `task.deps` senão `pending`) na carga do grafo (`:1230-1234`); `task_started` em `launchTask` (`:1326`); `task_finished(status)` em done/escalate/pause/skip (`:1351/1380/1388/1401`); `step_started`/`step_finished` em torno de `timedExecute` (`:797-810`, nos DOIS sites: PC loop `:906` e teardown `:1014`). `buildTaskStepContext` (`:703-727`) propaga `emit: deps.emit`. **Best-effort**: síncrono, engole exceção, nunca bloqueia; roda **fora** da seção crítica do parent (não segura o mutex).
    Aceite: dado DAG A→C, B, a **sequência** emitida bate (`edges_set`, `task_registered×3` — A/B `blocked` se têm deps, `task_started`, `step_*`, `task_finished(A,done)`, `task_started(C)`…); `emit` que lança é engolido; **`RunLoopResult` byte-idêntico com e sem `emit`** (AD-1); `emit` ausente ⇒ motor byte-idêntico.
    Verificação: `npm test -- orchestrator` && `npm run typecheck`.
    Deps: nenhuma
    Files: src/types.ts, src/loop/orchestrator.ts, testes. Scope: L. RISCO ALTO.

- [ ] T-005: Checks ao vivo — `onCheckStart/onCheckEnd` + `attempt_started`/`check_*`
    `ChecksRunnerPort.run` (`types.ts:526-531`) e `RunChecksOptions` (`runner.ts:270-279`) ganham `onCheckStart?(name)`/`onCheckEnd?(name, ok)` (aditivos, opcionais); `runChecks` os dispara em torno de `runOne` no loop sequencial (`:297-304`). Step `agent` (`agent.ts:159-242`): emite `attempt_started` no início de cada tentativa do verify (`:183`) e encaminha `onCheckStart/End` (do `runVerifyChecks`/`ctx.checks.run` `:112`) → `ctx.emit(check_started/finished)` com `taskId`+`stepId`. Step `checks` (`checks.ts:47-80`): idem no `ctx.checks.run` (`:64`). Cada check acende `running → ✓/✗` **ao vivo**.
    Aceite: `runChecks` dispara `onCheckStart/End` por-check no loop sequencial (por-check, não só o agregado); `agent` emite `attempt_started` (com `attempt`/`maxAttempts`) e encaminha os `check_*`; `checks` idem; `ChecksReport` agregado **inalterado**; sem os callbacks o comportamento é idêntico.
    Verificação: `npm test -- checks` && `npm test -- steps` && `npm run typecheck`.
    Deps: T-004
    Files: src/types.ts, src/checks/runner.ts, src/steps/agent.ts, src/steps/checks.ts, testes. Scope: M.

- [ ] T-006: Shell stream — `onChunk` aditivo → `stream_chunk` ao vivo
    `RunShellCommand` (`shell.ts:64-72`) ganha `onChunk?(text)` (aditivo); `runShellCommandWithExeca` (`:86-126`) passa a **streamar** `stdout`/`stderr` conforme o `execa` produz (streaming aditivo), invocando `onChunk`; `createShellStep` (`:179-242`) encaminha `onChunk` → `ctx.emit(stream_chunk)` com `taskId`. O `StepResult` **agregado permanece igual** (a captura no fim continua alimentando `output`); só espelha a saída para a store enquanto chega.
    Aceite: o Step `shell` emite `stream_chunk` conforme o `execa` produz (via `onChunk`); o `ShellCommandResult`/`StepResult` agregado **byte-idêntico** ao de hoje; sem `onChunk`/`emit` o comportamento é idêntico; roda respeitando a seção crítica (mutex só se não `parallel_safe`).
    Verificação: `npm test -- steps` && `npm run typecheck`.
    Deps: T-004
    Files: src/steps/shell.ts, testes. Scope: M.

## Fase 3 — Boundary ACP + wiring (T-007 ∥ cedo; T-008 sink da fase)

- [x] T-007: ACP — `onTraffic` (send+recv) + `onUpdate` seams (observação pura, AD-1)
    `OpenAgentOptions` (`agent.ts:62-86`) ganha `onTraffic?(entry: AcpTrafficEntry, sessionId: string)` (o `onUpdate?` já existe `:77-78`). No `client.ts`: no handler de `session/update` (`:547-553`) e nos requests do Agente (permission/fs/terminal `:508-546`) captar os **recv** via `onTraffic`; em `session.ts` os **send** — `setMode`/`ctx.request` (`:134-140`), `cancel`/`ctx.notify` (`:162-164`), `prompt`/`runTurn` (`:210-235`) — chamam `onTraffic("send", …)`. O mesmo `onTraffic` alimenta o `TaskLogger.acp` (`logger.ts:42-47/:107-109`, hoje **dead code**). **Não altera** o comportamento ACP (só observa).
    Aceite: `onTraffic` capta os send (`session/set_mode`/`prompt`/`cancel`) e os requests recv do Agente, com `sessionId`; `onUpdate` de um `session/update` continua entregando o `agent_message_chunk` (via `agentChunkText`); `TaskLogger.acp` passa a ser chamado; sem `onTraffic`/`onUpdate` o boundary é idêntico ao de hoje.
    Verificação: `npm test -- acp` && `npm run typecheck`.
    Deps: nenhuma
    Files: src/acp/agent.ts, src/acp/client.ts, src/acp/session.ts, src/logging/logger.ts, testes. Scope: M.

- [x] T-008: Entrypoint — mount Ink + `emit=dispatch` + `sessionId→taskId` + logs arquivo-only
    `defaultRunLive` (`index.ts:321-378`): passar `mount: mountApp` a `startUi` (liga o Ink; `:331`) e injetar `emit: ui.dispatch` em `deps` (`:351-369`). `openAgent({ onUpdate, onTraffic })` (`:333-338`): `onUpdate` mapeia `session/update` → `stream_chunk` (via `agentChunkText`, texto do Agente) **e** → `acp_traffic(recv)`; `onTraffic` capta os send+recv restantes. Manter `Map<sessionId, taskId>` populado no wrapper de `sessionProvider` (`:365`, via `basename(cwd) === task.id`); as callbacks lêem o mapa p/ carimbar `taskId`. Em modo TUI (`ui.tui === true`): construir o logger **sem** o tee no stdout (arquivo-only; `teeLogger` `:298-313` corromperia o frame) e **bufferizar** o `notify` (`:364`), drenando-o ao stderr **após** `ui.stop()` (`:376`). Captura ACP gated por `--verbose`/`capture_acp_traffic`.
    Aceite: com `mount`+TTY o Dashboard monta e o `dispatch` vai à store (não imprime linhas); sem TTY/`--no-tui` cai no fallback e as linhas saem (matriz de `startUi` inalterada); `taskId` correto via `sessionId→taskId`; em modo TUI o logger é arquivo-only e o `notify` sai **após** `ui.stop()`; captura gated por `--verbose`. Nota: cwd da Sessão = `resolve(root, worktreePathFor(task))` (`orchestrator.ts:790-794`), `worktreePathFor = <dir>/<task.id>` (`:102-105`) ⇒ `basename(cwd)===task.id` — o mapa carimba por aí.
    Verificação: `npm test -- cli` && `npm run typecheck`.
    Deps: T-001, T-004, T-007
    Files: src/index.ts, testes. Scope: L. RISCO ALTO.

## Fase 4 — Dashboard (consumidor; T-010 após T-009)

- [ ] T-009: Panes — `GraphPane` + `AcpLogPane` + `TaskListPane` (+`ink-testing-library`)
    Adicionar dev-dep `ink-testing-library`. `components/GraphPane.tsx` (NOVO): wrapper fino de `renderGraph(...)` → imprime `StyledRow[]` como spans `<Text>` coloridos. `components/AcpLogPane.tsx` (NOVO): tail de `StoreState.acpLog` (direction/method/summary), prefixado por `taskId` quando >1 Task ativa. `components/TaskListPane.tsx` (NOVO): o frame de Tasks (crit. 4) — 1 linha/Task em ordem de backlog, glyph+cor por status (verde+`✔` executada; vermelho+`✖` falhou), com step atual/`try k/max`/checks quando `running` (reusa `TaskRow`/`attemptLabel`/`CheckStatus`). `StreamPane.tsx` inalterado. Testes pequenos com `ink-testing-library` (`lastFrame()`), lógica dura fica pura em `view.ts`.
    Aceite: `GraphPane` desenha o grafo colorido (usa `renderGraph`); `AcpLogPane` faz tail do `acpLog` bounded e prefixa `taskId` sob concorrência; `TaskListPane` lista todas em ordem de backlog com glyph/cor por status + step/try/checks quando running; snapshots via `ink-testing-library` verdes.
    Verificação: `npm test -- tui` && `npm run typecheck`.
    Deps: T-001, T-002, T-003
    Files: src/tui/components/GraphPane.tsx, src/tui/components/AcpLogPane.tsx, src/tui/components/TaskListPane.tsx, testes, package.json. Scope: M.

- [ ] T-010: `App.tsx` → Dashboard fixo (header + Grafo + split Tasks | Stream+Logs) + pulso
    Reescrever `App.tsx` (`:18-44`) p/ o Dashboard fixo: header (`loopy · run · k/N done · M running`, contadores derivados) → `GraphPane` no topo → abaixo split `TaskListPane` (esq.) | `StreamPane(s)` + `AcpLogPane` (dir.). Um `StreamPane` por Task `running` (`runningTasks` `store.ts:363-365`), empilhando as **~3 mais recentes** + contador `+K` (bounded na altura). Efeito de **pulso**: `setInterval(~500ms)` + `useState(tick)` num `useEffect` só p/ animar (a fase é `pulseFrame`, pura). **Sem `useInput`** além do `ApprovalPrompt` já existente (passivo — AD-1). `mount.tsx` (`:16-28`) segue o **único** `render`.
    Aceite: snapshot do Dashboard composto (4 painéis) via `ink-testing-library`; o efeito de pulso avança o tick sob **fake timers** (Task `running` alterna a ênfase); o bound de empilhamento (N streams `running` → ~3 + `+K`); nenhuma tecla fora do Gate de Aprovação altera o Run.
    Verificação: `npm test -- tui` && `npm run typecheck`.
    Deps: T-009
    Files: src/tui/App.tsx, src/tui/App.test.tsx, testes. Scope: M.

## Fase 5 — Docs + close-out

- [ ] T-011: ADR-0005 + CONTEXT.md (glossário) + `src/tui/CLAUDE.md` + full green
    Criar `docs/adrs/0005-*.md` (emit seam aditivo + Dashboard Ink + layout dagre + view pura renderer-agnostic + OpenTUI como Native UI futura + AD-1/AD-6) e indexá-lo (`docs/adrs/README.md`). Promover ao `CONTEXT.md` os termos novos da spec §"Linguagem ubíqua": **Dashboard**, **Painel** (Grafo/Tasks/Stream/Logs), **GraphGeometry**, **Native UI**, **Pulso**, precisão de **Stream**, **Tráfego ACP**, **Emit seam**, **onTraffic** — sem colidir com o cluster de verificação nem com Iteração/Tentativa/Visita. Atualizar `src/tui/CLAUDE.md` (Dashboard montado; emit seam vivo; fio `mount → index` ligado) e, se necessário, mencionar o emit seam em `src/loop/CLAUDE.md`/`src/steps/CLAUDE.md`/`src/acp/CLAUDE.md`.
    Aceite: ADR-0005 criado e indexado; glossário do `CONTEXT.md` promovido (termos novos, sem colisão); `src/tui/CLAUDE.md` reflete o dashboard vivo; `npm run typecheck && npm run lint && npm test` verdes (todos os Success Criteria 1-11 da spec).
    Verificação: `npm run typecheck && npm run lint && npm test`.
    Deps: T-001, T-002, T-003, T-004, T-005, T-006, T-007, T-008, T-009, T-010
    Files: docs/adrs/0005-*.md, docs/adrs/README.md, CONTEXT.md, src/tui/CLAUDE.md. Scope: M.
