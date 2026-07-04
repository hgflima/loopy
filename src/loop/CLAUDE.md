# Loop — o orquestrador (loop externo)

## Purpose & Scope
O loop externo sobre o backlog: itera as tasks pendentes em ordem e, para cada uma, interpreta o `pipeline` do yml via registry (AD-2), aplicando `always`, `stop_conditions` e `policies.escalation`. Também hospeda o **planner do `--dry-run`** (fatia pura, sem I/O) e a **fonte única do escopo** (`buildScopeVars`) que dry-run e run vivo compartilham (AD-4). **Mecânica só** (AD-1): ordem, `always`, ações de escalação e limiares vêm de `config`; trocar comportamento é editar o yml, nunca este arquivo.

## Entry Points & Contracts
- `runLoop(config, tasks, deps)` → `RunLoopResult` (`{ completed, escalated, iterations, stoppedBy }`). Marca `- [x]` **só** após o pipeline inteiro passar; task que falha é **nunca** marcada, escala.
- `planDryRun(config, tasks)` / `formatDryRunPlan(plan)`: resolve o pipeline por task, puramente funcional, sem write/git/ACP. Falha fail-fast com `InterpolationError` antes de qualquer saída.
- Ports (fábricas aqui): `createMarkDonePort` (reescreve+commita o mark, idempotente, sem commit vazio), `createCheckpointPort` (resume via `.loopy/state.json`). `OrchestratorDeps` é o conjunto de ports que constrói o `StepContext`.

## Usage Patterns
- Um step roda quando o pipeline está saudável **ou** é `always:true` (ex.: `cleanup`). Após uma falha, steps não-`always` são pulados; um `always` de teardown roda — **exceto** se `keep_worktree` (preserva o worktree falho para inspeção).
- `stop_conditions` checadas no topo de cada iteração → `stop_signal_file` "encerra após a task corrente".
- `require_clean_parent`: nunca prosseguir sobre parent sujo; checado antes de CADA task (merge/mark-done pode sujar no meio).
- Uma sessão ACP por task (`createLazySession`), aberta **lazy** no 1º uso do step agent (depois do `create-worktree`) — task sem step agent nunca abre sessão.

## Anti-patterns
- Não hardcodar ordem de steps, prompts, comandos ou política de escalação aqui — tudo vem do `config`.
- Não marcar task done antes do pipeline inteiro passar, nem commitar mark quando o arquivo não mudou (evita commit vazio).
- Não assumir que `ctx.git`/`ctx.session` estão vivos no spine sem-agente: os handles `notWired*` falham alto de propósito.

## Dependencies & Edges
- Contratos/ports: `../types.ts`. Registry: `../steps/`. Interpolação: `../interp/`. Resume: `../resume/state.ts`. Backlog: `../backlog/todo.ts`.
- Montado por `../index.ts` (`defaultRunLive`), que injeta git/checks/ui/session reais.

## Patterns & Pitfalls
- **`worktreePath` do `StepContext` é o workspace ROOT, não o dir do worktree**: os comandos git que criam/derrubam o worktree endereçam-no via `${worktree.path}` e precisam rodar de um dir que sobreviva a ele. O ACP do step agent define seu próprio cwd = worktree (AD-3), independente disso.
- Step `type` sem intérprete registrado = no-op logado (não falha) — foi o que permitiu provar o spine antes do `agent`.
- Resume: `completedStepsFor` pula steps já concluídos; `pruneOrphans` limpa checkpoints de tasks fora do backlog; mudança de `pipelineHash` desde o checkpoint → recomeça a task.
- `decideEscalation`: `skip_task` → continua; `pause`/`abort_loop` → para (com `setStatus` paused/aborted).
