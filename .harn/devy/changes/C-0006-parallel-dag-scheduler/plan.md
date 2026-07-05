# Plano de implementação: C-0006 — Paralelismo de Tasks dirigido pelo DAG do backlog

> Deriva de `spec.md` (mesma pasta). **Todas as Open Questions já estão resolvidas na
> spec** (OQ1–OQ19 + 14 decisões do refine) — este plano decide só a *mecânica e a
> ordem*, não o design. Invariante central mantido (AD-1): o motor ganha a **mecânica**
> de agendar Tasks em paralelo respeitando arestas; **quantas** é `concurrency`, **quais**
> depende de quais é o `Deps:` do `todo.md`, **o que é safe fora do mutex** é
> `parallel_safe`, **se rebasa no conflito** é `on_merge_conflict` — tudo `loopy.yml`.

## Overview

Substituir o Loop externo estritamente sequencial (`for (const task of tasks)` em
`orchestrator.ts:1021`) por um **pool de N Sessões dirigido por um DAG de Tasks** extraído
do `todo.md`: Tasks sem aresta entre si rodam concorrentes (cada uma no seu Worktree/Sessão
isolados), Tasks dependentes esperam o predecessor chegar a **`done` (merjado no parent)**,
e o teto de paralelismo é `concurrency` (hoje schema morto, passa a ser lido). O único ponto
de contenção — a **Parent branch compartilhada** — é protegido por uma **Seção crítica**
(mutex único da Run) na **camada de execução de Steps** (não no `GitPort`). Falha propaga por
**skip transitivo**; escalonamento reenquadrado sob paralelismo; cancelamento por
`session.cancel()` (sibling-safe), com `child.kill()` só como fallback de timeout da parada
dura. Mudanças de contrato **aditivas** (provadas por `tsc`); **regressão zero** quando
`concurrency: 1` **e** sem `Deps:` **e** `on_merge_conflict: escalate`.

## Architecture Decisions (herdadas da spec — não reabrir)

- **A aresta desbloqueia em `done` (merjado), não "commitado no worktree" (OQ2).** T-B só
  enxerga o código de T-A depois do Merge no parent. Logo Merge e Gate de Aprovação ficam no
  **caminho crítico** do desbloqueio — mas o **wait de aprovação roda FORA do mutex** (OQ10),
  então a deliberação humana não trava o arranque de outras Prontas.
- **O mutex NÃO mora no `GitPort` (OQ6, correção de fato).** `worktree add`/`merge`/`worktree
  remove`/`branch -D` são Steps `shell`/`approval` do yml (`examples/loopy.yml:37,89,96-97`),
  executados por `steps/{shell,approval}.ts` com `cwd = root`. A **Seção crítica** vive na
  camada de execução de Steps: serializa a **execução de comando** de todo Step **não-Agente**
  sem `parallel_safe`, + os ports `commitPaths`/`isParentClean`. O trabalho pesado (turnos do
  Agente e `verify`, ambos no worktree) roda **fora** do mutex.
- **Paraleliza Tasks, nunca Steps (OQ3).** O PC intra-Task é sequencial; `StepContext`/
  `StepResult` **intocados** (Boundaries da spec). O mutex é threaded via o **seam do
  command-runner** já injetado (`RunShellCommand`/`runCommand` do approval/`ChecksRunnerPort`),
  não via `StepContext` — assim a execução de comando serializa enquanto o `ui.requestApproval`
  (wait humano) fica fora.
- **`${iteration}` desacopla-se do teto (OQ8).** Hoje `iteration` é **contador de runtime**
  (`orchestrator.ts:1050`); passa a ser o **índice estável** da Task na ordem de arquivo
  (idêntico dry-run×run vivo ⇒ preserva **AD-4**). `max_iterations` vira contador separado
  ("Tasks iniciadas"; `skipped` não conta).
- **Falha ⇒ skip transitivo + escalonamento drenante (OQ4).** `abort_loop` cancela em-voo e
  encerra; `pause` marca `paused` (resumível) e **continua drenando**; `skip_task` abandona e
  continua. `RunLoopResult` ganha `paused`/`skipped` (aditivo).
