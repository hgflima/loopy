---
number: 0002
title: Estender on_fail com goto, adicionar on_success e max_step_visits
status: accepted
date: 2026-07-04
status_date: 2026-07-04
supersedes: []
superseded_by: null
---

# ADR-0002 — Estender on_fail com goto, adicionar on_success e max_step_visits

## Context

O ADR-0001 unificou a ação em falha dos steps numa única chave `on_fail`, cujo
único valor era `escalate`. Esse ADR previu explicitamente que diferenciar ou
ampliar a ação exigiria um novo ADR. Este é esse ADR.

Hoje o Pipeline é uma lista estritamente sequencial: cada Step avança para o
próximo (`índice + 1`), e a única forma de desvio é "após uma falha, escalar e
pular os subsequentes não-`always` até o teardown". Não há como **voltar** a um
Step anterior nem **saltar** para um Step adiante.

O caso de uso central é o **fix-loop**: um Step de review falha → o fluxo deve
retornar ao Step de implementação para que o agente corrija, sem abortar a Task.
Isso exige controle de fluxo não-linear — saltos — sem quebrar o invariante
AD-1 (motor interpreta, config decide).

Alternativas consideradas:

1. **Manter `on_fail: escalate` como único valor.** Rejeitada: impede o
   fix-loop; qualquer falha aborta a Task mesmo quando o fluxo poderia
   convergir com uma nova tentativa.
2. **Proibir ciclos estáticos e permitir apenas saltos para frente.** Rejeitada:
   o fix-loop *é* um ciclo intencional e é o motivo desta feature. A defesa
   contra loop infinito é runtime, não estática.
3. **Ampliar `on_fail` para `escalate | { goto }`, criar `on_success: { goto }`
   e limitar ciclos por teto de runtime.** Escolhida.

## Decision

Estender a linguagem do `loopy.yml` com três capacidades, preservando o
invariante AD-1 (motor interpreta, config decide) e a unicidade de `on_fail`
estabelecida no ADR-0001:

### 1. `on_fail` ampliado: `escalate | { goto: <step-id> }`

`on_fail` passa a aceitar, além do literal `escalate`, um objeto
`{ goto: <step-id> }` cujo alvo é o `id` de um Step existente no pipeline.
Em falha, o motor salta para o alvo em vez de escalar. Omitir `on_fail`
continua significando `escalate` (regressão zero). `on_fail` permanece por
primitiva de step (agent/shell/checks/approval), como o ADR-0001 definiu.

O guard do agente do ADR-0001 se generaliza: `on_fail` em Step `agent` —
seja `escalate` ou `{ goto }` — exige `verify` ou `expect` (senão a falha
é inobservável e a ação é órfã).

### 2. Nova chave `on_success: { goto: <step-id> }` em `StepBase`

Desvio em sucesso: ao completar um Step com sucesso, o motor salta para o
alvo em vez de seguir ao próximo. Omitir `on_success` = sequencial (próximo
Step). Mora em `StepBase` (universal a todo tipo de step, nunca órfão —
sucesso é sempre bem-definido).

### 3. Teto de runtime `max_step_visits` em `stop_conditions`

Novo campo `stop_conditions.max_step_visits` (inteiro ≥ 1, default 10) —
limite de execuções por Step, por Task. Ao entrar num Step cuja contagem de
visitas excedeu o teto, o motor **não executa** e dispara terminal
**escalate** com motivo "step `<id>` excedeu max_step_visits (N)"
(fail-closed; respeita `policies.escalation`). Este é o guard de runtime
contra loops infinitos.

### Ciclos: permitidos + teto de runtime

Ciclos no grafo de goto são **permitidos** — o fix-loop é um ciclo
intencional (`review → implement → review`). A validação estática **não**
rejeita ciclos. Em vez disso:

- **Validação estática** cobre só o sempre-erro: `id` duplicado no pipeline
  e `goto` apontando para alvo inexistente. Ambos são erros fatais.
- **Warning não-bloqueante** é emitido ao detectar ciclo no grafo — cortesia
  contra laço acidental ("confirme que é intencional").
- **Defesa real** é o teto de runtime (`max_step_visits`), fail-closed.

### Semântica de execução

O laço de steps (`runTaskPipeline`) deixa de ser `for...of` linear e passa a
um **program counter (PC)** sobre `Map<id, índice>`:

1. Ao entrar em `PC`: incrementa `visits[id]`; se excede `max_step_visits` →
   terminal escalate (sem executar).
2. Executa o Step.
3. Sucesso: se `on_success.goto` → `PC = stepIndex[goto]`; senão `PC += 1`.
4. Falha: se `on_fail: { goto }` → `PC = stepIndex[goto]`; se `escalate`
   (ou omitido) → terminal escalate.
5. `PC` além do último Step → terminal sucesso.

Steps `always` (teardown) preservam o comportamento atual: rodam em ordem
declarada ao atingir qualquer terminal. Desvios (`on_success`/`on_fail`)
declarados em steps `always` são **ignorados** na fase de teardown — o
teardown é sempre linear/best-effort. A validação emite warning informativo
para esse caso.

## Consequences

- **Positivo:** pipelines com fix-loop convergem sem abortar a Task; controle
  de fluxo expressivo sem quebrar AD-1; regressão zero (omitir as chaves
  novas = comportamento atual).
- **Negativo / custo:** `runTaskPipeline` precisa de rewrite (PC + visits);
  `id` deixa de ser decorativo e passa a ser alvo de salto (unicidade vira
  invariante); modelo de checkpoint do resume precisa migrar de
  `completedSteps` para `pc + visits + carry`.
- **Risco aceito:** ciclos são permitidos — a defesa é exclusivamente
  runtime (`max_step_visits`). Se o default 10 for inadequado para algum
  pipeline, o autor ajusta em `stop_conditions`.
