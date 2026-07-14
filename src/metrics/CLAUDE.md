# Métricas — instrumentação de execução (opt-in, ADR-0003)

## Purpose & Scope
Módulo **puro** que coleta, agrega e reporta tempo, tokens e custo por Step, acumulados em quatro níveis (**Amostra → Step → Task → Run → Change**). É a única casa da álgebra de rollup e da distinção de renderização `n-a`×`n/d`. **Opt-in** (AD-1): sem o bloco `metrics` no `loopy.yml`, o motor nem chama daqui — regressão zero. Contrato **aditivo** (ADR-0003): estende tipos congelados sem tocar em `StepResult`/`RunState`; persiste em `.loopy/metrics.json` à parte. NÃO decide comportamento de loop nem falha um Step — captura ausente vira `n/d`, nunca exceção.

## Entry Points & Contracts
- **folds** (`folds.ts`): `foldSamples` (Amostras→`StepMetrics`), `summarizeTask/Run/Change`, `addUsage`, **`addCost`** (a soma multi-Sessão do ADR-0006). Aritmética pura: nunca muta entrada, nunca lança, entrada vazia → zero/null.
  - ⚠️ O barrel `index.ts` **não exporta `addCost`** — o orquestrador importa direto de `folds.js`. O barrel não é a fronteira que ele diz ser; ou se completa o export, ou se para de tratá-lo como tal.
- **store** (`store.ts`): `loadMetrics`/`mergeRun`/`saveMetrics` sobre `.loopy/metrics.json` (v1: `{version, change:{id,dir}, runs[]}`). Merge **append-only**; escrita atômica (`mkdir -p`+`.tmp`+`rename`). **`loadMetrics` tolerante retorna `null`** (não vazio) quando ausente/corrompido — quem absorve o `null` é `mergeRun`. (`emptyChangeMetrics` existe mas só tem consumidor em testes.)
- **format** (`format.ts`): `formatTokens/Duration/Cost/Usage` — puro, valor→string (`k`/`M`, `h/m/s`, `$0.42`).
- **report** (`report.ts`): `renderRunReport` → linhas do **Relatório de execução** (o chamador escreve em stderr).
- **change-report** (`change-report.ts`): `renderChangeSection`/`upsertChangeSection` (puros) + `persistChangeReport` (I/O) — **Relatório de change** em Markdown no `index.md`, upsert **byte-preserving**.

## Usage Patterns
- **Três** funções tocam disco: `saveMetrics` (escreve), `loadMetrics` (lê) e `persistChangeReport` (lê **e** escreve). Todo o resto é puro (AD-6).
- `usage` é **somado** entre turnos (`addUsage` trata `null` como identidade).
- **Custo — a regra não é uniforme** (leia antes de mexer):
  - **Task** = **soma** dos `readCost()` finais de cada Sessão da Task (via `addCost`), porque as Sessões são keyed por `${agent}::${worktree}` (ADR-0006).
  - **Run** e **Change** = **último snapshot não-nulo** (`last-non-null`), herdado de quando o custo era cumulativo de uma Sessão só.
- Rollup é 4 folds encadeados; o total da Change é fold puro sobre `runs[]`, nunca contador mutável escondido.

## Anti-patterns
- **Nunca reportar Custo por-Step** (OQ2): custo é cumulativo da Sessão, não rateável a um Step. (Por isso `foldSamples` **descarta** `sample.cost` mesmo com o campo presente na Amostra — não "conserte" isso.)
- **Nunca colapsar `n-a` e `n/d` no usage**: `usage: null` = step não-agente (⇒ `n-a`); `usage.available:false` = step de agente sem report do ACP (⇒ `n/d`). Estados diferentes. (No **custo** a distinção não existe: `formatCost` já mapeia ambos para `n/d`.)
- Nunca misturar runs de duas Changes: `change.id`/`dir` divergente → recomeça do zero, não mescla.
- Não emitir Amostra para Step não executado (sem intérprete / visit-exceeded) — só Visita efetiva conta.

## Dependencies & Edges
- Tipos: `../types.ts`. Captura ACP: `../acp/` (`session.drainUsage()`/`readCost()`). Amostragem: `../loop/orchestrator.ts` (único escritor de Amostras; e a fonte do `change` via `deriveChange`). Wiring/relatório: `../index.ts` (merge + stderr + gate do change report).
- Glossário canônico: seção **Métricas** de `/CONTEXT.md`. Decisão: `docs/adrs/0003-metricas-de-execucao-contrato-aditivo-best-effort-acp.md`.

## Patterns & Pitfalls
- **Trigger do Relatório de change** (não-óbvio, e o código mora fora daqui — em `../index.ts`): persiste no `index.md` só quando `metrics.report.index` existe E um **re-parse fresco do `todo.md`** dá 0 pendentes — **nunca** por `stoppedBy` (que reflete só a lista selecionada, não o backlog inteiro).
- `upsertChangeSection` delimita a seção `## <change.id>` até o próximo `## ` (h2) ou EOF e preserva todos os outros bytes — espelha `markDone` de `../backlog/todo.ts`.
- **`readCost()` já inclui o carry de reopens**: `clear()` reabre a Sessão, e o `costCarry` mantém o snapshot monotônico (ver `../acp/`).
- `usage_update.cost` do SDK é `@experimental`/UNSTABLE — lido via cast frouxo; pode sumir. O best-effort protege disso.
- Entre Runs, `change-report.aggregateTasks` resolve o custo de uma Task como `ts.cost ?? prev.cost` — **o Run mais recente vence**, não soma.
- > TODO(intent): o custo de **Run** ser `last-non-null` enquanto o de **Task** virou soma parece undercount (o "Total Run · custo" mostra o custo da última Task iterada, não a soma). `types.ts` ainda documenta `TaskMetrics.cost` como "last non-null", contradizendo o código. Bug ou invariante nova?
