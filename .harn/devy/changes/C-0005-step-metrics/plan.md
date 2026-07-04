# Plano de implementação: C-0005 — Métricas de execução por Step

> Deriva de `spec.md` (mesma pasta). **Todas as Open Questions já estão resolvidas
> na spec** (OQ1–OQ9) — este plano decide só a *mecânica e a ordem*, não o design.
> Invariante central mantido (AD-1): o motor ganha a **mecânica** de medir/relatar;
> **se/onde/como** relatar são 100% `loopy.yml`.

## Overview

Instrumentar o Pipeline para medir **tempo** (sempre, nos 4 tipos de Step) e
**tokens/custo** (best-effort via ACP, só Steps de Agente), acumulando em quatro
níveis — **Step → Task → Run → Change** — e expondo dois artefatos: um **Run report**
(stderr, ao fim de cada Run) e um **Change report** (`index.md`, ao zerar o backlog).
Mudanças de contrato **aditivas** (provadas por `tsc`); coleta **side-effect-free**;
tudo **gated** atrás do bloco `metrics` (ausente ⇒ regressão zero).

## Architecture Decisions (herdadas da spec — não reabrir)

- **Aditivo, `StepResult` intocado (OQ5).** A captura sai da **Sessão**, não do
  resultado do Step: `AgentSession` ganha `drainUsage()`/`readCost()`. O orquestrador
  é o **único escritor** de Amostras (chama `drainUsage()` **após** `execute()`, para
  capturar todos os turnos do verify loop de uma vez).
- **`usage` é por-turno → SOMA-se (OQ4).** Validado por spike contra `claude-agent-acp`
  v0.26.0 (a doc do `.d.ts` engana). `cost` é **cumulativo da Sessão** → guarda-se o
  último snapshot; reportado só a nível Task/Run/Change (OQ2), nunca por-Step.
- **`change.*` derivado do path (OQ3).** `change.dir = dirname(inputs.todo)`,
  `change.id = basename(change.dir)` (fallback `config.name` na raiz). Sem semântica
  de devy no motor. `${change.*}` disponível na interpolação (AD-4).
- **Estado entre Runs em `.loopy/metrics.json`** (gitignored, escrita atômica), sem
  tocar o schema congelado `RunState`. Change total = **fold puro** sobre `runs[]`.
- **Fim-da-Change via re-parse do `todo.md` (0 pendentes), nunca via `stoppedBy`** (OQ7).
- **`index.md`**: seção por Change, reescrita **byte-preserving** (padrão do `markDone`).

## Dependency graph

```
T-001 (config metrics + ${change.*})  ─┐
T-002 (tipos de métrica + módulo puro) ─┼─► T-004 (orquestrador: timing + Amostra→RunMetrics)
T-003 (captura ACP: drainUsage/readCost)┘         │
                                                  ▼
                              T-005 (index: merge metrics.json + Run report)
                                                  │
                                                  ▼
                              T-006 (Change report: index.md byte-preserving)
                                                  │
                                                  ▼
                              T-007 (ADR-0003 + CONTEXT.md)
```

**T-001, T-002 e T-003 são independentes** (foundation paralelizável). T-004 costura
os três; T-005/T-006 são o wiring de saída; T-007 fecha docs. Cada task deixa `tsc`,
`lint` e `test` verdes (contrato aditivo; nada consome métricas até o wiring, então a
regressão-zero se sustenta trivialmente na Fase 1).

## Pontos de código âncora (confirmados por exploração)

