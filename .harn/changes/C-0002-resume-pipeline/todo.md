# Backlog: C-0002 — Resume de pipeline no `loopy`

> Formato consumível pelo próprio `loopy` (`- [ ] T-NNN: título` + corpo indentado).
> Spec em `spec.md`; acceptance criteria e verificação completos em `plan.md` (ao lado).
> Invariante (AD-1): resume é mecânica interpretada; nada de pipeline hardcodado.
> `checkpoint?` opcional em OrchestratorDeps → regressão zero nos 405 testes.

## Fase 1 — Fundação pura (dados + fingerprint + I/O atômico)

- [x] T-020: `src/resume/state.ts` + tipos de resume em `types.ts`
      Módulo puro + wrapper de I/O no molde de backlog/todo.ts e config/load.ts.
      types.ts: TaskStatus (running|paused|aborted), TaskCheckpoint {pipelineHash,
      completedSteps, status}, RunState {version:1, tasks}, CheckpointPort
      (read/recordStep/setStatus/clearTask/pruneOrphans) e RunFlags.clean?:
      string|boolean. state.ts: pipelineFingerprint (sha256 de JSON.stringify do
      pipeline — ids+ordem+conteúdo, via node:crypto), completedStepsFor(state,id,
      currentHash,{allowAborted}) puro (vazio se ausente/hash-diverge/aborted sem
      allow), transições puras recordStepIn/setStatusIn/clearTaskIn/pruneOrphansIn,
      emptyState, loadState (tolera ausência/JSON inválido → vazio), saveState
      (mkdirSync recursivo + tmp + renameSync, nunca deixa parcial). Sem dep nova.
      Verify: tests/resume/state.test.ts + typecheck/lint verdes. Sem dependências.

## Checkpoint A — typecheck/lint/test verdes; state.test.ts cobre fingerprint estável+sensível, completedStepsFor e I/O atômico. Sem mudança no loop ainda.

## Fase 2 — Resume no orquestrador (valor central: pular concluídos)

- [ ] T-021: CheckpointPort + resume em runTaskPipeline/runLoop
      src/loop/orchestrator.ts, tudo atrás de deps.checkpoint? (ausente ⇒ idêntico
      ao atual). createCheckpointPort({statePath, pipelineHash}) no molde de
      createMarkDonePort (state em memória via loadState, transições puras de
      state.ts, saveState após cada mutação, carimba pipelineHash em recordStep/
      setStatus). OrchestratorDeps ganha checkpoint? e knownTaskIds?.
      runTaskPipeline ganha completedSteps: ReadonlySet<string> — no topo do laço,
      completedSteps.has(step.id) → log "resume: step X já concluído" + continue
      (antes do skip por falha/keep_worktree); após cada step ok, recordStep.
      runLoop reconcilia antes do laço: pipelineFingerprint(config.pipeline),
      pruneOrphans(knownTaskIds) com aviso por órfão, completedStepsFor por task
      (allowAborted = flags.task !== undefined) com aviso em hash divergente,
      setStatus "running" antes da task, clearTask no markDone, setStatus paused/
      aborted (ou clearTask no skip_task) na escalação. Depende de T-020.
      Verify: tests/loop/run-loop.test.ts (estende skip/record/status) +
      tests/loop/resume.test.ts (novo, E2E fake port) + npm test inteiro verde.

## Checkpoint B — E2E de resume: parar num step → retomar → pular concluídos → refazer só o que faltou; status paused/running/aborted tratados; regressão zero. Revisão humana antes da Fase 3.

## Fase 3 — Superfície CLI (auto-resume real + --clean)

- [ ] T-022: wire .loopy/state.json no CLI + flag --clean
      src/index.ts. execute() mantém o backlog completo (loadBacklog → knownTaskIds,
      pendingTasks para pending). toFlags mapeia clean de --clean [id]; buildProgram
      adiciona .option("--clean [id]", ...). Se flags.clean truthy → cleanFlow e
      retorna (NÃO roda o loop): alvo por id explícito ou a única entrada paused/
      running do state.json (0 ou >1 sem id → erro claro); resolve Task no backlog →
      worktreePathFor + task.branch; git.removeWorktree({force}) + git.deleteBranch
      best-effort (tolera ausência, loga); clearTask(id); imprime confirmação e sai.
      defaultRunLive monta deps.checkpoint = createCheckpointPort({statePath:
      .loopy/state.json, pipelineHash}) e deps.knownTaskIds (via RunLiveArgs).
      worktree.ts SEM mudança (Git já tem removeWorktree+deleteBranch). Depende de T-021.
      Verify: tests/cli/resume.test.ts (auto-resume detecta; --task retoma; --clean
      derruba worktree+branch+checkpoint e sai) + npm test inteiro verde.

## Checkpoint C — Todos os Success Criteria do spec (T-004 kill, escrita atômica, todo.md intocado, hash invalida checkpoint, auto-resume por status, --task retoma, --clean derruba+sai, órfãos podados, regressão zero); typecheck/lint/test verdes antes do commit.
