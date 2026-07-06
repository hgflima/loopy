# Loop — o orquestrador (loop externo)

## Purpose & Scope
O loop externo sobre o backlog: itera as tasks pendentes em ordem e, para cada uma, interpreta o `pipeline` do yml via registry (AD-2) usando um **Program counter (PC)** sobre `Map<id, índice>` com Desvios (`on_fail: { goto }` / `on_success: { goto }`) e guard de Visitas (`max_step_visits`, fail-closed → escalate), aplicando `always`, `stop_conditions` e `policies.escalation`. Também hospeda o **planner do `--dry-run`** (fatia pura, sem I/O — imprime arestas de desvio e bindings de agente/model/effort por Step) e a **fonte única do escopo** (`buildScopeVars`) que dry-run e run vivo compartilham (AD-4). **Mecânica só** (AD-1): ordem, desvios, `always`, ações de escalação e limiares vêm de `config`; trocar comportamento é editar o yml, nunca este arquivo.

## Entry Points & Contracts
- `runLoop(config, tasks, deps)` → `RunLoopResult` (`{ completed, escalated, iterations, stoppedBy, metrics, startedAt, finishedAt }` — os 3 últimos aditivos, C-0005). Marca `- [x]` **só** após o pipeline inteiro passar; task que falha é **nunca** marcada, escala.
- `planDryRun(config, tasks)` / `formatDryRunPlan(plan)`: resolve o pipeline por task, puramente funcional, sem write/git/ACP. Resolve bindings de agente/model/effort por Step via `resolveAgentBinding` (ADR-0006). Falha fail-fast com `InterpolationError` antes de qualquer saída.
- `resolveAgentBinding(step, resolvedAgents)` → `{ agentName, model?, effort? }`: helper **puro** (AD-6) que resolve o Agente/model/effort para um Step. Fonte única do escopo Agente, reusada por: orquestrador (escolher Sessão), step `agent` (aplicar `setModel`/`setEffort`), dry-run (imprimir).
- Ports (fábricas aqui): `createMarkDonePort` (reescreve+commita o mark, idempotente, sem commit vazio), `createCheckpointPort` (resume via `.loopy/state.json`). `OrchestratorDeps` é o conjunto de ports que constrói o `StepContext`.

## Usage Patterns
- O PC avança conforme o resultado: sucesso sem `on_success` → `PC += 1`; Desvio → `PC = stepIndex[goto]`; falha com `escalate` → terminal. Em qualquer terminal (sucesso ou escalate), Steps `always:true` (teardown) rodam em ordem declarada, sem PC/salto — desvios neles são ignorados. `keep_worktree` preserva o worktree falho para inspeção.
- `stop_conditions` checadas no topo de cada iteração → `stop_signal_file` "encerra após a task corrente".
- `require_clean_parent`: nunca prosseguir sobre parent sujo; checado antes de CADA task (merge/mark-done pode sujar no meio).
- **Sessões por-`(Agente, Worktree)` (ADR-0006):** a sessão lazy única por Task virou um `Map<agentName, AgentSession>`. `buildTaskStepContext` resolve o Agente por Step via `resolveAgentBinding` e injeta `ctx.session` do par `(agentName, worktreePath)` — Steps não-`agent` não tocam Sessão.
- `SessionProvider = (agentName, cwd) => Promise<AgentSession>`: o orquestrador fica agnóstico a "qual pool/quantos processos" — isso é do `index.ts`.

## Anti-patterns
- Não hardcodar ordem de steps, prompts, comandos ou política de escalação aqui — tudo vem do `config`.
- Não marcar task done antes do pipeline inteiro passar, nem commitar mark quando o arquivo não mudou (evita commit vazio).
- Não assumir que `ctx.git`/`ctx.session` estão vivos no spine sem-agente: os handles `notWired*` falham alto de propósito.

## Dependencies & Edges
- Contratos/ports: `../types.ts`. Registry: `../steps/`. Interpolação: `../interp/`. Resume: `../resume/state.ts`. Backlog: `../backlog/todo.ts`. Métricas: `../metrics/` (`foldSamples` das Amostras).
- Montado por `../index.ts` (`defaultRunLive`), que injeta git/checks/ui/session reais.

## Patterns & Pitfalls
- **`worktreePath` do `StepContext` é o workspace ROOT, não o dir do worktree**: os comandos git que criam/derrubam o worktree endereçam-no via `${worktree.path}` e precisam rodar de um dir que sobreviva a ele. O ACP do step agent define seu próprio cwd = worktree (AD-3), independente disso.
- Step `type` sem intérprete registrado = no-op logado (não falha) — foi o que permitiu provar o spine antes do `agent`.
- Resume (PC-based, C-0004): `resumeStateFor` retorna `ResumePoint` (pc + visits + carry) para retomar de onde parou; `pruneOrphans` limpa checkpoints de tasks fora do backlog; mudança de `pipelineHash` desde o checkpoint → recomeça a task. Progresso salvo a cada transição de PC via `saveProgress`.
- `decideEscalation`: `skip_task` → continua; `pause`/`abort_loop` → para (com `setStatus` paused/aborted).
- **Amostragem de métricas (C-0005)**: o orquestrador é o **único escritor de Amostras**. `timedExecute` envolve os **dois** sites de execução (loop do PC + steps `always` do teardown) com um `clock` injetável (`deps.now ?? Date.now`) e, logo após `execute()`, grava `{ durationMs, usage: session.drainUsage(), cost: session.readCost() }`. **Amostra = uma Visita efetivamente executada**: Step pulado (sem intérprete) ou barrado pelo guard de Visitas não gera Amostra. `runTaskPipeline` faz `foldSamples` por `id` → `TaskMetrics`; `runLoop` monta `RunMetrics`. Só ativo quando `config.metrics` existe (aditivo — ADR-0003). **Custo multi-Sessão (ADR-0006):** custo por-Task = soma dos snapshots finais de cada Sessão da Task (itera o `Map<agentName, session>`), not mais "último snapshot".
- **Pool de N Sessões (C-0006, ADR-0004)**: o `for...of` sequencial foi substituído por um pool (`Set<Promise>`) dirigido pelo scheduler (`src/scheduler/`). `buildGraph` valida o DAG fail-fast; `readySet` escolhe as próximas sob `concurrency` (ordem de backlog). A cada conclusão (`Promise.race`), reavalia o *ready set* (desbloqueia dependentes). **Seção crítica**: mutex único serializa a execução de Steps não-Agente sem `parallel_safe` + `commitPaths`/`isParentClean`; wait de aprovação fica **fora**; `require_clean_parent` reavaliado **dentro**. `${iteration}` = índice estável (AD-4); `max_iterations` = contador separado. `RunLoopResult` += `paused`/`skipped`. Skip transitivo propaga falha pelo DAG. Cancelamento via `session.cancel()` (sibling-safe); `child.kill()` só no timeout da parada dura. `on_merge_conflict: rebase` faz auto-rebase + retry-once dentro do mutex.
- **Emit seam (C-0007, ADR-0005)**: `OrchestratorDeps.emit?(event)` espelha as transições de que o orquestrador é dono (`edges_set` na carga do grafo; `task_*` em launch/done/escalate/pause/skip; `step_started`/`step_finished` em torno de `timedExecute` nos dois sites) para a store da TUI, e `buildTaskStepContext` propaga o mesmo sink como `StepContext.emit`. **Aditivo**, síncrono, best-effort, **fora** da seção crítica do parent; `RunLoopResult` é **byte-idêntico** com e sem `emit` (AD-1).
