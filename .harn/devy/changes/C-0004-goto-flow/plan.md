# Implementation Plan: Desvio de fluxo entre steps (`goto`)

> Deriva de `spec.md` (C-0004). Estende ADR-0001 → **ADR-0002**. Invariante AD-1:
> o motor ganha a **mecânica** de salto; **qual/quando/teto** são 100% `loopy.yml`.

## Overview

Transformar o Pipeline de lista estritamente sequencial num **program counter (PC)**
com saltos declarados: `on_fail: escalate | { goto }` (amplia) e `on_success: { goto }`
(novo). Caso central: fix-loop `review on_fail goto implement`, limitado por
`max_step_visits` (default 10, fail-closed → escalate). Regressão zero: omitir ambos =
comportamento atual.

## Architecture Decisions

- **PC sobre `Map<id,índice>` + terminal explícito** (sucesso × escalate) substitui o
  `for...of` + `firstFailure` de `runTaskPipeline`. Blast radius real é o runtime.
- **Validação estática só rejeita o sempre-erro** (id duplicado, alvo inexistente,
  guard do agente generalizado). **Ciclo é permitido** (é o fix-loop) → só **warning
  não-bloqueante**; a defesa real é o teto de runtime.
- **Canal de warning é novo**: hoje a validação só faz throw-ou-passa. Decisão adotada
  (não-bloqueante, default sensato): função pura `collectPipelineWarnings(pipeline):
  string[]` chamada em `parseConfig`, e o CLI imprime as linhas em stderr (espelha
  `formatValidationError`, porém não-fatal). Sem novo tipo de retorno público quebrado.
- **Feedback do fix-loop reusa `${checks.report}`** (nenhuma var nova): no salto por
  `on_fail:{goto}` o motor semeia `checksReport = result.report?.text ?? result.output`;
  o agente re-entrado semeia seu report inicial do `ctx` (não `""`). Threading
  output-como-report **só no salto** → regressão zero no fluxo normal.
- **Resume migra de forma** (OQ-4, confirmado): `TaskCheckpoint` deixa de ser
  `completedSteps: string[]` e passa a `pc` (id do step) + `visits: Record<id,number>`
  + `checksReport`. `pipelineHash` continua invalidando o checkpoint.
- **Contrato aditivo primeiro** (Fase 1) mantém `tsc` verde; o reshape **breaking** do
  `TaskCheckpoint` só entra na Fase 3 junto de seus consumidores (state.ts + orchestrator).

## Dependency Graph

```
ADR-0002 (decisão)         [independente]
   │
types.ts (aditivo) ──► schema.ts ──► warnings ─┐
   │                      │                     ├─► (Checkpoint 1: config+dry-run)
   │                      └──► dry-run edges ───┘
   ▼
orchestrator PC ──► fix-loop feedback (agent.ts + carry)
   │                                   │
   │                                   ▼  (Checkpoint 2: runtime)
   ▼
resume migration (TaskCheckpoint reshape) ─┐
example/fixture yml migration ─────────────├─► (Checkpoint 3: final)
CONTEXT.md / CLAUDE.md ─────────────────────┘
```

Ordem = bottom-up pelo grafo. Slice vertical por **capacidade**: Fase 1 entrega o
caminho author-facing completo (escreve goto → vê no dry-run → validação recusa lixo),
com runtime ainda inerte (regressão zero). Fase 2 acende o runtime. Fase 3 fecha
resume + config + doc.

---

## Task List

### Phase 1 — Linguagem de config, validação e dry-run (author-facing; runtime inerte)

- [ ] **T-001**: ADR-0002 estende ADR-0001 (`on_fail` ganha `goto`; `on_success`; `max_step_visits`)
- [ ] **T-002**: `types.ts` — contrato aditivo (GotoAction, união OnFailAction, OnSuccessAction, StepBase.on_success, StopConditions.max_step_visits, PipelineOutcome reason)
- [ ] **T-003**: `schema.ts` — gotoSchema, onFail união, on_success no base, max_step_visits (default 10), superRefine ×3 (id único, alvo existe, guard do agente generalizado)
- [ ] **T-004**: canal de warning — `collectPipelineWarnings` (ciclo no grafo de goto; `on_success`/`on_fail` em step `always`) surfado em stderr no load
- [ ] **T-005**: dry-run — `resolveStep` imprime arestas `on_success -> X` / `on_fail -> escalate|goto X` (+ formatar objeto on_fail)