- **Cancelamento é `session.cancel()`, não `child.kill()` (OQ11/12).** O Agente é **um
  processo** com N Sessões (`agent.ts:3-5`); `child.kill()` mataria todas. Parada dura:
  `session.cancel()` por Sessão (cooperativo — `prompt()` resolve `cancelled`), settle com
  timeout curto → `child.kill()` só quando a Run inteira encerra.
- **Conflito de merge é tratado por policy (OQ14/15).** Nova `policies.git.on_merge_conflict:
  escalate | rebase` (default `escalate` = hoje). `rebase` faz `git rebase <parent>` +
  retry-once **dentro** do mutex antes de cair no `on_fail`.
- **Escrita de checkpoint fica FORA do mutex — já é segura por design (decisão de review).**
  `createCheckpointPort` (`orchestrator.ts:420-444`) é **uma única instância/Run** com um
  `state` em memória; toda mutação é **síncrona** (`saveProgressIn` puro + `saveState` com
  `writeFileSync`/`renameSync`, sem `await` interno) e **keyed por `taskId`**. Logo o event
  loop **já serializa** escritas de Tasks concorrentes (run-to-completion, sem yield) sem
  perda. Trazê-la pro mutex seria **errado** (forçaria a interface a virar async, abrindo o
  próprio yield que criaria a race). **Invariante:** o `CheckpointPort` permanece **uma
  instância por Run + escrita síncrona**; se algum dia a escrita virar async, aí sim precisa
  de write-lock interno + nome de `.tmp` único por escrita.

## Pontos de código âncora (confirmados por exploração)

| Alvo | file:line | Nota |
|---|---|---|
| `for (const task of tasks)` (loop externo) | `orchestrator.ts:1021` (em `runLoop` `:946`) | vira pool de N Sessões |
| `runTaskPipeline` (roda 1 Task) | `orchestrator.ts:648` → `PipelineRunResult` `:628`; call `:1056` | invocado em paralelo |
| `timedExecute` (único `interpreter.execute`) | `orchestrator.ts:690` → execute `:695`; sites `:786`/`:863` | mutex wrap p/ não-Agente |
| cwd standalone = root | `orchestrator.ts:610` (`buildTaskStepContext` `:595`) | shell/checks/approval no root |
| Sessão por Task (cwd = worktree) | `orchestrator.ts:681-687`; `createLazySession` `:497` | pool keyed by cwd (`session.ts:293`) |
| `buildScopeVars`/`iteration` | `:120` (iteration=`runtime.iteration` `:135`); `iterations+=1` `:1050`; gate `:1028`; max `:957-958` | `${iteration}`→índice estável; contador separado |
| `RunLoopResult` / `LoopStopReason` | `orchestrator.ts:918-933` / `:909-915` | += `paused`/`skipped` |
| precedência `flags.X ?? config.Y` | `orchestrator.ts:957-958`; clock `now` `:658`/`:951` | `--concurrency` segue o padrão |
| escalação | `decideEscalation` `:904-906`; bloco `:1076-1097`; `setStatus` `:1086-1089`; `skip_task`→`clearTask` `:1097` | reenquadrar pause/skip/abort |
| `require_clean_parent` (gate pré-task) | `:1037-1041`; flag `:963`; `isParentClean` `worktree.ts:142` | **move p/ dentro** do mutex |
| `commitPaths` (mark-done) | wired `index.ts:347`; port `orchestrator.ts:396`; `markDone` `:1066`; impl `worktree.ts:113` | adquire mutex |
| `OrchestratorDeps` | `orchestrator.ts:524-581` (`now` `:580`, `git` `:554`, `sessionProvider` `:563`, `checkpoint` `:569`) | + mutex interno |
| approval FIFO / step | `tui/approval.ts:127-172` (queue `:128`, head `:160`); `steps/approval.ts:85-118` (wait `:91`, exec `:106-118`) | **wait fora / exec dentro** |
| `session.cancel()` | `acp/session.ts:161-166` (notify, sibling-safe); `prompt` cancelled classify `:68-72`, retorno `:234` | parada dura |
| Agente = 1 processo | `acp/agent.ts:3-5`; spawn `:142-146` | `child.kill()` = fallback |
| shell exec (execa, no shell) | `steps/shell.ts:79-118` (seam `RunShellCommand` `:62-65`); cwd `:183` | mutex via seam |
| `GitPort`/`Git` | `types.ts:483-498`; `worktree.ts:49-60`; `commitPaths` `:113-118`; `isParentClean` `:142-148`; `merge` `:120-140` | + `rebase` helper |
| parser `extractBody`/build | `todo.ts:117` / `parseTaskLine` `:172`; `resolveOptions` `:73-82`; `backlogOptionsFrom` `:53-59`; `pendingTasks` `:206-208`; `markDone` `:238-257` | + linha `Deps:` |
| `Task` type | `types.ts:25-38` | + `deps: readonly string[]` |
| `StepBase` / `stepBaseShape` | `types.ts:114-120` / `schema.ts:101-107` | + `parallel_safe?` |
| `concurrency` | `types.ts:274` / `schema.ts:317` (`min(1).default(1)`, sem max) | passa a ser **lido** |
| `policies.git` | `types.ts:237-240` / `gitPolicySchema` `schema.ts:266-270` | + `on_merge_conflict` |
| `inputs.backlog` | `backlogSchema` `schema.ts:64-72` | + `deps_pattern` |
| warnings (grafo/ciclo) | `collectPipelineWarnings` `warnings.ts:132-136`; `buildFlowGraph` `:26`; `detectCycles` `:53` | reuso p/ ciclo do DAG + warning `parallel_safe` |
| `RunState`/`TaskCheckpoint` | `types.ts:399-402` / `:387-396`; `TaskStatus` resume `:384` | já `Record` — multi-in-flight |
| resume (escrita) | `resume/state.ts:45-56` (`resumeStateFor`); `saveState` **atômico** `:160-165` (**reescreve o arquivo TODO**) | **serializar** a escrita |
| store `TaskStatus`/`edges` | `tui/store.ts:31-39` / `StoreState` `:83-85`; `findIndex` O(n) `:168` | + `edges` + status |
| `AgentSession` port (`cancel`) | `types.ts:457-473` (`cancel` `:468`) | invocado na parada dura |

