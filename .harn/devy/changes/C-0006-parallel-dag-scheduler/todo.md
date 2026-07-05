# Backlog: C-0006 — Paralelismo de Tasks dirigido pelo DAG do backlog

> Consumido pelo motor (`- [ ]` pendente / `- [x]` concluída; id `T-\d+`; corpo indentado).
> A linha `Deps:` é canônica (o parser passa a reconhecê-la a partir de T-001).
> Narrativa, dependency graph, âncoras de código, checkpoints e riscos: ver `plan.md`.

## Fase 1 — Foundation: DAG puro + contratos aditivos (T-001 ∥ T-003; T-002 após T-001)

- [x] T-001: Parser `Deps:` + `inputs.backlog.deps_pattern` → `Task.deps`
    Reconhecer a linha canônica `Deps: T-001, T-002` no corpo indentado da Task (pattern configurável via `inputs.backlog.deps_pattern`, default `Deps:` case-insensitive, espelhando `task_id_pattern` em `resolveOptions` `todo.ts:73-82`). Materializar `task.deps: readonly string[]` (aditivo em `Task` `types.ts:25-38`), validando o formato dos ids contra `task_id_pattern`; a linha permanece íntegra no `task.body`. `Deps: nenhuma`/ausente ⇒ `[]`.
    Aceite: vírgulas/espaços/case tolerados; `nenhuma`/ausente → `[]`; `deps_pattern` custom respeitado; id fora do `task_id_pattern` sinalizado; `body` byte-a-byte íntegro.
    Verificação: `npm test -- backlog` && `npm test -- config` && `npm run typecheck`.
    Deps: nenhuma. Files: src/backlog/todo.ts, src/config/schema.ts, src/types.ts, testes. Scope: M.