| Alvo | Arquivo:linha | Nota |
|---|---|---|
| `AgentSession` (só `StopReason` hoje) | `src/types.ts:365-378` | + `drainUsage()`/`readCost()` |
| `StepResult` (não muda) | `src/types.ts:77-86` | intocado |
| `LoopyConfig` (após `logging`) | `src/types.ts:254-267` | + `metrics?` |
| `RunLoopResult` | `src/loop/orchestrator.ts:847-857` | + `metrics`/`startedAt`/`finishedAt` |
| `buildScopeVars` | `src/loop/orchestrator.ts:103-131` | + `change.{id,dir}` |
| execute (principal / teardown) | `src/loop/orchestrator.ts:723` / `:800` | cronometrar os **dois** |
| guard visits / no-op sem intérprete | `:683-706` / `:782-783` | **não** geram Amostra |
| `runTurn` (descarta `usage`) | `src/acp/session.ts:165-177` | somar usage por-turno |
| handler `session/update` | `src/acp/client.ts:500-504` | + branch `usage_update` (cost) |
| lazy/notWired session | `src/loop/orchestrator.ts:442-449` / `477-499` | implementar `drainUsage`/`readCost` |
| summary de 1 linha | `src/index.ts:414-421` | emitir Run report após `runLoop` |
| escrita atômica | `src/resume/state.ts:140-165` | espelhar em metrics.json |
| rewrite byte-preserving | `src/backlog/todo.ts:238-282` | espelhar na seção do index.md |
| contagem de pendentes | `src/backlog/todo.ts:205-208` | re-parse fim-da-Change |
| schema zod `.strict()` | `src/config/schema.ts:279-305` | bloco `metrics` opcional |
| clock injetável | `src/logging/logger.ts:62-85` | `now?: () => Date` |
| resolver / fail-fast | `src/interp/resolver.ts:150-163` | `ScopeVars.change` |

## Task List

### Fase 1 — Foundation (paralelizável: T-001 ∥ T-002 ∥ T-003)

**T-001 — Config `metrics` (schema + tipo) + interpolação `${change.*}`**
Bloco `metrics` opt-in no zod (`report` opcional; se presente, `report.index` string
não-vazia; `.strict()`), espelhado em `LoopyConfig` (`readonly metrics?: MetricsConfig`).
`buildScopeVars` + `ScopeVars` ganham `change.{id,dir}` (derivado de `inputs.todo`,
fallback `config.name` na raiz). Atualizar `examples/loopy.yml` com o bloco.
- **Aceite:** config com `metrics` válido parseia; `report` sem `index` é rejeitado;
  `${change.id}`/`${change.dir}` resolvem; var desconhecida segue fail-fast; ausência
  de `metrics` continua válida.
- **Verificação:** `npm test -- config` + `npm test -- interp`; `npm run typecheck`.
- **Deps:** nenhuma. **Files:** `src/config/schema.ts`, `src/types.ts`,
  `src/interp/resolver.ts`, `src/loop/orchestrator.ts` (buildScopeVars),
  `examples/loopy.yml`, testes. **Scope:** M.

**T-002 — Tipos de métrica + módulo puro `src/metrics/`**
Tipos aditivos em `types.ts` (`TurnUsage`, `StepCost`, `Sample`, `StepMetrics`,
`TaskMetrics`, `RunMetrics`, `ChangeMetrics`). Novo módulo puro: folds de rollup
(Amostra→Step→Task→Run→Change; soma tokens/tempo/visitas; `cost` = último snapshot),
load/merge/save de `metrics.json` (atômico `mkdir+.tmp+rename`; load tolerante →
estado vazio; invalidação por `change.id` divergente), e formatação (tokens k/M, Δt
h/m/s, custo). Sem wiring — pura função + wrappers de I/O.
- **Aceite:** fold soma correto por nível (Visitas somadas; tokens `n/d` propagados;
  cost = último não-nulo); merge acrescenta Run em `runs[]` e refold da Change; troca
  de `change.id` começa arquivo novo; load de arquivo ausente/corrompido → vazio.
- **Verificação:** `npm test -- metrics`; `npm run typecheck`.
- **Deps:** nenhuma. **Files:** `src/types.ts`, `src/metrics/*` (novo), testes. **Scope:** M.