## Dependency graph

```
T-001 (parser Deps: → Task.deps) ──► T-002 (scheduler puro) ──┐
                                          │                     │
T-003 (config aditivo) ──► T-004 (Seção crítica) ─────────────►├─► T-005 (pool N Sessões)
                                          │                     │        │  │  │
                              T-009 (store: edges+status) ◄─────┘        │  │  │
                                                                         ▼  ▼  ▼
                     T-006 (skip+pause/skip_task) ◄──────────────────────┘  │  │
                              │                                              │  │
                              ▼                              T-010 (resume) ◄┘  │
                     T-007 (abort_loop + cancel)             T-011 (dry-run+--task)◄┘
                     T-008 (on_merge_conflict: rebase) ◄──── (T-004 + T-005)
                              │
                              ▼
                     T-012 (docs + examples + fixtures)  ◄── (sink: T-006..T-011)
```

**Raízes paralelizáveis:** T-001 e T-003 (sem deps). **Coração:** T-004 (Seção crítica, a
única L) → T-005 (pool). **Surfaces:** T-009 (store) ramifica cedo de T-002 e roda em paralelo
com a Fase 2/3; T-010/T-011 fan-out de T-005. Cada task deixa `tsc`/`lint`/`test` verdes; até o
pool (T-005) o `for...of` intacto ⇒ regressão-zero trivial (mutex uncontended com `concurrency: 1`).

## Task List

### Fase 1 — Foundation: DAG puro + contratos aditivos (T-001 ∥ T-003; T-002 após T-001)

**T-001 — Parser `Deps:` + `inputs.backlog.deps_pattern` → `Task.deps`**
Reconhecer a linha canônica `Deps: T-001, T-002` no corpo indentado da Task (pattern
**configurável** via `inputs.backlog.deps_pattern`, default `Deps:` case-insensitive, espelhando
`task_id_pattern` em `resolveOptions` `todo.ts:73-82`). Materializar `task.deps: readonly
string[]` (aditivo em `Task` `types.ts:25-38`), validando o **formato** dos ids contra
`task_id_pattern`; a linha **permanece íntegra** no `task.body`. `Deps: nenhuma`/ausente ⇒ `[]`.
- **Aceite:** vírgulas/espaços/case tolerados; `nenhuma`/ausente → `[]`; `deps_pattern` custom
  respeitado; id fora do `task_id_pattern` sinalizado; `body` byte-a-byte íntegro.
