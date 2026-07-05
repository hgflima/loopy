---
number: 0003
title: "Métricas de execução: contrato aditivo, config-driven e best-effort ACP"
status: accepted
date: 2026-07-04
status_date: 2026-07-04
supersedes: []
superseded_by: null
---

# ADR-0003 — Métricas de execução: contrato aditivo, config-driven e best-effort ACP

## Context

O motor executa Steps sem visibilidade de custo: nem tempo gasto por Step, nem
tokens consumidos pelo Agente ACP, nem custo monetário da Sessão são capturados.
Para quem opera o `loopy` sobre um backlog multi-task (especialmente via devy),
não há como saber "quanto custou a Task T-003" ou "quanto tempo a Change inteira
consumiu até aqui" — informação essencial para planejar, orçar e detectar
anomalias.

Forças em tensão:

1. **AD-1 (config-driven):** o motor não decide *o que* fazer — decidir
   "quero métricas" é responsabilidade do `loopy.yml`. A feature precisa ser
   **opt-in** (bloco `metrics` ausente ⇒ regressão zero).
2. **Contrato congelado:** `StepResult`, `AgentSession.prompt()`, e o schema de
   `.loopy/state.json` (`RunState`) são superfícies públicas estabilizadas.
   Qualquer extensão deve ser **aditiva** — nunca quebrar assinaturas existentes.
3. **ACP instável:** `PromptResponse.usage` e o stream `usage_update` (cost) são
   marcados `@experimental/UNSTABLE` no SDK. O agente real (`claude-agent-acp`
   v0.26.0) reporta dados úteis, mas eles podem mudar ou desaparecer. A captura
   precisa ser **best-effort**: `null` ⇒ `n/d` no relatório, jamais falhar o Step.
4. **Semântica de `usage` diverge da doc:** a doc do `.d.ts` diz "across session"
   mas o agente real emite `usage` **por-turno** (validado por spike). O design
   precisa **somar** os turnos, não tratá-los como cumulativo.
5. **`cost` é cumulativo da Sessão:** snapshot monotônico entre turnos; reportado
   a nível de Task/Run/Change (não por-Step — seria rateio sem base).
6. **Cross-run:** uma Change pode abranger múltiplas Runs (resume, `--task`,
   re-run pós-escalação). O acumulado por Change precisa de estado persistido
   entre Runs, sem tocar o `RunState` congelado.

Alternativas consideradas:

- **Tokenizer local** para estimar tokens quando o ACP não reporta. Rejeitada:
  adiciona dependência pesada, imprecisa para modelos proprietários, e a decisão
  best-effort já aceita `n/d`.
- **Métricas embutidas (always-on).** Rejeitada: fere AD-1 (o motor não decide
  "quero medir") e gera I/O desnecessário quando o operador não pediu.
- **Persistir no `RunState` existente.** Rejeitada: schema congelado, e métricas
  têm ciclo de vida diferente (vivem além de um resume; não são checkpoint).

## Decision

### 1. Opt-in via bloco `metrics` (AD-1)

```yaml
metrics:                          # ausente ⇒ feature 100% desligada
  report:                         # OPCIONAL
    index: "${change.dir}/../index.md"
```

- **Presença de `metrics`** → coleta Amostras + emite Run report (stderr) +
  grava `.loopy/metrics.json`.
- **`metrics.report.index` presente** → ao finalizar a Change (todo.md com 0
  pendentes), persiste o Change report no path resolvido.
- **Ausência** → comportamento byte-idêntico ao de antes. Nenhum artefato novo.

### 2. Contrato aditivo (tipos e interfaces)

- `AgentSession` ganha **dois métodos novos**: `drainUsage(): TurnUsage | null`
  (soma desde o último drain, reseta) e `readCost(): StepCost | null` (snapshot
  cumulativo). Nenhuma assinatura existente muda.
- `StepResult` fica **intocado** — a captura sai da Sessão, não do resultado.
- `LoopyConfig` ganha `metrics?: MetricsConfig` (readonly, opcional).
- `RunLoopResult` ganha `metrics: RunMetrics`, `startedAt`, `finishedAt`.
- Estado persistido em `.loopy/metrics.json` (gitignored, v1) — arquivo
  separado do `RunState`, escrita atômica (tmp+rename).

### 3. Best-effort ACP

- `usage` por-turno é **somado** num acumulador por-sessão (`SessionWrapper`).
  `drainUsage()` retorna a soma e reseta. Turno `/clear` retorna zeros (inócuo
  na soma).
- `cost` cumulativo é bufferizado via `usage_update` no client. `readCost()`
  retorna o último snapshot não-nulo.
- Quando `usage`/`cost` é `null`, o campo carrega `available: false` e o
  relatório exibe `n/d`. **Nunca** falha o Step por métrica indisponível.

### 4. Coleta: orquestrador como único escritor de Amostras

- Cada **Visita efetivamente executada** gera uma **Amostra**
  `{ durationMs, usage?, cost? }`. Steps não executados (visit-exceeded, sem
  intérprete) não geram Amostra.
- Tempo: envelope de `interpreter.execute()` nos dois call-sites (principal +
  teardown `always`), clock injetável (testabilidade).
- Tokens: `drainUsage()` **após** `execute()` (captura todos os turnos do verify
  loop de uma vez).
- Custo: `readCost()` após `execute()` (barreira `flushSessionUpdates` garante
  o último valor).

### 5. Rollup em quatro níveis

Amostra → Step (soma por `id` numa Task) → Task (Σ Steps; cost = último
snapshot) → Run (Σ Tasks) → Change (fold puro sobre `runs[]` em metrics.json).

### 6. Artefatos de saída

- **Run report** (stderr, ao fim de cada Run): breakdown por Step + subtotal por
  Task + total da Run + linha "Change até agora".
- **Change report** (index.md, ao zerar o backlog): seção `## <change.id>` com
  totais + tabela rica por Task; reescrita byte-preserving.
- **Fim-da-Change** detectado por **re-parse do `todo.md`** (0 pendentes), nunca
  por `stoppedBy` (que só reflete a lista selecionada, não o backlog inteiro).

## Consequences

- **Positivo:** visibilidade completa de custo/tempo por Task e por Change,
  acumulada entre Runs; zero regressão quando opt-out; contrato provado por
  `tsc --noEmit`; sem dependência nova.
- **Negativo / custo:** superfície de código maior (~novo módulo `src/metrics/`);
  a semântica real do ACP diverge da doc (risco de breaking change no SDK
  futuro — mitigado por best-effort + testes explícitos de null).
- **Risco aceito:** custo por-Step não é exposto (cumulativo da Sessão impede
  rateio confiável); se o ACP expuser custo por-turno estável no futuro, a
  decisão pode ser revista.
- **Neutro:** `metrics.json` é mais um artefato gitignored em `.loopy/`; o
  operador pode deletá-lo sem consequências (a próxima Run recria do zero).
