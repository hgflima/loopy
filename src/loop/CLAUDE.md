# Loop — o orquestrador (loop externo), o mutex e o scheduler

## Purpose & Scope
O loop externo sobre o backlog: um **pool** de tasks dirigido pelo **scheduler** (`../scheduler/`, o *ready set* do DAG) sob o teto de `concurrency` e, para cada task, a interpretação do `pipeline` via registry (AD-2) usando um **Program counter (PC)** com Desvios (`on_fail: { goto }` / `on_success: { goto }`) e guard de Visitas (`max_step_visits`, fail-closed → escalate), aplicando `always`, `stop_conditions` e `policies.escalation`. Hospeda também o **planner do `--dry-run`** (fatia pura, sem I/O), a **fonte única do escopo** (`buildScopeVars`, AD-4) e o **mutex da seção crítica do parent** (`mutex.ts`). **Mecânica só** (AD-1).

## Entry Points & Contracts
- `runLoop(config, tasks, deps)` → `RunLoopResult` (`{ completed, escalated, paused, skipped, iterations, stoppedBy, metrics, startedAt, finishedAt }`). Marca `- [x]` **só** após o pipeline inteiro passar; task que falha **nunca** é marcada.
- `planDryRun(config, tasks, options?)` / `formatDryRunPlan(plan)`: resolve o pipeline por task, puramente funcional. Imprime arestas de desvio, bindings de agente/model/effort **e a seção `--- DAG ---`** (concorrência efetiva, camadas topológicas via `topoLayers`, ordem de merge prevista). Falha fail-fast com `InterpolationError` antes de qualquer saída.
- `resolveAgentBinding(step, resolvedAgents)` → `{ agentName, model?, effort? }`: helper **puro** (AD-6), fonte única do escopo Agente — reusado por orquestrador, step `agent` e dry-run.
- `mutex.ts` — `createMutex()` / `guarded()`. O mutex é **construído aqui** e injetado no registry; o *enforcement* por step mora em `../steps/` (só os não-agente, e só sem `parallel_safe`).
- Outros exports usados fora: `worktreePathFor`, `deriveChange` (fonte do `${change.*}`), `resolveAgentLabel`, `formatOnFail`, `stripDepsLine`, `AbortPort`, `CANCEL_TIMEOUT_MS`.
- Ports (fábricas aqui): `createMarkDonePort` (reescreve+commita o mark, idempotente, sem commit vazio), `createCheckpointPort` (resume via `.loopy/state.json`). `OrchestratorDeps` é o conjunto de deps do orquestrador — **maior que o `StepContext`**: `parentMutex`, `abort`, `now`, `knownTaskIds` e `checkpoint` ficam fora do contexto de step.

## Usage Patterns
- O PC avança conforme o resultado: sucesso sem `on_success` → `PC += 1`; Desvio → `PC = stepIndex[goto]`; falha com `escalate` → terminal. Em qualquer terminal, Steps `always:true` (teardown) rodam em ordem declarada, sem PC/salto. **Mas o teardown é suprimido** quando o terminal falhou E `keep_worktree` está ligado (não roda **nenhum** `always`, não só o de remover worktree).
- **CLI sobrepõe o yml**: `--concurrency` e `--max-iterations` sobrescrevem os valores do config; `--task` força `concurrency = 1`.
- **Sessões por-`(Agente, Worktree)` (ADR-0006):** `Map<agentName, AgentSession>` por Task; `buildTaskStepContext` resolve o Agente por Step via `resolveAgentBinding`. `SessionProvider = (agentName, cwd) => Promise<AgentSession>` — o orquestrador é agnóstico a "qual pool/quantos processos" (isso é do `index.ts`).

## Anti-patterns
- Não hardcodar ordem de steps, prompts, comandos ou política de escalação aqui — tudo vem do `config`.
- Não marcar task done antes do pipeline inteiro passar, nem commitar mark quando o arquivo não mudou.
- Não assumir que `ctx.git`/`ctx.session` estão vivos no spine sem-agente: os handles `notWired*` falham alto de propósito — **exceto** `drainUsage`/`readCost`, que retornam `null` (a captura de métricas depende de eles não lançarem).
- Não usar `readySet` sem `skipDescendants`: são um par obrigatório (ver Pitfalls), sob pena de travar o pool.

## Dependencies & Edges
- Contratos/ports: `../types.ts`. Registry: `../steps/`. Interpolação: `../interp/`. Resume: `../resume/state.ts`. Backlog: `../backlog/todo.ts`. Métricas: `../metrics/`. **Scheduler: `../scheduler/`**. Eventos: `../tui/store.ts` (`StoreEvent`).
- Montado por `../index.ts` (`defaultRunLive`), que injeta git/checks/ui/session reais.