- **Verificação:** `npm test -- backlog` + `npm test -- config`; `npm run typecheck`.
- **Deps:** nenhuma. **Files:** `src/backlog/todo.ts`, `src/config/schema.ts` (`backlogSchema`
  `:64-72`), `src/types.ts` (`Task` + `BacklogConfig`), testes. **Scope:** M.

**T-002 — Scheduler puro `src/scheduler/` + tipos `TaskGraph`/`TaskStatus`**
Novo módulo puro (AD-6): `buildGraph(tasks)` sobre o **Backlog completo** (`[x]` entram como
nodes pré-`done`) → `Result<TaskGraph>` com **detecção de ciclo e Dep órfã** (id ausente do
Backlog inteiro) como erro-valor (AD-5) — reusar a lógica de `detectCycles`/`buildFlowGraph`
(`warnings.ts:26,53`) como referência; `readySet(g, status)` (só Blocked com **todas** as deps
`done`, ordem de backlog no desempate); `skipDescendants(g, id)` (fecho transitivo, cobre
diamante A→{B,C}→D); `topoLayers(g)` (camadas p/ dry-run). Tipos aditivos `TaskGraph`
(`nodes`+`edges [dep,dependente]`) e `TaskStatus` do scheduler.
- **Aceite:** nodes/edges corretos do Backlog completo; ciclo e Dep órfã → `Result` de erro
  (lista o ciclo/órfã); `readySet` só libera com deps `done`, desempate por ordem de backlog;
  `skipDescendants` fecha o diamante; `topoLayers` determinístico. **Puro** (sem I/O).
- **Verificação:** `npm test -- scheduler`; `npm run typecheck`.
- **Deps:** T-001 (`Task.deps`). **Files:** `src/scheduler/*` (novo), `src/types.ts`, testes.
  **Scope:** M.

**T-003 — Config aditivo: `parallel_safe`, `on_merge_conflict`, Warning + buckets de resultado**
`Step.parallel_safe?` (aditivo em `stepBaseShape` `schema.ts:101-107` + `StepBase`
`types.ts:114-120`, default `false`, mantendo `.strict()`); `policies.git.on_merge_conflict:
'escalate' | 'rebase'` (default `escalate`, em `gitPolicySchema` `schema.ts:266-270` +
`GitPolicy` `types.ts:237-240`); **Warning estático não-fatal** (padrão `collectPipelineWarnings`
`warnings.ts:132-136`) se um Step `parallel_safe` tiver argv que aparente mutar o parent
(`git merge`/`commit`/`worktree`/`branch`/`push` ou `-C ${workspace.root}`). `RunLoopResult`
(`orchestrator.ts:918-933`) ganha os campos `paused`/`skipped` (tipo apenas; população em T-006).
Confirmar que `concurrency` (`schema.ts:317`/`types.ts:274`) está pronto para leitura.
- **Aceite:** config com `parallel_safe`/`on_merge_conflict` parseia; omissão → defaults seguros;
  Warning dispara no argv suspeito e **não** é fatal; `RunLoopResult` compila com os buckets novos.
- **Verificação:** `npm test -- config`; `npm run typecheck`.
- **Deps:** nenhuma. **Files:** `src/config/schema.ts`, `src/config/warnings.ts`, `src/types.ts`,
  `src/loop/orchestrator.ts` (tipo `RunLoopResult`), testes. **Scope:** M.

#### Checkpoint — Foundation (após T-001..T-003)
- [ ] `npm run typecheck`, `npm run lint`, `npm test` verdes.
- [ ] Contrato **aditivo** provado (nenhuma assinatura pública existente mudou; `StepContext`/
      `StepResult` intocados).
- [ ] Nada consome o grafo/mutex ainda ⇒ comportamento **byte-idêntico** ao de hoje.
- [ ] **Revisão humana antes de prosseguir** (é aqui que o coração começa).

### Fase 2 — Seção crítica + pool (sequencial: T-004 → T-005)

