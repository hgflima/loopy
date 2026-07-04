# Backlog: Desvio de fluxo entre steps (`goto`) — C-0004

Ver `plan.md` para grafo de dependências, fases e checkpoints. Cada task é uma fatia
pequena e verificável; ordem = bottom-up pelo grafo. Não pular checkpoints.

## Phase 1 — Linguagem de config, validação e dry-run

- [x] T-001: ADR-0002 — estende ADR-0001 com goto/on_success/max_step_visits
    Registrar a decisão que amplia a linguagem ubíqua antes do código (disciplina ADR),
    para não deixar a linguagem órfã. Usar a skill adr_management (`/adrs:create`).
    ADR-0002, status accepted, `supersedes: []` (estende, não revoga — cita ADR-0001 no
    corpo). Decisão: `on_fail` passa de `escalate` para `escalate | { goto }`; nova chave
    `on_success: { goto }` em StepBase; teto de runtime `max_step_visits` (default 10,
    fail-closed → escalate); ciclos permitidos (fix-loop), validação estática só checa
    alvo-existe + id-único, warning não-bloqueante para ciclo.
    Acceptance:
    - [ ] `docs/adrs/0002-*.md` criado via skill, status accepted, referenciando ADR-0001
    - [ ] Corpo cobre: on_fail ampliado, on_success, max_step_visits, ciclos permitidos + teto
    - [ ] Índice de ADRs reindexado pela skill
    Verify: hooks da skill adr_management passam; `git status` mostra só o ADR + índice.
    Deps: nenhuma. Files: `docs/adrs/0002-*.md`, índice de ADRs. Scope: S.

- [ ] T-002: types.ts — contrato aditivo do goto
    Ampliar o contrato congelado sem quebrar consumidores (aditivo; reshape do
    TaskCheckpoint fica para T-008). Declaration-only, corretude por `tsc`.
    Mudanças: `GotoAction = { readonly goto: string }`; `OnFailAction = "escalate" |
    GotoAction`; `OnSuccessAction = GotoAction`; `StepBase.on_success?: OnSuccessAction`;
    `StopConditions.max_step_visits: number`; `PipelineOutcome` ganha campo de motivo de
    estouro de visitas (para a mensagem de escalonamento em runLoop).
    Acceptance:
    - [ ] Tipos novos exportados; `on_success?` em StepBase (universal a todo step)
    - [ ] `on_fail?` permanece por primitiva (agent/shell/checks/approval), agora união
    - [ ] `max_step_visits` em StopConditions; PipelineOutcome carrega motivo de estouro
    Verify: `npm run typecheck` verde (pode exigir ajuste mínimo em resolveStep/agent log —
    fica em T-005; se acusar, é o esperado e será resolvido lá).
    Deps: nenhuma. Files: `src/types.ts`. Scope: S.

- [ ] T-003: schema.ts — validação do goto (superRefine ×3)
    Validar a forma nova e rejeitar o sempre-erro. `.strict()`/readonly preservados.
    Mudanças: `gotoSchema = z.object({ goto: nonEmptyString }).strict()`; `onFailSchema`
    vira `z.union([z.literal("escalate"), gotoSchema])`; `on_success: gotoSchema.optional()`
    em `stepBaseShape`; `max_step_visits: z.number().int().min(1).default(10)` em
    `stopConditionsSchema`. `pipelineSchema.superRefine` ganha: (a) id único no pipeline;
    (b) todo `on_fail.goto`/`on_success.goto` referencia id existente; (c) guard do agente
    generalizado — `on_fail` (escalate OU goto) em `agent` exige `verify` ou `expect`;
    `on_success` sem guard.
    Acceptance:
    - [ ] id duplicado → erro pt-BR citando os ids repetidos
    - [ ] goto p/ alvo inexistente → erro pt-BR citando step de origem + chave + alvo
    - [ ] `agent` on_fail (escalate|goto) sem verify/expect → erro pt-BR (herda OQ-7)
    - [ ] Configs válidas (com e sem goto) aceitas; default max_step_visits=10 aplicado
    Verify: `npx vitest run tests/config/schema.test.ts`; `npm run typecheck`.
    Deps: T-002. Files: `src/config/schema.ts`, `tests/config/schema.test.ts` (NOVO).
    Scope: M.