## Patterns & Pitfalls
- **`../scheduler/` é a fatia pura do DAG** (sem node próprio: 285 linhas, um único consumidor — este módulo). API: `buildGraph` (erros como valores; **dep órfã é validada antes de ciclo**), `readySet`, `skipDescendants`, `topoLayers` (só no dry-run). Três armadilhas:
  1. **Há DOIS mapas de status, e eles discordam de propósito.** No mapa **do scheduler**, *toda* Task começa `"blocked"` e o `readySet` só promove nós `blocked` cujas deps estão todas `done`. Já o status **de exibição** (evento `task_registered` → TUI/GUI) nasce `"ready"` quando a Task não tem deps. Não unifique os dois sem entender: setar `"ready"` no mapa do scheduler faria a Task **nunca** ser promovida (o `readySet` a ignoraria) e o pool travaria.
  2. `readySet` exige que **toda dep esteja `done`**. Dep `skipped`/`escalated`/`paused` **nunca** libera o dependente — quem evita o deadlock é `skipDescendants`, que move os descendentes de `blocked` → `skipped`.
  3. **O scheduler não conhece `concurrency`**: o teto (`inFlight.size >= concurrency`) é aplicado aqui, no orquestrador.
- **`stripDoneDeps`** roda antes do `buildGraph`: deps já concluídas são removidas; deps para ids **desconhecidos** são **mantidas de propósito** para virar erro "Dep órfã" fail-fast. É o que faz `--task` e runs parciais funcionarem.
- **Escalação (T-006):** `decideEscalation` retorna "parar" **só** para `abort_loop`. **`pause` e `skip_task` continuam drenando o DAG**: `pause` marca `paused[]` e preserva o checkpoint; `skip_task` empurra a task para **`escalated[]`** (não para `skipped[]`). `skipped[]` é **exclusivamente** o fecho transitivo dos descendentes.
- **Ordem**: o loop **não** itera o backlog em ordem — a ordem de backlog é só o critério de desempate dentro do ready set. `${iteration}` = índice estável no backlog (AD-4); `max_iterations` = contador separado ("Tasks iniciadas").
- **`require_clean_parent` tem dois checks**: um hint best-effort antes de cada launch, e o **autoritativo dentro do mutex**, no mark-done. Armadilha: quando o mark-done vê o parent sujo, a task fica com status `done` no scheduler e emite `task_finished status:done`, mas **não entra em `completed[]` e não limpa o checkpoint** — ela "some" das listas do relatório.
- **`stop_conditions` são checadas antes de cada launch**, não no topo de uma iteração: com o pool saturado, o `stop_signal_file` só é notado quando uma task termina.
- **Resume (C-0004):** o `pc` persistido é o **id do step (string)**, não um índice — é o que faz o checkpoint sobreviver a reordenação; combinado com `pipelineFingerprint`, um rename/edição de step invalida e recomeça a task. `pruneOrphans` limpa checkpoints fora do backlog. Task **`aborted` só é retomada com `--task`**.
- **Rebase-recovery é condicional tripla**: só dispara com `policies.git.on_merge_conflict === "rebase"` **E** `deps.git` presente **E** `git.isMergeInProgress()` (MERGE_HEAD). Merge que falha sem MERGE_HEAD cai no `on_fail` normal.
- **`worktreePath` do `StepContext` é o workspace ROOT**, não o dir do worktree: os comandos git que criam/derrubam o worktree endereçam-no via `${worktree.path}` e precisam rodar de um dir que sobreviva a ele. O ACP do step agent define seu próprio cwd = worktree (AD-3).
- **Amostragem de métricas (C-0005)**: o orquestrador é o **único escritor de Amostras**. `timedExecute` envolve os **dois** sites de execução (loop do PC + teardown `always`) com um `clock` injetável e grava `{ durationMs, usage, cost }`. **Amostra = uma Visita efetivamente executada** (step pulado ou barrado pelo guard não gera Amostra). Custo por-Task = **soma** dos snapshots finais de cada Sessão da Task (ADR-0006).
- **Emit seam (ADR-0005)**: `OrchestratorDeps.emit?(event)` espelha o que o orquestrador owna — `pipeline_declared`, `edges_set`, `task_registered`, `task_started`, `task_finished { status }`, `step_started`/`step_finished` — e `buildTaskStepContext` propaga o mesmo sink como `StepContext.emit`. Aditivo, síncrono, best-effort, **fora** da seção crítica; `RunLoopResult` é byte-idêntico com e sem `emit` (AD-1).
- `RunMetrics.index` é **hardcoded `0`** — quem quiser numerar Runs usa o índice do array `runs[]`.