### Checkpoint: Config
- [ ] `npm run typecheck && npm run lint` verdes
- [ ] Config com `goto` parseia; id duplicado / alvo inexistente / `agent` on_fail sem verify|expect → rejeitados em pt-BR
- [ ] Ciclo emite warning **não-bloqueante**; `--dry-run` mostra as arestas
- [ ] Pipelines existentes (sem goto) inalterados — runtime ainda linear
- [ ] **Revisão humana antes da Fase 2**

### Phase 2 — Program counter em runtime + feedback do fix-loop

- [ ] **T-006**: `runTaskPipeline` → program counter (stepIndex, visits + max_step_visits entry-guard fail-closed, terminal explícito, on_success/on_fail goto, teardown `always` linear)
- [ ] **T-007**: feedback do fix-loop — carry `result.report?.text ?? result.output` no salto; `agent.ts` semeia checksReport do `ctx` + loga objeto on_fail

### Checkpoint: Runtime
- [ ] Testes de fluxo verdes: sequencial (regressão), on_success desvia, on_fail goto desvia, fix-loop limitado → escalate com motivo de estouro
- [ ] Threading provado: `implement` re-entrado vê `output` do `review` em `${checks.report}`; step comum **não** vaza output no fluxo normal
- [ ] `npm test` verde
- [ ] **Revisão humana antes da Fase 3**

### Phase 3 — Migração do resume + config/doc

- [ ] **T-008**: resume — `TaskCheckpoint` reshape (pc + visits + checksReport), transições em `state.ts`, `CheckpointPort`, persistência por transição de PC + reconciliação no `runLoop`
- [ ] **T-009**: migrar `examples/loopy.yml` (fix-loop review→implement + max_step_visits) e `tests/fixtures/project/loopy.yml` (max_step_visits mínimo)
- [ ] **T-010**: `CONTEXT.md` verbetes (Desvio/goto, on_success, max_step_visits, nuance Pipeline, on_fail escalate|goto) + `CLAUDE.md` (glossário resumido) + SPEC.md-mãe/README se descreverem fluxo estritamente sequencial

### Checkpoint: Complete
- [ ] Resume no meio de um fix-loop retoma pc/visits/carry corretos
- [ ] `examples/loopy.yml` + fixture válidos e migrados
- [ ] ADR-0002 + CONTEXT.md + CLAUDE.md refletem a linguagem nova
- [ ] `npm run typecheck && npm run lint && npm test` verdes — todos os Success Criteria
- [ ] **Revisão final**

---

## Parallelization Opportunities

- **T-001** (ADR) é independente — pode correr em paralelo à Fase 1 inteira.
- Após **T-003**: **T-004** (warnings) e **T-005** (dry-run) são independentes entre si.
- **T-009** (migração de yml) só *roda de fato* após a Fase 2, mas sua *validade* (parse)
  já vale após T-003 — mantido na Fase 3 para o fix-loop documentado ser executável.
- Sequencial obrigatório: T-002 → T-003 → (T-004/T-005); T-006 → T-007 → T-008.

## Risks and Mitigations

| Risco | Impacto | Mitigação |
|---|---|---|
| PC rewrite quebra resume no meio (T-006 muda `runTaskPipeline`, hoje acoplado a `completedSteps`) | Alto | Fase 2 aceita start-state fresco (pc=0/visits={}/carry=""); resume só é **re-validado** na Fase 3 (T-008), feito logo em seguida. Checkpoint 2 não afirma resume. |
| Ampliar `OnFailAction` para união quebra `resolveStep`/log ao compilar (`[object Object]`) | Médio | T-005 conserta a formatação nos mesmos pontos que o compilador força — typecheck verde no Checkpoint 1. |
| Warning sem canal existente vira mudança de contrato | Médio | Função pura + stderr no CLI (não-fatal); não altera assinatura pública de `parseConfig` além de um efeito de log opcional. |
| Ciclo acidental do autor vira loop infinito | Alto | Teto de runtime `max_step_visits` fail-closed → escalate (T-006) + warning estático (T-004). |
| `always` com goto reabrindo o fluxo pós-terminal | Médio | Teardown é sempre linear/best-effort; goto ignorado no teardown (T-006) + warning informativo (T-004). |

## Open Questions

Todas as OQ-1..OQ-11 da spec estão **resolvidas e confirmadas pelo usuário**.
Decisão de mecânica adotada sem bloqueio (default sensato, dentro do escopo): o
**canal de warning** é `collectPipelineWarnings` puro impresso em stderr no load.
Nenhuma pergunta pendente que altere o contrato. Itens "Ask first" da spec (proibir
ciclos, default ≠ 10, dependência nova, outros blocos do schema) **não** serão tocados.