- [ ] T-004: canal de warning — collectPipelineWarnings
    Emitir warning não-bloqueante (ciclo é válido: fix-loop). Hoje a validação só faz
    throw-ou-passa — este canal é novo. Função pura `collectPipelineWarnings(pipeline):
    string[]`: (a) detecta ciclo no grafo de goto → "confirme que é intencional"; (b)
    `on_success`/`on_fail:{goto}` em step `always` → "ignorado no teardown". Chamada em
    `parseConfig`; o CLI imprime as linhas em stderr (não-fatal, espelha
    formatValidationError sem lançar).
    Acceptance:
    - [ ] Ciclo no grafo → 1 warning por ciclo, não bloqueia o parse
    - [ ] goto/on_success em step `always` → warning informativo
    - [ ] Config sem esses casos → zero warnings; parse inalterado (regressão zero)
    Verify: `npx vitest run tests/config/`; conferir stderr num `--dry-run` com ciclo.
    Deps: T-002, T-003. Files: `src/config/warnings.ts` (NOVO ou em load.ts),
    `src/index.ts` (surface stderr), `tests/config/warnings.test.ts` (NOVO). Scope: M.

- [ ] T-005: dry-run — arestas de desvio por step
    Cada step imprime suas arestas quando presentes, no slot do campo. Em `resolveStep`
    (orchestrator.ts): `on_success -> <id>` e `on_fail -> escalate | goto <id>`. Ajustar a
    formatação de `on_fail` que hoje faz `setting("on_fail", step.on_fail)` (quebra ao
    compilar com a união / gera `[object Object]`) — formatar objeto goto como `goto <id>`.
    Saída continua lista em ordem declarada, arestas anotadas por step (diff mínimo).
    Acceptance:
    - [ ] `on_success -> X` impresso quando presente
    - [ ] `on_fail -> escalate` ou `on_fail -> goto X` conforme o valor (nunca [object Object])
    - [ ] `typecheck` verde (esta task fecha o ajuste forçado pela união em T-002)
    Verify: `npx vitest run tests/cli/dry-run.test.ts`; `npm run typecheck`.
    Deps: T-002, T-003. Files: `src/loop/orchestrator.ts` (resolveStep),
    `tests/cli/dry-run.test.ts`. Scope: S.

### Checkpoint: Config — typecheck+lint verdes; goto parseia; validação recusa lixo; ciclo warna; dry-run mostra arestas; regressão zero. Revisão humana.

## Phase 2 — Program counter em runtime + feedback do fix-loop

- [ ] T-006: runTaskPipeline → program counter
    Trocar o `for...of` linear por PC sobre `stepIndex: Map<id,índice>`. Semântica:
    ao ENTRAR num PC incrementa `visits[id]`; se `visits[id] > max_step_visits` → terminal
    **escalate** com motivo "step <id> excedeu max_step_visits (N)" SEM executar (respeita
    policies.escalation). Executa o step; sucesso → `on_success.goto ? stepIndex[goto] :
    PC+1`; falha → `on_fail {goto} ? stepIndex[goto] : escalate` (escalate também se
    omitido/órfão do agente); PC > último → terminal sucesso. `always`/teardown preservado:
    ao atingir terminal, `always` ainda-não-executados rodam em ordem, best-effort, SEM PC
    nem salto (goto ignorado no teardown), respeitando keep_worktree. `PipelineOutcome`
    carrega o motivo de estouro para runLoop reaproveitar.
    Acceptance:
    - [ ] Sequencial (sem on_fail/on_success): ordem declarada, falha → escalate (regressão zero)
    - [ ] on_success:{goto X} → PC salta p/ X; on_fail:{goto X} → PC salta p/ X em vez de escalar
    - [ ] fix-loop review→implement→review roda até max_step_visits e então escala com motivo
    - [ ] terminal (sucesso ou escalate) sempre roda os `always` pendentes, lineares
    Verify: `npx vitest run tests/loop/orchestrator.test.ts tests/loop/run-loop.test.ts`.
    Deps: T-003 (max_step_visits no schema). Files: `src/loop/orchestrator.ts`,
    `tests/loop/orchestrator.test.ts` (MOD+NOVO), `tests/loop/run-loop.test.ts` (MOD).
    Scope: L (task central — se necessário, isolar o entry-guard de visitas num commit).

- [ ] T-007: feedback do fix-loop (threading do report no salto)
    O alvo do goto precisa saber o que corrigir, senão não converge. Reusar
    `${checks.report}` (nenhuma var nova): no salto por `on_fail:{goto}`, o motor semeia
    `checksReport = result.report?.text ?? result.output` (para `review` com expect, report
    é ausente → usa output do turno; applyVerdictGate já devolve output:text). Threading
    output-como-report **só no salto** (fluxo sequencial normal segue só com result.report).
    `agent.ts`: semear checksReport inicial a partir do valor threadado no ctx (hoje
    agent.ts:180 fixa "" e descarta o carry) — re-entrada é execução fresca (attempt=1, usa
    prompt não retry_prompt). Formatar `on_fail` objeto no log (agent.ts:228,231 — não
    [object Object]).
    Acceptance:
    - [ ] No salto review→implement, `implement` re-entrado vê o output do review em ${checks.report} (assert no prompt resolvido)
    - [ ] Step comum no fluxo normal NÃO vaza output p/ ${checks.report} do próximo (regressão zero)
    - [ ] retry_prompt continua exclusivo do loop interno de verify (Tentativa ≠ salto)
    - [ ] Log de on_fail objeto formatado (não [object Object])
    Verify: `npx vitest run tests/loop/orchestrator.test.ts`; asserts de prompt resolvido.
    Deps: T-006. Files: `src/loop/orchestrator.ts` (semeia carry no salto),
    `src/steps/agent.ts` (checksReport inicial do ctx + log). Scope: M.