**T-004 — Seção crítica do parent (mutex na camada de execução de Steps) — o coração ⚠️**
Introduzir um **mutex único da Run** e serializar por trás dele **toda mutação do parent**, com
o `for...of` **intacto** (`concurrency: 1` ⇒ mutex uncontended ⇒ **byte-idêntico**):
(a) execução de comando de todo Step **não-Agente** sem `parallel_safe` — threaded via o seam
`RunShellCommand` (`shell.ts:62-65`), o `runCommand` do approval e o `ChecksRunnerPort`, **não**
via `StepContext` (intocado); (b) `commitPaths`/`isParentClean` (`worktree.ts:113/142`);
(c) no Step `approval`, o **wait humano** (`ui.requestApproval` `approval.ts:91`) fica **FORA**
do mutex — só a execução do comando aprovado (`:106-118`) entra; (d) `require_clean_parent` migra
do gate pré-task (`orchestrator.ts:1037-1041`) para **dentro** do mutex, reavaliado antes de cada
Merge/mark-done; (e) `parallel_safe: true` recebe o command-runner **não** embrulhado (opt-out).
As escritas de checkpoint ficam **fora** do mutex (já seguras por design — ver *Architecture
Decisions*; o guardrail é validado em T-010).
- **Aceite:** mutex primitivo (fila de Promise) unit-testado (aquisições serializam,
  release libera FIFO); `require_clean_parent` reavaliado **dentro**, imediatamente antes do
  merge/mark-done; approval: wait fora, exec dentro (provado por ordem de eventos com fakes);
  `parallel_safe` sai do mutex; **`concurrency: 1` byte-idêntico** (mesma sequência observável).
- **Verificação:** `npm test -- orchestrator` + `npm test -- steps`; `npm run typecheck`.
- **Deps:** T-003 (`parallel_safe`/`on_merge_conflict`). **Files:** `src/loop/orchestrator.ts`,
  `src/steps/{shell,approval,checks}.ts`, `src/git/worktree.ts`, testes. **Scope:** L (a única
  — o coração; concurrency fica em 1 ⇒ risco contido).

**T-005 — Pool de N Sessões dirigido pelo scheduler (substitui o `for...of`)**
Trocar `for (const task of tasks)` (`:1021`) por um **pool**: `Set<Promise>` de em-voo; enche até
`concurrency` com Prontas (`readySet`, ordem de backlog); a cada conclusão (`Promise.race`)
reavalia o *ready set* (desbloqueia dependentes). `buildGraph` no boundary de carga (fail-fast
antes de qualquer Task rodar). `concurrency` (`schema.ts:317`) passa a ser **lido**;
`--concurrency N` sobrescreve (`flags.X ?? config.Y`, `:957-958`, via `parsePositiveInt`).
`${iteration}` vira **índice estável** do backlog (idêntico ao dry-run — AD-4); `max_iterations`
vira **contador separado** ("Tasks iniciadas"; `skipped` não conta) no gate `:1028`.
- **Aceite:** DAG A→C, B (indep), `concurrency 2` → A e B **iniciam juntas**, C **espera** A
  `done`; pool **nunca** excede N; desempate por ordem de backlog; ciclo/Dep órfã ⇒ fail-fast
  (Run não inicia); `${iteration}` idêntico dry-run×run vivo; `concurrency: 1` sem `Deps:` =
  sequência byte-idêntica.
- **Verificação:** `npm test -- orchestrator` + `npm test -- cli`; `npm run typecheck`.
- **Deps:** T-002 (scheduler), T-004 (mutex). **Files:** `src/loop/orchestrator.ts`,
  `src/index.ts` (`--concurrency`), testes. **Scope:** L.

#### Checkpoint — Pool (após T-004..T-005)
- [ ] Dois Merges **nunca** se sobrepõem (mutex provado); wait de aprovação **não** segura o `.git`.
- [ ] `concurrency > 1` roda Tasks independentes juntas respeitando arestas; pool ≤ N.
- [ ] `concurrency: 1` + sem `Deps:` + `on_merge_conflict: escalate` = **byte-idêntico** (aceite).
- [ ] Success Criteria 1, 2, 3, 4, 7 (parcial) atendidos.

