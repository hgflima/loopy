# Plan: C-0007 — TUI de execução (dashboard ao vivo do Run)

> Plano de implementação derivado de `spec.md` (nesta pasta) e do estado atual do
> motor (mapeado read-only). Companion do `todo.md` (o backlog que o motor consome):
> aqui vivem a narrativa, o grafo de dependências, as âncoras de código, os
> checkpoints e os riscos; lá, as tasks terse com aceite/verificação/Deps.

## Overview

Ligar o **emit seam morto** e desenhar o **Dashboard Ink**. Hoje `defaultRunLive`
chama `startUi({ flags })` **sem `mount`** (`index.ts:331`) e `openAgent` **sem
`onUpdate`/`onTraffic`** (`index.ts:333-338`), então **todo run vivo cai no fallback
de linha** e **nenhum `StoreEvent` de progresso é produzido** (grep confirmou: zero
produtores fora de `store.ts`/`line-reporter.ts`). A store observável, a view pura, os
componentes Ink e o fallback existem e são testados — falta o **produtor** (o motor
empurrando eventos) e o **renderer** (a árvore Ink montada, com os painéis que faltam).

A entrega tem dois eixos: **(A) o produtor** — o orquestrador e os interpreters de Step
emitem `StoreEvent`s nas transições que já fazem, e o boundary ACP capta stream + tráfego;
**(B) o consumidor** — um Dashboard fixo de quatro Painéis (Grafo via `@dagrejs/dagre`,
Tasks, Stream, Logs/ACP), tudo derivado de uma **view pura** renderer-agnostic para a
futura Native UI (OpenTUI, fora de escopo). Invariantes rígidos: **AD-1** (a TUI só
observa/desenha, o emit **não** altera o loop) e **AD-6** (toda apresentação — geometria
do grafo, cores, símbolos, pulso — vive em `src/tui/view.ts`, sem React/Ink).

## Architecture Decisions

- **Slicing por seam, cada camada verde isolada (estilo C-0006).** A feature é
  arquiteturalmente em camadas (contrato → produtor → consumidor); um "slice vertical
  puro" (um evento da transição do motor até o pixel) tocaria contrato+orquestrador+
  store+view+componente+index de uma vez (XL). Seguimos a convenção dogfooded do projeto:
  cada task é um seam com testes de unidade próprios (`npm test -- <área>`), deixando o
  sistema verde. O **ordenamento** é que dá o walking skeleton cedo (ver Checkpoints).
- **Emit aditivo e opcional (no-op por omissão).** `OrchestratorDeps.emit?` e
  `StepContext.emit?` são opcionais; ausência ⇒ motor **byte-idêntico** ao de hoje. O
  emit é síncrono, best-effort, **nunca** bloqueia/lança para o loop e roda **fora** da
  seção crítica do parent. Prova: `RunLoopResult` idêntico com e sem `emit`.
- **`StoreEvent`/`StoreState` ficam em `store.ts`; `types.ts` importa `StoreEvent`
  (type-only) para tipar `emit?`.** *(Decidido com o dono da arquitetura — descartadas:
  mover a união p/ `types.ts`, e o módulo neutro `tui/events.ts`.)* Correção vs. spec: a
  spec atribuiu `StoreEvent += acp_traffic` a `types.ts`; na verdade a união vive em
  `store.ts:105-161` e `StoreState` em `store.ts:89-93`. O import type-only `types.ts →
  tui/store` é apagado em runtime (sem ciclo). `OrchestratorDeps` vive em
  `orchestrator.ts:617-689`.
- **`acp_traffic` é evento global (vai no `acpLog` ring), não numa Task.** Não passa pelo
  no-op guard de `updateTask` (`store.ts:177-190`): é sempre aplicado, truncando o ring
  (~200). Continua puro/parallel-ready (linhas carregam `taskId`).
- **Fonte do stream do Agente = `onUpdate` global, não `ctx.emit`.** O Step `agent` fica
  bloqueado em `await ctx.session.prompt()` enquanto os chunks chegam por notificação
  posterior; então o texto do Agente vem do `onUpdate` (`session/update` → `stream_chunk`,
  via `agentChunkText` `client.ts:197`), e só o `shell` streama via `ctx.emit`. O `agent.ts`
  emite via `ctx.emit` apenas `attempt_started` + os `check_*`.
- **`sessionId → taskId` via `basename(cwd) === task.id`.** O `onUpdate`/`onTraffic` é
  callback único e global (1 processo ACP/Run, AD-3), keyed por `sessionId`. O wrapper de
  `sessionProvider` (`index.ts:365`) registra `sessionId → taskId` quando a Sessão resolve.
  **Confirmado** (read-only): o cwd da Sessão é
  `sessionProvider(resolve(deps.root, worktreePathFor(config, task)))`
  (`orchestrator.ts:790-794`) e `worktreePathFor = <worktrees_dir>/<task.id>`
  (`orchestrator.ts:102-105`) ⇒ `basename(cwd) === task.id` **por construção**. (O
  `worktreePath: deps.root` do `StepContext` `orchestrator.ts:718` é OUTRA coisa — o cwd
  dos Steps shell, ROOT de propósito `:694-701`; não é o cwd da Sessão.) Zero mudança no
  contrato ACP.