**T-003 — Captura ACP: `AgentSession.drainUsage()`/`readCost()`**
`AgentSession` ganha `drainUsage(): TurnUsage | null` (soma desde o último drain,
**reseta**) e `readCost(): StepCost | null` (snapshot cumulativo). `SessionWrapper`
soma `PromptResponse.usage` por-turno num acumulador por-sessão (espelhando o
`TurnTextBuffer`, reset por-turno) e lê o cost de um buffer alimentado no branch
`usage_update` de `client.ts` (após a barreira `flushSessionUpdates`). `notWiredSession`
→ `null`; `createLazySession` → delega ao aberto, `null` quando não-aberta.
- **Aceite:** multi-turno **soma**; drain **reseta**; `usage` null → `available:false`;
  turno `/clear` = zeros (inócuo); cost cumulativo → último snapshot; `prompt()` e as
  demais assinaturas **não** mudam; `StepResult` intocado.
- **Verificação:** `npm test -- acp` (mocks de `PromptResponse`/`usage_update`);
  `npm run typecheck` (prova os 3 implementadores).
- **Deps:** T-002 (tipos `TurnUsage`/`StepCost`). **Files:** `src/types.ts`
  (interface `AgentSession`), `src/acp/session.ts`, `src/acp/client.ts`,
  `src/loop/orchestrator.ts` (lazy/notWired), testes. **Scope:** M. **⚠️ Risco alto.**

#### Checkpoint — Foundation (após T-001..T-003)
- [ ] `npm run typecheck`, `npm run lint`, `npm test` verdes.
- [ ] Contrato aditivo provado (nenhuma assinatura pública existente mudou).
- [ ] Nada consome métricas ainda ⇒ comportamento byte-idêntico ao de hoje.
- [ ] **Revisão humana antes de prosseguir.**

### Fase 2 — Coleta e Run report (sequencial: T-004 → T-005)

**T-004 — Orquestrador: cronometrar execute + Amostra → RunMetrics**
Clock injetável em `OrchestratorDeps` (`now?: () => Date`, default `Date.now`).
Envolver **os dois** sites de `execute` (`:723` principal e `:800` teardown `always`)
com `durationMs = clock()-t0`; após `execute`, chamar `drainUsage()`/`readCost()` e
montar uma **Amostra** por Step **efetivamente executado** (guard de visits e no-op
sem intérprete **não** geram Amostra). Acumular Amostras → `RunMetrics` (soma por
Step/Task, Visitas somadas). Estender `RunLoopResult` com `metrics`/`startedAt`/`finishedAt`.
- **Aceite:** `durationMs` determinístico com clock injetado; Amostra nos dois
  call-sites; Step pulado (visit-exceeded / sem intérprete) **não** gera Amostra;
  `drainUsage` chamado **após** `execute`; `RunLoopResult.metrics` reflete o rollup.
- **Verificação:** `npm test -- orchestrator`; `npm run typecheck`.
- **Deps:** T-002 (folds/tipos), T-003 (drainUsage/readCost). **Files:**
  `src/loop/orchestrator.ts`, testes. **Scope:** M.

**T-005 — index.ts: merge `metrics.json` + Run report (stderr), gated por `metrics`**
Após `runLoop`: resolver `metrics.report.index` **uma vez** a nível de Run (escopo
run-level com `change.*`/`inputs.*`/`workspace.*`, normalizado contra `root`); fazer
merge do `RunMetrics` em `.loopy/metrics.json` (append em `runs[]`, atômico); ler de
volta o rollup da Change e emitir o **Run report** em stderr (via line-reporter, após
a TUI parar no `finally`). **Tudo gated** pela presença de `config.metrics`.
- **Aceite (fixture com `metrics`):** `.loopy/metrics.json` com o shape esperado; Run
  report com breakdown por Step + linha "Change até agora". **(Sem `metrics`):**
  nenhum artefato novo, saída byte-idêntica (regressão zero). `usage`/`cost` null →
  Step sucede e mostra `n/d`.
- **Verificação:** `npm test -- index` (aceite com/sem metrics); `npm run typecheck`.
- **Deps:** T-004, T-002, T-001. **Files:** `src/index.ts`, `src/tui/line-reporter.ts`
  (nice-to-have), fixture com `metrics` (variante dedicada, mantendo o fixture atual
  pristino p/ regressão-zero), testes. **Scope:** M.