### Fase 3 — Escalonamento paralelo, cancelamento e conflito (T-006 → T-007; T-008 ∥)

**T-006 — Skip transitivo + escalonamento drenante (`pause`/`skip_task`)**
Ao falhar uma Task, `skipDescendants` marca o fecho de descendentes `skipped` e o pool
**continua drenando** as alcançáveis. Reenquadrar o bloco de escalação (`:1076-1097`):
`pause` → `paused` (checkpoint **preservado** → resumível), pula descendentes, **segue** com as
independentes (deixa de "parar a Run"); `skip_task` → checkpoint **abandonado** (`clearTask`),
segue. Popular `RunLoopResult.paused`/`skipped`. Ajustar `LoopStopReason` (`:909-915`):
`escalation_pause` deixa de encerrar a Run.
- **Aceite:** DAG A→C, B: A escala sob `pause` → C `skipped`, B **conclui**, Run drena; `paused`
  preserva o checkpoint (resumível), `skip_task` o abandona; `RunLoopResult` distingue
  `completed`/`escalated`/`paused`/`skipped`; descendente de Task falha **nunca** roda nem fica
  preso "blocked".
- **Verificação:** `npm test -- policies` + `npm test -- orchestrator`; `npm run typecheck`.
- **Deps:** T-005. **Files:** `src/loop/orchestrator.ts`, testes. **Scope:** M.

**T-007 — Parada dura (`abort_loop`) + Cancelamento por Sessão**
`abort_loop` → **cancela imediatamente** as irmãs em voo: `session.cancel()`
(`acp/session.ts:161-166`, sibling-safe, cooperativo — `prompt()` resolve `cancelled`
`:68-72,234`) em cada Sessão, aguarda o settle com timeout curto; ao expirar, como a **Run
inteira encerra**, cai para `child.kill()` do processo (`agent.ts`) + kill dos childs execa de
Steps `shell` em voo. Um comando **dentro** do mutex completa atomicamente antes do teardown.
Prompt de aprovação pendente é **abandonado**. Tasks canceladas: worktree + checkpoint
**preservados resumíveis** (OQ13). A que falhou → `escalated`.
- **Aceite:** `abort_loop` cancela em-voo via `session.cancel()` (só as alvo recebem — sibling-safe);
  **timeout → `child.kill()`** (fake registra); Run encerra; canceladas **resumíveis** (worktree +
  checkpoint intactos); `child.kill()` **nunca** para abortar UMA Task só.
- **Verificação:** `npm test -- policies` + `npm test -- acp`; `npm run typecheck`.
- **Deps:** T-006. **Files:** `src/loop/orchestrator.ts`, `src/acp/session.ts`,
  `src/steps/shell.ts` (kill do child execa), testes. **Scope:** M.

**T-008 — Conflito de merge: `on_merge_conflict: rebase`**
Duas Tasks DAG-independentes podem editar o mesmo arquivo; merges serializados ⇒ o 2º pode
conflitar. Com `on_merge_conflict: rebase`, no conflito o motor roda `git rebase <parent>` na
branch da Task (novo helper em `worktree.ts`) + re-tenta o Merge **uma vez**, **dentro** do
mutex; persistindo, cai no `on_fail`/Escalonamento. Default `escalate` = comportamento atual
(regressão-zero).
- **Aceite:** `escalate` (default) → conflito escala (=hoje); `rebase` → rebase + re-merge uma
  vez dentro do mutex; conflito persistente → `on_fail`; byte-idêntico em `concurrency: 1`.
- **Verificação:** `npm test -- orchestrator` + `npm test -- git`; `npm run typecheck`.
- **Deps:** T-004 (mutex), T-005 (merges concorrentes). **Files:** `src/loop/orchestrator.ts`,
  `src/git/worktree.ts`, testes. **Scope:** M.

#### Checkpoint — Paralelismo completo (após T-006..T-008)
- [ ] Skip transitivo + as 3 políticas de escalonamento corretas sob paralelismo.
- [ ] `abort_loop` cancela em-voo (timeout→`child.kill`), canceladas resumíveis.
- [ ] `on_merge_conflict: rebase` recupera; default `escalate` inalterado.
- [ ] Success Criteria 5, 8, 10 atendidos.

