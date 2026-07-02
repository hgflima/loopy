# Backlog: `loopy` — Motor de Loop Agêntico Config-Driven via ACP

> Formato consumível pelo próprio `loopy` (`- [ ] T-NNN: título` + corpo indentado).
> Detalhes, acceptance criteria e verificação completos em `tasks/plan.md`.
> Invariante em toda task: o motor só interpreta o `loopy.yml` — nada de loop hardcoded (AD-1).
>
> Decisões de implementação fechadas (ver tabela em `tasks/plan.md`):
> OQ1 interpolação de chave desconhecida → abortar (fail-fast).  OQ2 approval na TUI → useInput + port requestApproval().
> OQ3 texto do agente → buffer próprio por turno (reset por prompt), readText fallback.  OQ4 ChecksReport → head+tail por check.
> OQ5 fake agent → scriptable (scenario-driven).  OQ6 --task → fora de escopo + aviso não-bloqueante.

## Fase 0 — Fundação & Walking Skeleton (`--dry-run`)

- [ ] T-001: Scaffold do projeto + types.ts
      package.json (ESM, scripts dev/typecheck/lint/format/test) + tsconfig estrito +
      eslint/prettier + vitest + layout do SPEC (stubs) + src/types.ts com Task, StepConfig,
      StepResult, ChecksReport, LoopyConfig, StepContext e a interface Step (AD-2).
      Só as deps do SPEC — nenhuma nova. Verify: typecheck/lint/test verdes.

- [ ] T-002: Schema + loader do loopy.yml (zod)
      config/schema.ts (zod para workspace/acp/inputs/checks/pipeline união discriminada das
      4 primitivas + verify/stop_conditions/policies/logging) e config/load.ts (parse YAML,
      valida, defaults, erro claro). Valida o loopy.yml de exemplo. Depende de T-001.

- [ ] T-003: Parser de backlog (todo.md)
      backlog/todo.ts: parse de checkboxes, id (T-\d+)/slug/title/body (bloco indentado),
      mark_done idempotente que preserva o arquivo. Fixtures. Depende de T-001.

- [ ] T-004: Resolver de interpolação ${...}
      interp/resolver.ts: substituição simples do escopo (task/worktree/iteration/attempt/
      checks.report/inputs/workspace). [OQ1] chave desconhecida ABORTA com erro claro (var+step);
      conhecida-porém-vazia renderiza vazio. retry_prompt vs prompt, resolvido 1x/tentativa. Depende de T-001.