- [x] T-002: Scheduler puro `src/scheduler/` + tipos `TaskGraph`/`TaskStatus`
    Módulo puro (AD-6): `buildGraph(tasks)` sobre o Backlog COMPLETO (`[x]` como nodes pré-`done`) → `Result<TaskGraph>` detectando ciclo e Dep órfã (erro-valor, AD-5; reusar `detectCycles`/`buildFlowGraph` de `warnings.ts:26,53` como referência); `readySet` (só Blocked com TODAS as deps `done`; desempate ordem de backlog); `skipDescendants` (fecho transitivo, diamante A→{B,C}→D); `topoLayers` (camadas p/ dry-run). Tipos aditivos `TaskGraph` (nodes+edges `[dep,dependente]`) e `TaskStatus`.
    Aceite: nodes/edges corretos; ciclo e Dep órfã → Result de erro (lista o ciclo/órfã); `readySet` só com deps `done` e desempate por ordem de backlog; `skipDescendants` fecha o diamante; `topoLayers` determinístico; módulo puro (sem I/O).
    Verificação: `npm test -- scheduler` && `npm run typecheck`.
    Deps: T-001. Files: src/scheduler/* (novo), src/types.ts, testes. Scope: M.

- [ ] T-003: Config aditivo — `parallel_safe`, `on_merge_conflict`, Warning + buckets de resultado
    `Step.parallel_safe?` (em `stepBaseShape` `schema.ts:101-107` + `StepBase` `types.ts:114-120`, default `false`, mantendo `.strict()`); `policies.git.on_merge_conflict: 'escalate' | 'rebase'` (default `escalate`, em `gitPolicySchema` `schema.ts:266-270` + `GitPolicy` `types.ts:237-240`); Warning estático não-fatal (padrão `collectPipelineWarnings` `warnings.ts:132-136`) se Step `parallel_safe` tiver argv que aparente mutar o parent. `RunLoopResult` (`orchestrator.ts:918-933`) ganha `paused`/`skipped` (tipo; população em T-006). Garantir `concurrency` (`schema.ts:317`) legível.
    Aceite: config com os campos novos parseia; omissão → defaults seguros; Warning dispara no argv suspeito e não é fatal; `RunLoopResult` compila com os buckets.
    Verificação: `npm test -- config` && `npm run typecheck`.
    Deps: nenhuma. Files: src/config/schema.ts, src/config/warnings.ts, src/types.ts, src/loop/orchestrator.ts, testes. Scope: M.

## Fase 2 — Seção crítica + pool (sequencial: T-004 → T-005)

- [ ] T-004: Seção crítica do parent (mutex na camada de execução de Steps) — o coração
    Mutex único da Run serializando TODA mutação do parent, com o `for...of` intacto (`concurrency: 1` ⇒ uncontended ⇒ byte-idêntico): (a) execução de comando de Step não-Agente sem `parallel_safe`, threaded via o seam `RunShellCommand` (`shell.ts:62-65`)/`runCommand` do approval/`ChecksRunnerPort`, NÃO via `StepContext` (intocado); (b) `commitPaths`/`isParentClean` (`worktree.ts:113/142`); (c) approval: wait humano (`ui.requestApproval` `approval.ts:91`) FORA, só a exec do comando aprovado (`:106-118`) dentro; (d) `require_clean_parent` migra do gate pré-task (`orchestrator.ts:1037-1041`) para DENTRO do mutex, antes de cada Merge/mark-done; (e) `parallel_safe: true` recebe o runner não-embrulhado. As escritas de checkpoint ficam FORA do mutex (já seguras por design: `createCheckpointPort` é instância única + escrita síncrona keyed por taskId ⇒ event loop serializa; guardrail validado em T-010).
    Aceite: mutex primitivo (fila de Promise) unit-testado (aquisições serializam, release FIFO); `require_clean_parent` reavaliado dentro, antes do merge/mark-done; approval wait fora / exec dentro (ordem de eventos com fakes); `parallel_safe` fora; `concurrency: 1` byte-idêntico.
    Verificação: `npm test -- orchestrator` && `npm test -- steps` && `npm run typecheck`.
    Deps: T-003. Files: src/loop/orchestrator.ts, src/steps/shell.ts, src/steps/approval.ts, src/steps/checks.ts, src/git/worktree.ts, testes. Scope: L. RISCO ALTO.

- [ ] T-005: Pool de N Sessões dirigido pelo scheduler (substitui o `for...of`)
    Trocar `for (const task of tasks)` (`orchestrator.ts:1021`) por um pool: `Set<Promise>` de em-voo; enche até `concurrency` com Prontas (`readySet`, ordem de backlog); a cada conclusão (`Promise.race`) reavalia o ready set. `buildGraph` no boundary de carga (fail-fast antes de qualquer Task rodar). `concurrency` passa a ser LIDO; `--concurrency N` sobrescreve (`flags.X ?? config.Y` `:957-958`). `${iteration}` vira índice estável do backlog (idêntico ao dry-run — AD-4); `max_iterations` vira contador separado ("Tasks iniciadas"; `skipped` não conta).
    Aceite: DAG A→C, B (indep), `concurrency 2` → A e B iniciam juntas, C espera A `done`; pool nunca excede N; desempate por ordem de backlog; ciclo/Dep órfã ⇒ fail-fast; `${iteration}` idêntico dry-run×run vivo; `concurrency: 1` sem `Deps:` = sequência byte-idêntica.
    Verificação: `npm test -- orchestrator` && `npm test -- cli` && `npm run typecheck`.
    Deps: T-002, T-004. Files: src/loop/orchestrator.ts, src/index.ts, testes. Scope: L.

## Fase 3 — Escalonamento paralelo, cancelamento e conflito (T-006 → T-007; T-008 ∥)

- [ ] T-006: Skip transitivo + escalonamento drenante (`pause`/`skip_task`)
    Ao falhar, `skipDescendants` marca o fecho de descendentes `skipped` e o pool continua drenando as alcançáveis. Reenquadrar o bloco de escalação (`orchestrator.ts:1076-1097`): `pause` → `paused` (checkpoint preservado → resumível), pula descendentes, segue com independentes (deixa de "parar a Run"); `skip_task` → checkpoint abandonado (`clearTask`), segue. Popular `RunLoopResult.paused`/`skipped`. Ajustar `LoopStopReason` (`:909-915`): `escalation_pause` deixa de encerrar a Run.
    Aceite: DAG A→C, B: A escala sob `pause` → C `skipped`, B conclui, Run drena; `paused` preserva o checkpoint, `skip_task` o abandona; `RunLoopResult` distingue completed/escalated/paused/skipped; descendente de Task falha nunca roda nem fica preso "blocked".
    Verificação: `npm test -- policies` && `npm test -- orchestrator` && `npm run typecheck`.
    Deps: T-005. Files: src/loop/orchestrator.ts, testes. Scope: M.

- [ ] T-007: Parada dura (`abort_loop`) + Cancelamento por Sessão
    `abort_loop` → cancela imediatamente as irmãs em voo: `session.cancel()` (`acp/session.ts:161-166`, sibling-safe, cooperativo — `prompt()` resolve `cancelled` `:68-72,234`) em cada Sessão, aguarda o settle com timeout; ao expirar, `child.kill()` do processo (`agent.ts`) + kill dos childs execa de Steps shell em voo (a Run inteira encerra). Comando dentro do mutex completa atomicamente. Prompt de aprovação pendente abandonado. Tasks canceladas: worktree + checkpoint preservados resumíveis (OQ13); a que falhou → `escalated`.
    Aceite: `abort_loop` cancela em-voo via `session.cancel()` (só as alvo — sibling-safe); timeout → `child.kill()` (fake registra); Run encerra; canceladas resumíveis (worktree+checkpoint intactos); `child.kill()` nunca para abortar UMA Task só.
    Verificação: `npm test -- policies` && `npm test -- acp` && `npm run typecheck`.
    Deps: T-006. Files: src/loop/orchestrator.ts, src/acp/session.ts, src/steps/shell.ts, testes. Scope: M.

- [ ] T-008: Conflito de merge — `on_merge_conflict: rebase`
    Com `on_merge_conflict: rebase`, no conflito o motor roda `git rebase <parent>` na branch da Task (novo helper em `worktree.ts`) + re-tenta o Merge uma vez, DENTRO do mutex; persistindo, cai no `on_fail`/Escalonamento. Default `escalate` = comportamento atual (regressão-zero).
    Aceite: `escalate` (default) → conflito escala (=hoje); `rebase` → rebase + re-merge uma vez dentro do mutex; conflito persistente → `on_fail`; byte-idêntico em `concurrency: 1`.
    Verificação: `npm test -- orchestrator` && `npm test -- git` && `npm run typecheck`.
    Deps: T-004, T-005. Files: src/loop/orchestrator.ts, src/git/worktree.ts, testes. Scope: M.

## Fase 4 — Surfaces expostas + docs (T-009 ∥ cedo; T-010 ∥ T-011; T-012 sink)

- [ ] T-009: Store — grafo exposto (só dados, sem rendering)
    `StoreState` (`tui/store.ts:83-85`) ganha `edges: readonly [string,string][]`; `TaskStatus` da store (`:31-39`) ganha `blocked`/`skipped`/`paused`. Derivados (ready/running/blocked/skipped) = funções puras (AD-6). Novo `StoreEvent` + `case` no `reduce`. Nenhum rendering novo (a store não é emitida pelo orquestrador — fora do escopo). `findIndex` O(n) mantido (MVP; `Map` pós-MVP).
    Aceite: `edges` + status novos expostos; derivados corretos; eventos concorrentes não corrompem a store (teste de concorrência); nenhum componente de render novo.
    Verificação: `npm test -- tui` && `npm run typecheck`.
    Deps: T-002. Files: src/tui/store.ts, src/types.ts, testes. Scope: S.

- [ ] T-010: Resume multi-in-flight
    Ao retomar: reconstrói o Grafo, marca `done` as já merjadas (fonte da verdade = `[x]` do `todo.md`), recomputa ready set e `skipped` (Grafo + status; NÃO persistidos). Em-voo interrompidas/canceladas retomam do PC (`resumeStateFor` `state.ts:45-56` restaura pc/visits/carry); `paused` mantém resumível. `RunState`/`TaskCheckpoint` já são `Record` (`types.ts:399-402`) — mudança mínima; `TaskStatus` de resume (`:384`) intocado.
    Aceite: N Tasks retomam (done via `[x]`, paused resumível, skipped recomputado, em-voo do PC — não do zero); skip/ready não persistidos; N Tasks concorrentes salvam checkpoint sem perda (event loop serializa a escrita síncrona da instância única — guardrail; o teste falha se a escrita virar async ou a instância deixar de ser única por Run).
    Verificação: `npm test -- resume` && `npm test -- cli` && `npm run typecheck`.
    Deps: T-005. Files: src/resume/state.ts, src/loop/orchestrator.ts, testes. Scope: M.

- [ ] T-011: Dry-run do DAG + `--task` avisa Deps
    `--dry-run` imprime o DAG resolvido: camadas topológicas (`topoLayers`), Concorrência efetiva, ordem de Merge prevista + Pipeline interpolado por Task — zero escrita; `${iteration}` = índice estável ⇒ dry-run×run vivo idêntico (AD-4). Opera sobre o Backlog completo (ignora `--task`, como hoje). `--task <id>` força `concurrency = 1` e avisa se a Task tiver Deps não-`done` (análogo ao aviso existente em `src/index.ts`) — roda mesmo assim.
    Aceite: dry-run mostra camadas + concorrência efetiva + ordem de merge, zero escrita; `${iteration}` idêntico dry-run×run vivo; `--task` com Deps não-`done` avisa e roda isolada.
    Verificação: `npm test -- cli` && `npm test -- interp` && `npm run typecheck`.
    Deps: T-005. Files: src/index.ts, src/loop/orchestrator.ts, testes. Scope: M.

- [ ] T-012: Docs + config + fixtures (ADR-0004 + CONTEXT.md + exemplos)
    `examples/loopy.yml`: split `create-worktree` em `git worktree add` (serializado) + `install-deps` (`npm ci --prefix`, `parallel_safe: true`); `concurrency > 1` (comentado); `on_merge_conflict`; linha `Deps:` no fixture. `tests/fixtures/.../todo.md` com DAG de teste. ADR-0004 (Concorrência N + skip transitivo + Seção crítica na camada de Steps + cancelamento + `on_merge_conflict` + AD-1). Promover ao `CONTEXT.md` os termos novos (Aresta de dependência, Grafo de tasks, Scheduler, Ready/Blocked/Skipped, Seção crítica do parent, `parallel_safe`, `on_merge_conflict`, Cancelamento; precisões de Concorrência e Iteração) sem colidir com Iteração/Tentativa/Visita nem com o flow graph de `goto`.
    Aceite: ADR-0004 criado e indexado; glossário atualizado; `examples/loopy.yml` com split + policies + Deps; fixture com DAG; `npm run typecheck && npm run lint && npm test` verdes.
    Verificação: `npm run typecheck && npm run lint && npm test`.
    Deps: T-006, T-007, T-008, T-009, T-010, T-011. Files: docs/adrs/0004-*.md, CONTEXT.md, examples/loopy.yml, tests/fixtures/project/loopy.yml, tests/fixtures/project/todo.md, src/config/CLAUDE.md, src/loop/CLAUDE.md. Scope: M.
