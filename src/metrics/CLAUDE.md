# Métricas — instrumentação de execução (opt-in, ADR-0003)

## Purpose & Scope
Módulo **puro** que coleta, agrega e reporta tempo, tokens e custo por Step, acumulados em quatro níveis (**Amostra → Step → Task → Run → Change**). É a única casa da álgebra de rollup e da distinção de renderização `n-a`×`n/d`. **Opt-in** (AD-1): sem o bloco `metrics` no `loopy.yml`, o motor nem chama daqui — regressão zero, comportamento byte-idêntico. Contrato **aditivo** (ADR-0003): estende tipos congelados sem tocar em `StepResult`/`RunState`; persiste em `.loopy/metrics.json` à parte. NÃO decide comportamento de loop nem falha um Step — captura ausente vira `n/d`, nunca exceção.

## Entry Points & Contracts
Tudo via barrel `index.ts`:
- **folds** (`folds.ts`): `foldSamples` (Amostras→`StepMetrics`), `summarizeTask/Run/Change`, `addUsage`. Aritmética pura: nunca muta entrada, nunca lança, entrada vazia → zero/null.
- **store** (`store.ts`): `loadMetrics`/`mergeRun`/`saveMetrics`/`emptyChangeMetrics` sobre `.loopy/metrics.json` (v1: `{version, change:{id,dir}, runs[]}`). Merge **append-only**; escrita atômica (`mkdir -p`+`.tmp`+`rename`); load tolerante (ausente/corrompido → vazio, nunca lança).
- **format** (`format.ts`): `formatTokens/Duration/Cost/Usage` — puro, valor→string (`k`/`M`, `h/m/s`, `$0.42`).
- **report** (`report.ts`): `renderRunReport` → array de linhas do **Relatório de execução** (o chamador junta e escreve em stderr).
- **change-report** (`change-report.ts`): `renderChangeSection`/`upsertChangeSection` (puros) + `persistChangeReport` (I/O) — **Relatório de change** em Markdown por Change no `index.md`, upsert **byte-preserving**.

## Usage Patterns
- Só duas funções tocam disco: `saveMetrics` e `persistChangeReport`. Todo o resto é puro (AD-6) e testável isolado.
- `usage` é **somado** entre turnos (`addUsage` trata `null` como identidade); `cost` a nível Task/Run/Change é sempre o **último snapshot não-nulo** (cumulativo por Sessão — somar duplicaria). **Multi-Sessão (ADR-0006):** custo por-Task = soma dos snapshots finais de **cada** Sessão da Task (uma por Agente), best-effort (`n/d` quando um Agente não reporta). Forma persistida de `.loopy/metrics.json` inalterada.
- Rollup é 4 folds encadeados; o total da Change é fold puro sobre `runs[]`, nunca contador mutável escondido.

## Anti-patterns
- **Nunca reportar Custo por-Step** (OQ2): custo é cumulativo da Sessão, não rateável a um Step.
- **Nunca colapsar `n-a` e `n/d`**: `usage: null` = step não-agente (⇒ `n-a`); `usage.available:false` = step de agente sem report do ACP (⇒ `n/d`). Estados diferentes.
- Nunca misturar runs de duas Changes: `change.id`/`dir` divergente → recomeça do zero, não mescla.
- Não emitir Amostra para Step não executado (sem intérprete / visit-exceeded) — só Visita efetiva conta.

## Dependencies & Edges
- Tipos: `../types.ts` (`Sample`/`StepMetrics`/`TaskMetrics`/`RunMetrics`/`ChangeMetrics`/`TurnUsage`/`StepCost`). Captura ACP: `../acp/` (`session.drainUsage()`/`readCost()`). Amostragem: `../loop/orchestrator.ts` (único escritor de Amostras). Wiring/relatório: `../index.ts` (merge + stderr + gate do change report).
- Glossário canônico: seção **Métricas** de `/CONTEXT.md`. Decisão: `docs/adrs/0003-metricas-de-execucao-contrato-aditivo-best-effort-acp.md`.

## Patterns & Pitfalls
- **Trigger do Relatório de change** (não-óbvio): persiste no `index.md` só quando `metrics.report.index` existe E um **re-parse fresco do `todo.md`** dá 0 pendentes — **nunca** por `stoppedBy` (que reflete só a lista selecionada, não o backlog inteiro).
- `upsertChangeSection` delimita a seção `## <change.id>` até o próximo `## ` (h2) ou EOF e preserva todos os outros bytes — espelha `markDone` de `../backlog/todo.ts`.
- `usage_update.cost` do SDK é `@experimental`/UNSTABLE — lido via cast frouxo; pode sumir. O best-effort protege disso.