#### Checkpoint — Coleta (após T-004..T-005)
- [ ] Run vivo com `metrics` grava `metrics.json` e emite Run report (stderr).
- [ ] Run **sem** `metrics` = zero artefato novo (regressão zero verificada).
- [ ] `usage`/`cost` ausentes ⇒ Step sucede, `n/d` no relatório (nunca falha).
- [ ] Success Criteria 1, 3, 5, 6 atendidos.

### Fase 3 — Change report + docs (sequencial: T-006 → T-007)

**T-006 — Change report: re-parse do `todo.md` → persistir `index.md`**
Renderer do Change report (Markdown: `## <change.id>` + parágrafo de totais + tabela
rica por Task `| Task | Δt | in | out | cached | tokens | visits | custo |`). Após a
Run, re-parsear o `todo.md`: se `pendingTasks === 0` **e** `report.index` setado,
persistir a seção da Change — **byte-preserving** (reescreve só a própria seção,
preserva as outras e o preâmbulo; anexa nova ao fim; cria arquivo com título `#` se
inexistente). Gatilho **nunca** por `stoppedBy`.
- **Aceite:** backlog 100% `[x]` → seção escrita; re-persistir atualiza **só** aquela
  seção (outras byte-a-byte); `--task`/`skip_task` que não zeram o backlog **não**
  disparam; `report.index` ausente → sem `index.md`.
- **Verificação:** `npm test -- metrics` (renderer + rewrite idempotente) + aceite
  de integração; `npm run typecheck`.
- **Deps:** T-005, T-002. **Files:** `src/metrics/*` (renderer + rewrite),
  `src/index.ts` (gatilho), testes. **Scope:** M.

**T-007 — Docs: ADR-0003 + CONTEXT.md + fixture**
ADR-0003 (contrato aditivo + AD-1 + best-effort ACP). Promover ao `CONTEXT.md` os
termos novos (Amostra/Uso/Custo/Agregado/Run report/Change report/Change). Bloco
`metrics` no `tests/fixtures/project/loopy.yml` se ainda não coberto.
- **Aceite:** ADR-0003 criado e indexado; glossário atualizado sem colidir com termos
  existentes (Iteração/Tentativa/Visita/Report de checks).
- **Verificação:** `npm run typecheck && npm run lint && npm test` verdes.
- **Deps:** T-006. **Files:** `docs/adrs/0003-*.md`, `CONTEXT.md`,
  `tests/fixtures/project/loopy.yml`. **Scope:** S.

#### Checkpoint — Completo (após T-006..T-007)
- [ ] Change report persistido byte-preserving; disparo só com backlog zerado.
- [ ] Todos os 8 Success Criteria atendidos.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` verdes. Pronto para review.

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| ACP não emite `usage`/`cost` (best-effort) | Médio | `available:false`/`n/d`; **jamais** falhar Step (T-003, testes de null) |
| `usage` tratado como cumulativo (doc do SDK engana) | Alto | Spike confirmou por-turno → **somar**; teste multi-turno explícito (T-003) |
| Mudança em `AgentSession` quebra `tsc` nos 3 implementadores | Baixo | T-003 implementa os 3 juntos; `tsc` é o gate |
| `index.md` corromper seções vizinhas | Alto | Rewrite byte-preserving (padrão `markDone`); teste de preservação byte-a-byte (T-006) |
| Fixture com `metrics` quebrar a baseline de regressão-zero | Médio | Fixture-variante dedicada; manter o fixture atual pristino (T-005) |
| Dupla contagem no resume | Médio | Steps pulados no resume não geram Amostra; Task reexecutada em Runs distintas soma real (T-004) |

## Parallelization

- **Paralelizável:** T-001, T-002, T-003 (foundation independente; contratos aditivos).
- **Sequencial:** T-004 (precisa de T-002+T-003) → T-005 → T-006 → T-007.

## Open Questions

Nenhuma pendente de design — **OQ1–OQ9 já resolvidas na spec**. Única aprovação
necessária: **review humano deste plano/ordem** antes de iniciar T-001.