### Fase 4 — Surfaces expostas + docs (T-009 ∥ cedo; T-010 ∥ T-011; T-012 sink)

**T-009 — Store: grafo exposto (só dados, sem rendering)**
`StoreState` (`tui/store.ts:83-85`) ganha `edges: readonly [string,string][]`; `TaskStatus` da
store (`:31-39`) ganha `blocked`/`skipped`/`paused`. Derivados (`ready`/`running`/`blocked`/
`skipped`) = **funções puras** (AD-6). Novo `StoreEvent` + `case` no `reduce`. **Nenhum**
rendering novo (a store nem é emitida pelo orquestrador — fora do escopo). `findIndex` O(n)
mantido (aceitável no MVP; `Map` é pós-MVP).
- **Aceite:** `edges` + status novos expostos; derivados corretos; eventos concorrentes não
  corrompem a store (teste de concorrência); nenhum componente de render novo.
- **Verificação:** `npm test -- tui`; `npm run typecheck`.
- **Deps:** T-002 (vocabulário de status). **Files:** `src/tui/store.ts`, `src/types.ts`
  (se `StoreState`/`Edge` moram lá), testes. **Scope:** S.

**T-010 — Resume multi-in-flight**
Ao retomar: reconstrói o Grafo, marca `done` as já merjadas (**fonte da verdade = `[x]` do
`todo.md`**), **recomputa** *ready set* e `skipped` (Grafo + status; **não** persistidos). As
em-voo interrompidas/canceladas **retomam do PC** (`resumeStateFor` `state.ts:45-56` restaura
pc/visits/carry); `paused` mantém a Task resumível. `RunState`/`TaskCheckpoint` já são `Record`
(`types.ts:399-402`) — mudança mínima; `TaskStatus` de resume (`:384`) intocado.
- **Aceite:** N Tasks retomam (done via `[x]`, paused resumível, skipped recomputado, em-voo do
  PC — **não** do zero); skip/ready **não** persistidos (recomputados); **N Tasks concorrentes
  salvam checkpoint sem perda** (event loop serializa as escritas síncronas da instância única —
  guardrail; falha o teste se a escrita virar async ou a instância deixar de ser única).
- **Verificação:** `npm test -- resume` + `npm test -- cli`; `npm run typecheck`.
- **Deps:** T-005. **Files:** `src/resume/state.ts`, `src/loop/orchestrator.ts`, testes. **Scope:** M.

**T-011 — Dry-run do DAG + `--task` avisa Deps**
`--dry-run` imprime o **DAG resolvido**: **camadas topológicas** (`topoLayers`), **Concorrência
efetiva**, **ordem de Merge** prevista, + Pipeline interpolado por Task — **zero escrita**;
`${iteration}` = índice estável ⇒ dry-run e run vivo resolvem idêntico (AD-4). Opera sobre o
Backlog completo (ignora `--task`, como hoje). `--task <id>` força `concurrency = 1` e **avisa**
se a Task tiver Deps não-`done` (análogo ao aviso existente em `src/index.ts`) — roda mesmo assim.
- **Aceite:** dry-run mostra camadas + concorrência efetiva + ordem de merge, zero escrita;
  `${iteration}` idêntico dry-run×run vivo p/ a mesma Task; `--task` com Deps não-`done` avisa e
  roda isolada.
- **Verificação:** `npm test -- cli` (dry-run) + `npm test -- interp`; `npm run typecheck`.
- **Deps:** T-005 (concorrência efetiva/`--task`), T-002 (`topoLayers`). **Files:**
  `src/index.ts`, `src/loop/orchestrator.ts` (planner do dry-run), testes. **Scope:** M.

**T-012 — Docs + config + fixtures (ADR-0004 + CONTEXT.md + exemplos)**
`examples/loopy.yml`: split `create-worktree` em `git worktree add` (serializado) +
`install-deps` (`npm ci --prefix`, `parallel_safe: true`); `concurrency > 1` (comentado);
`on_merge_conflict`; linha `Deps:` no fixture. `tests/fixtures/.../todo.md` com um DAG de teste.
**ADR-0004** (Concorrência N + skip transitivo + Seção crítica na camada de Steps + cancelamento
+ `on_merge_conflict` + AD-1). Promover ao **`CONTEXT.md`** os termos novos (Aresta de
dependência, Grafo de tasks, Scheduler, Ready/Blocked/Skipped, Seção crítica do parent,
`parallel_safe`, `on_merge_conflict`, Cancelamento; precisões de Concorrência e Iteração) sem
colidir com Iteração/Tentativa/Visita nem com o flow graph de `goto`.
- **Aceite:** ADR-0004 criado e indexado; glossário atualizado; `examples/loopy.yml` com o split
  + policies + Deps; fixture com DAG; `npm run typecheck && npm run lint && npm test` verdes.