### Checkpoint: Runtime — testes de fluxo + threading verdes; fix-loop converge/diverge; regressão zero linear. Revisão humana.

## Phase 3 — Migração do resume + config/doc

- [ ] T-008: resume — migrar checkpoint p/ PC + visits + carry
    O checkpoint atual assume execução-única por step (`completedSteps: string[]`); com
    loops, um step roda N vezes. Migrar `TaskCheckpoint` para `pc` (id do step, robusto/
    legível — pipelineHash já invalida se muda), `visits: Record<id,number>`, `checksReport`
    corrente (carry durável — OQ-10). Atualizar transições em `state.ts`, `CheckpointPort`
    (métodos), `createCheckpointPort` e a reconciliação em `runLoop` (retomar de pc/visits/
    carry em vez de pular completedSteps). Persistir a cada transição de PC (sucesso ou salto).
    Acceptance:
    - [ ] state.json grava pc + visits + checksReport (não completedSteps)
    - [ ] Resume no meio de um fix-loop reexecuta o step corrente na volta correta, com o carry do review intacto
    - [ ] pipelineHash divergente ainda recomeça a task; pruneOrphans preservado
    Verify: `npx vitest run tests/resume/ tests/loop/resume.test.ts tests/cli/resume.test.ts`.
    Deps: T-006, T-007. Files: `src/types.ts` (TaskCheckpoint/CheckpointPort),
    `src/resume/state.ts`, `src/loop/orchestrator.ts` (port + reconciliação),
    `tests/resume/state.test.ts`, `tests/loop/resume.test.ts`. Scope: L.

- [ ] T-009: migrar example + fixture
    `examples/loopy.yml`: adicionar `max_step_visits` em stop_conditions e o fix-loop
    documentado (`review` com `on_fail: { goto: implement }`), com `${checks.report}`
    referenciado no prompt do `implement` (vazio no 1º run, preenchido na volta).
    `tests/fixtures/project/loopy.yml`: `max_step_visits` (mínimo válido).
    Acceptance:
    - [ ] examples/loopy.yml válido, com fix-loop review→implement + max_step_visits
    - [ ] fixture válido com max_step_visits; testes de aceite/CLI que o carregam verdes
    - [ ] Nenhum snapshot de dry-run quebrado sem intenção
    Verify: `npm test` (aceite + config/load + CLI que carregam os ymls).
    Deps: T-003 (schema aceita), idealmente após T-006 (fix-loop executável).
    Files: `examples/loopy.yml`, `tests/fixtures/project/loopy.yml`. Scope: S.

- [ ] T-010: docs — CONTEXT.md + CLAUDE.md (+ SPEC/README se preciso)
    `CONTEXT.md`: verbetes novos (Desvio/goto, on_success, max_step_visits), nuance no
    verbete Pipeline (ordem é o default, goto sobrepõe), on_fail agora escalate|goto.
    `CLAUDE.md` (raiz + filhos afetados src/config, src/loop, src/steps): glossário
    resumido reflete goto/on_fail/on_success. SPEC.md-mãe/README: ajustar se descreverem
    fluxo estritamente sequencial.
    Acceptance:
    - [ ] CONTEXT.md tem os verbetes novos e a nuance de Pipeline; on_fail = escalate|goto
    - [ ] CLAUDE.md (raiz + filhos) coerentes com a linguagem nova
    - [ ] Nenhuma descrição de "estritamente sequencial" remanescente onde goto agora vale
    Verify: leitura/`git diff`; consistência com ADR-0002 e o schema.
    Deps: T-008 (linguagem estabilizada). Files: `CONTEXT.md`, `CLAUDE.md` + filhos,
    `SPEC.md`/`README.md` (se aplicável). Scope: M.

### Checkpoint: Complete — resume mid-loop ok; example+fixture válidos; ADR-0002+CONTEXT+CLAUDE refletem a linguagem; typecheck+lint+test verdes; todos os Success Criteria. Revisão final.