- **Duas deps novas.** `@dagrejs/dagre` (dep, layout Sugiyama síncrono; T-003) e
  `ink-testing-library` (dev-dep, testar os `.tsx`; T-009). Ask-first satisfeito na spec.

## Dependency Graph

```
 Fase 1 — Foundation pura (produtor-agnóstica; testável isolada)
   T-001 store: acp_traffic + acpLog ring + fallback --verbose ─────────┐
   T-002 view: remap COLORS.task + pulseFrame ──┐                       │
   T-003 view: layoutGraph(dagre) + renderGraph ─┘ (T-003 ← T-002)      │
                                                                        │
 Fase 2 — Emit seam (produtor: o motor fala com a store)                │
   T-004 orquestrador: OrchestratorDeps.emit + StepContext.emit ─┬──────┤
   T-005 checks ao vivo: onCheckStart/End + agent/checks emit ───┤ (←T-004)
   T-006 shell stream: onChunk + stream_chunk ──────────────────┘ (←T-004; ∥ T-005)
                                                                        │
 Fase 3 — Boundary ACP + wiring do entrypoint (walking skeleton)        │
   T-007 ACP: onTraffic (send+recv) + onUpdate seams ───────────┐       │
   T-008 index: mount Ink + emit=dispatch + sessionId→taskId ───┴───────┘
         + logs arquivo-only em modo TUI     (← T-004, T-007, T-001)
                                                                        │
 Fase 4 — Dashboard (consumidor: os Painéis Ink)                        │
   T-009 panes: GraphPane + AcpLogPane + TaskListPane ──┐ (← T-003, T-001, T-002)
   T-010 App.tsx → Dashboard fixo + pulso ──────────────┘ (← T-009)
                                                                        │
 Fase 5 — Docs + close-out                                              │
   T-011 ADR-0005 + CONTEXT.md + tui/CLAUDE.md + full green (← todas) ──┘
```

Independentes / paralelizáveis no arranque: **T-001, T-002, T-004, T-007**.
Cadeia do consumidor: T-002 → T-003 → T-009 → T-010.
Cadeia do produtor: T-004 → {T-005, T-006}; T-004+T-007+T-001 → T-008.

## Âncoras de código (pontos de inserção mapeados)

- **Contrato:** `StepContext` `types.ts:554-576` (+`emit?`); `ChecksRunnerPort.run`
  `types.ts:526-531` (+`onCheckStart?/onCheckEnd?`); `OrchestratorDeps`
  `orchestrator.ts:617-689` (+`emit?`).
- **Store:** `StoreEvent` união `store.ts:105-161`; `StoreState` `store.ts:89-93`;
  `reduce` switch exaustivo `store.ts:247-338`; `initialState` `store.ts:168-170`;
  `runningTasks` `store.ts:363-365`; no-op guard `updateTask` `store.ts:177-190`.
- **View:** `COLORS.task` `view.ts:39-42`; `SYMBOLS` `view.ts:20-31`; formatters
  `attemptLabel` `:57-65` / `checkText` `:68-70` / `streamTail` `:78-82`.
- **Orquestrador:** `buildTaskStepContext` `:703-727` (propaga `emit`); `timedExecute`
  `:797-810` (step_started/finished, usado no PC loop `:906` e teardown `:1014`);
  `launchTask` `:1320-1414` (task_started `:1326`; done `:1351`; escalated `:1380/1392`;
  paused `:1388`; skipped `:1401`); `buildGraph`/`graph` `:1230-1234` (edges_set +
  task_registered).
- **Steps:** `agent.execute` `agent.ts:159-242` (verify loop `:183`, prompt `:193`,
  `ctx.checks.run` `:112`); `shell` `RunShellCommand` `shell.ts:64-72`,
  `runShellCommandWithExeca` `:86-126`, `createShellStep` `:179-242`; `checks.execute`
  `checks.ts:47-80` (`ctx.checks.run` `:64`).
- **Runner:** `RunChecksOptions` `runner.ts:270-279`; `runChecks` loop `:297-304`;
  `createChecksRunner` `:315-325`.
- **ACP:** `openAgent`/`OpenAgentOptions` `agent.ts:62-135` (`onUpdate?` `:77-78`, sem
  `onTraffic`); `agentChunkText` `client.ts:197-201`; `session/update` handler
  `client.ts:547-553`; requests do Agente `client.ts:508-546`; sends `session.ts` setMode
  `:134-140` (`ctx.request`) / cancel `:162-164` (`ctx.notify`) / runTurn `:210-235`.
- **Logger/entrypoint:** `AcpTrafficEntry` `logger.ts:30-36`; `TaskLogger.acp`
  `logger.ts:42-47`/`:107-109` (**dead code**); `teeLogger` `index.ts:298-313`; `notify`
  `index.ts:364`; `defaultRunLive` `index.ts:321-378` (`startUi` `:331`, `openAgent`
  `:333-338`, `sessionProvider` `:365`, `ui.ui`→deps `:356`, teardown `:373-377`).