- **Verificação:** `npm run typecheck && npm run lint && npm test`.
- **Deps:** T-006, T-007, T-008, T-009, T-010, T-011. **Files:** `docs/adrs/0004-*.md`,
  `CONTEXT.md`, `examples/loopy.yml`, `tests/fixtures/project/loopy.yml` + `.../todo.md`,
  `src/config/CLAUDE.md`/`src/loop/CLAUDE.md` (intent nodes). **Scope:** M.

#### Checkpoint — Completo (após T-012)
- [ ] Todos os 11 Success Criteria da spec atendidos.
- [ ] Regressão-zero verificada (fixture sem `Deps:`, `concurrency: 1`, `escalate`).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` verdes. Pronto para review.

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| **Escrita de checkpoint concorrente** (`saveState` reescreve o arquivo inteiro, `state.ts:160-165`) | **Baixo** | **Já seguro:** instância única + escrita síncrona ⇒ event loop serializa (run-to-completion, sem yield), keyed por `taskId`. Guardrail, não mutex: manter **uma instância/Run + escrita síncrona** (invariante); teste de N escritas concorrentes (T-010). Só vira race se a escrita virar async ou instanciar por-Task |
| Mutex durante o wait de aprovação travaria o arranque | Alto | `ui.requestApproval` fica **FORA**; só a exec do comando aprovado entra (T-004, threaded via command-runner seam, não `StepContext`) |
| `child.kill()` mataria **todas** as Sessões (1 processo) | Alto | `session.cancel()` por Sessão (sibling-safe); `child.kill()` só no timeout, quando a Run inteira encerra (T-007) |
| DAG-independente ≠ merge-compatível (2º merge conflita) | Médio | `on_merge_conflict: rebase` (retry-once no mutex) ou serializar via `Deps:` (T-008) |
| Quebrar a regressão-zero ao mexer no `for...of` | Alto | `concurrency: 1` + sem `Deps:` = byte-idêntico; aceite dedicado (T-005); `for...of` intacto até T-005 |
| `${iteration}` deixa de ser monotônico sob paralelismo (era contador de runtime) | Médio | Vira **índice estável** do backlog (AD-4); `max_iterations` = contador separado (T-005) |
| Store O(n) `findIndex` vira hot path sob N Tasks | Baixo | Aceitável no MVP; `Map` é pós-MVP (spec) |
| Mutação silenciosa do parent num Step `parallel_safe` | Médio | Warning estático (T-003) + `require_clean_parent` no mutex como backstop fail-closed (T-004) |

## Parallelization

- **Paralelizável:** T-001 ∥ T-003 (raízes); T-009 (store) ramifica de T-002 e roda ao lado da
  Fase 2/3; T-010 ∥ T-011 (fan-out de T-005); T-008 ∥ T-006/T-007 (arquivos distintos).
- **Sequencial (coração):** T-001 → T-002; T-004 → T-005 → T-006 → T-007.
- **Sink:** T-012 depende de todo o conjunto funcional.

## Open Questions

Nenhuma pendente. A spec fechou OQ1–OQ19. A única decisão **mecânica** levantada no review —
**serialização das escritas de checkpoint** — foi **resolvida como guardrail** (não mutex): a
exploração confirmou que `createCheckpointPort` é **uma instância/Run** com `state` em memória e
escrita **síncrona** keyed por `taskId`, então o event loop já serializa as escritas de Tasks
concorrentes sem perda. O item foi **removido** do T-004; virou **invariante** (uma instância +
síncrona) nas *Architecture Decisions* e é **validado por teste** em T-010. Aprovação necessária:
**review humano deste plano/ordem** antes de iniciar T-001.