- [ ] T-005: CLI entrypoint + --dry-run (fatia vertical)
      index.ts (commander: [dir] + --config/--dry-run/--task/--max-iterations/--yes/--no-tui/
      --verbose). --dry-run carrega config+backlog, resolve interpolação e imprime o pipeline
      resolvido SEM escrita/commit/merge (Success Criterion #8). Depende de T-002,T-003,T-004.

## Checkpoint A — typecheck/lint/test verdes; --dry-run sem efeitos; schema valida o exemplo. Revisão humana.

## Fase 1 — Spine de execução sem-agente (git + checks + steps + orquestrador)

- [ ] T-006: Checks runner (execa)
      checks/runner.ts: roda lista nomeada via execa no cwd do worktree, SEM fail-fast, agrega
      exit/stdout/stderr num ChecksReport (= ${checks.report}). [OQ4] truncamento head+tail por check
      (orçamento por-check + teto global ~32KB), passing colapsa p/ 1 linha, marcador de elisão. Depende de T-001.

- [ ] T-007: Módulo de git worktree (execa, repo temporário)
      git/worktree.ts: add/remove worktree, merge --no-ff (+on_conflict: merge --abort),
      require_clean_parent. Testado contra repo git temporário real. Depende de T-001.

- [ ] T-008: Interpretadores dos steps shell e checks
      steps/shell.ts (run/always/on_fail, interpolado) e steps/checks.ts (lista nomeada -> runner),
      ambos via Step.execute (AD-2). Depende de T-004,T-006.

- [ ] T-009: Interpretador do step approval
      steps/approval.ts: gate humano (prompt) + ação (run) + on_conflict; --yes auto-aprova;
      pause sem TTY escala. [OQ2] decisão lida via port ctx.ui.requestApproval() (TUI/readline/--yes),
      orquestrador agnóstico e mockável. Depende de T-004,T-007.

- [ ] T-010: Orquestrador — laço externo sobre steps não-agente
      loop/orchestrator.ts: itera backlog, interpola contexto, executa pipeline via registry de
      steps (AD-2), respeita ordem/always/on_fail, stop_conditions e escalation, marca - [x] só
      no fim + commita a marcação. Step agent ainda não registrado. Depende de T-005,T-007,T-008,T-009.

## Checkpoint B — pipeline não-agente fim-a-fim sobre repo temporário; always/stop/escalation testados; AD-1 respeitado. Revisão humana.

## Fase 2 — Fatia do agente ACP (o coração)

- [ ] T-011: Processo ACP + handlers do cliente
      acp/agent.ts (spawn npx claude-agent-acp, ndJsonStream, builder client(), connectWith,
      initialize, shutdown — 1 processo/run) e acp/client.ts (handlers antes do connect:
      request_permission por kind, fs read/write, terminal, session/update -> onUpdate +
      buffer de texto por turno [OQ3]). Introduz o fake agent scriptable/scenario-driven [OQ5]. Depende de T-001.

- [ ] T-012: Sessão ACP por task
      acp/session.ts: buildSession(cwd).start(), setMode (session/set_mode), clear (/clear),
      prompt->stopReason; texto do turno via buffer próprio resetado por prompt, readText fallback [OQ3];
      cancel, teardown; non-end_turn = falha; pool keyed por worktree (parallel-ready). Depende de T-011.

- [ ] T-013: Parser de veredito (AUDIT: PASS/FAIL)
      steps/verdict.ts: parse tolerante da última ocorrência de AUDIT: PASS / AUDIT: FAIL: <motivo>
      sobre o buffer de texto do turno do audit [OQ3] (não o readText cumulativo); ausência = FAIL.
      Puro. Paralelizável com T-011/T-012. Depende de T-001.

- [ ] T-014: Interpretador do step agent (loop interno)
      steps/agent.ts (Step.execute): clear_context/mode/prompt/retry_prompt, loop interno verify
      (prompt->checks->re-prompta com ${checks.report} até passar ou esgotar max_attempts->on_fail),
      gate expect + on_expect_fail (via T-013), non-end_turn = falha. Depende de T-004,T-006,T-012,T-013.

- [ ] T-015: Registrar agent no orquestrador — pipeline completo E2E
      Plugar agent no registry e rodar o pipeline do exemplo (create-worktree->implement->simplify->
      audit->commit->merge->cleanup) para 1 task contra fake agent + repo temporário. Mark-done só
      com checks verdes + AUDIT: PASS + merge; falha preserva worktree e escala. Depende de T-010,T-014.

## Checkpoint C — pipeline completo fim-a-fim para 1 task (fake agent); mark-done gateado; AD-1 respeitado. Revisão humana.

## Fase 3 — TUI ao vivo + observabilidade

- [ ] T-016: Store observável + logging
      tui/store.ts (estado observável parallel-ready, sem singleton de "task atual") + logging/
      logger.ts (log por task em .loopy/logs/<id>.log + captura de tráfego ACP quando
      capture_acp_traffic). Depende de T-010,T-011.

- [ ] T-017: TUI Ink + fallback de linha
      tui/App.tsx + components/ (TaskRow, CheckStatus, StreamPane, ApprovalPrompt): árvore de
      progresso ao vivo lendo o store (lista de tasks, try k/max, status por check, stream).
      Fallback para logs de linha sem TTY / --no-tui. Depende de T-016.

## Checkpoint D — TUI ao vivo + fallback de linha; logs por task + tráfego ACP. Revisão humana.

## Fase 4 — Hardening & aceitação total

- [ ] T-018: Stop conditions, escalonamento, git-init e flags restantes
      Completa stop_conditions (max_iterations, stop_signal_file), escalation (pause/skip_task/
      abort_loop + keep_worktree/notify), require_clean_parent no início da task, setup git de 1º
      run (git init + commit inicial + .gitignore, atrás de aprovação) e flags --task/--max-iterations/
      --config/--verbose. [OQ6] --task avisa (não bloqueia) se houver tasks - [ ] anteriores pendentes.
      Depende de T-015.

- [ ] T-019: Passagem de aceitação + loopy.yml de exemplo + docs
      Valida Success Criteria #1-#8 fim-a-fim; loopy.yml de exemplo casa com o schema final;
      README/uso; .gitignore (.worktrees/, .loopy/, .loopy.stop); nada temporário sobra ao final.
      Depende de T-016,T-017,T-018.

## Checkpoint E — todos os Success Criteria atendidos; parent verde e sem lixo; loop 100% dirigido pelo yml. Revisão humana final.
