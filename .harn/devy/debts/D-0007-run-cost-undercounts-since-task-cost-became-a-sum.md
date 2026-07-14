# D-0007 — Custo do Run subconta: Task virou soma (ADR-0006), Run/Change continuam *last-non-null*

> **Status:** aberto · **Severidade:** média · **Área:** `src/metrics/folds.ts` · `src/loop/orchestrator.ts` · `src/types.ts`
> **Descoberto em:** 2026-07-14 · **Origem:** sync do Intent Layer (`/write-agent-md sync`)

## Sintoma
O "Total Run · custo" do Relatório de execução mostra, na prática, o custo da **última Task iterada** — não a soma das Tasks do Run. Num Run de 5 Tasks, o total reportado fica próximo de 1/5 do real.

## Causa raiz
A regra de agregação do custo **deixou de ser uniforme** e só metade do rollup acompanhou.

Quando o custo era um snapshot cumulativo de **uma Sessão por Run**, *last-non-null* estava certo em todos os níveis: somar duplicaria. O ADR-0006 mudou o mundo — as Sessões passaram a ser keyed por `${agent}::${worktree}` (`src/acp/pool.ts`), ou seja, **uma Sessão por Task** (por Agente). O orquestrador se adaptou e passou a **somar** os snapshots finais das Sessões de cada Task:

```ts
// src/loop/orchestrator.ts:1179-1182
// Best-effort: null/absent tolerated via addCost identity.
taskCost = addCost(taskCost, session.readCost());
```

Mas `summarizeRun` e `summarizeChange` continuam com o fold antigo:

```ts
// src/metrics/folds.ts:120  (Run)
if (ts.cost !== null) cost = ts.cost;   // <-- last-non-null sobre as Tasks
// src/metrics/folds.ts:144  (Change)
if (rs.cost !== null) cost = rs.cost;
```

Como cada Task agora tem custo **próprio e independente** (Sessões distintas), varrer as Tasks e ficar com a última não é mais "o cumulativo" — é descartar as anteriores.

A documentação também ficou para trás: `src/types.ts:380` ainda descreve `TaskMetrics.cost` como *"Last non-null cumulative Session cost snapshot"*, contradizendo o código que o soma; e o docstring de `folds.ts:6` repete a regra antiga.

## Impacto
**Dado errado, silenciosamente.** Métricas são best-effort e informativas (não governam o loop), mas o número existe para responder "quanto custou esta change" — e ele subconta por um fator próximo ao número de Tasks. Vale para o **Relatório de execução** (por Run) e para o **Relatório de change** (`index.md`).

Agrava: entre Runs, `change-report.aggregateTasks` resolve o custo de uma Task como `ts.cost ?? prev.cost` (o Run mais recente vence, não soma) — uma terceira regra, também não documentada.

## Reprodução
1. Rode um pipeline com `metrics:` ligado e ≥2 Tasks que usem Agente.
2. Compare o "Total Run · custo" do Relatório com a soma dos custos por-Task da mesma tabela: o total ≈ custo da última Task.

## Correção proposta
Decidir a invariante e alinhar os três lugares (código, `types.ts`, docstrings):

- **Se custo é por-Sessão, o custo por-Task é independente** (a leitura correta pós-ADR-0006): `summarizeRun` deve **somar** os `TaskMetrics.cost` (via `addCost`, que já trata `null` como identidade), e `summarizeChange` deve somar os Runs — com o cuidado de que re-runs da mesma Task **não** dupliquem (é aí que morava a razão original do *last-non-null*; exige decidir se um Run repetido substitui ou acumula).
- Atualizar o comentário de `TaskMetrics.cost` em `src/types.ts:380` e o docstring de `folds.ts`, que hoje afirmam a regra antiga.

Cuidado ao mexer: o `Sample` carrega `cost` mas `foldSamples` o **descarta de propósito** (custo nunca é por-Step — OQ2). Isso está certo e não deve ser "consertado" junto.

## Workaround atual
Somar à mão os custos por-Task do Relatório de execução. O custo **por Task** é confiável; só o total agregado não é.