## Task List

### Fase 1 — Foundation pura
- T-001: Store — evento `acp_traffic` + `acpLog` ring + fallback `--verbose`
- T-002: View — remap `COLORS.task` + `pulseFrame`
- T-003: View — `layoutGraph` (dagre) + `renderGraph` → GraphGeometry

**Checkpoint A — Foundation pura:** `typecheck`+`lint`+`test` verdes; store e view
100% unit-testados; geometria dagre provada isolada; **zero mudança no loop vivo**.

### Fase 2 — Emit seam (produtor)
- T-004: Orquestrador — `OrchestratorDeps.emit` + `StepContext.emit` (espelha transições)
- T-005: Checks ao vivo — `onCheckStart/End` + `agent`/`checks` emitem `check_*`/`attempt_started`
- T-006: Shell stream — `onChunk` aditivo → `stream_chunk`

### Fase 3 — Boundary ACP + wiring
- T-007: ACP — `onTraffic` (send+recv) + `onUpdate` seams (observação pura)
- T-008: Entrypoint — mount Ink + `emit=dispatch` + `sessionId→taskId` + logs arquivo-only

**Checkpoint B — Emit seam vivo (walking skeleton):** `loopy <alvo> --no-tui` mostra o
**line-reporter reagindo a eventos REAIS do motor** pela 1ª vez; num TTY, o Ink monta
(layout antigo) e mostra tasks/streams ao vivo. `RunLoopResult` idêntico com/sem
observação. **Todo o caminho de produção de-riscado antes do dashboard/dagre.**

### Fase 4 — Dashboard (consumidor)
- T-009: Panes — `GraphPane` + `AcpLogPane` + `TaskListPane` (+`ink-testing-library`)
- T-010: `App.tsx` → Dashboard fixo (header + Grafo + split Tasks | Stream+Logs) + pulso

**Checkpoint C — Dashboard renderiza:** num TTY real, os quatro painéis aparecem (grafo
colore ao vivo, Task `running` pulsa, checks acendem, streams + log ACP); fallback
`--no-tui`/no-TTY preservado.

### Fase 5 — Docs
- T-011: ADR-0005 + CONTEXT.md (glossário) + `src/tui/CLAUDE.md` + full green

**Checkpoint Final:** todos os Success Criteria da spec (1-11) atendidos; ADR indexado;
glossário promovido; `npm run typecheck && npm run lint && npm test` verdes.

## Risks and Mitigations

| Risco | Impacto | Mitigação |
|---|---|---|
| Rasterização ASCII do dagre frágil (T-003) | Alto | Geometria **pura** e unit-testada (camadas, waypoints, diamante A→{B,C}→D, clip ao painel); aceitar o roteamento do dagre; falha isolada antes de qualquer `.tsx`. |
| `emit` alterar a ordem/resultado do loop (T-004) | Alto | Teste `RunLoopResult` **byte-idêntico** com/sem `emit`; emit best-effort (swallow), fora do mutex, espelha transições existentes (nenhuma nova). |
| Derivação `sessionId→taskId` errada (T-008) | Baixo (resolvido) | **Confirmado**: cwd da Sessão = `resolve(root, worktreePathFor(task))` (`orchestrator.ts:790-794`), `worktreePathFor = <dir>/<task.id>` (`:102-105`) ⇒ `basename(cwd)===task.id`. Resta só um teste do carimbo de `taskId`. |
| Motor corromper o frame Ink escrevendo no stdout (T-008) | Médio | Em modo TUI: logger **arquivo-only** (`info`/`debug`) + `notify` **bufferizado** drenado ao stderr pós-`ui.stop()` (mesmo padrão do Relatório de métricas). |
| Import type-only `types.ts → tui/store` (T-004) | Baixo | `StoreEvent` é type-only (apagado em runtime); sem ciclo. Alternativa: mover `StoreEvent` p/ `types.ts` se o lint reclamar de camada. |
| Novo membro da união quebrar exaustividade (T-001) | Baixo | `reduce` (switch exaustivo `store.ts:247`) e o `line-reporter` tratados no **mesmo** slice (T-001); `SYMBOLS` intactos. |

## Open Questions

Nenhuma bloqueante — a spec resolveu OQ1-OQ17 (ver *Decisões resolvidas* na spec).
Itens **Ask-first** deliberadamente **fora** deste MVP: OpenTUI/Native UI (change futura
dedicada), interatividade (`useInput`/scroll/seleção), coluna de Métricas na TUI.

## Notas de dogfooding

O `loopy.yml` desta change (para o motor rodar C-0007 sobre si mesmo) não é produzido por
este plano; quando for criado, reusa o pipeline canônico `/devy:*` (`build` →
`code-simplify` → `review` com `REVIEW: PASS`), como `C-0006/loopy.yml`. `concurrency: 1`
recomendado (a própria feature exercita paralelismo no alvo, não neste repo).
