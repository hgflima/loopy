---
number: 0006
title: "Multi-agente ACP: Registry nomeado, N Processos por Run, model/effort best-effort por Step"
status: accepted
date: 2026-07-06
status_date: 2026-07-06
supersedes: []
superseded_by: null
---

# ADR-0006 — Multi-agente ACP: Registry nomeado, N Processos por Run, model/effort best-effort por Step

## Context

O motor assumia **um único Agente ACP por Run** (AD-3): um processo adapter
stdio (`claude-agent-acp`), hospedando N Sessões keyed por Worktree. Todo Step
de Agente usava o mesmo processo, o mesmo modelo e a mesma autonomia — a única
variação por-Step era o `mode` (ex.: `acceptEdits` vs. `plan`).

Essa premissa impedia dois cenários legítimos de Pipeline:

1. **Diversidade de fornecedor** — usar um Agente (ex.: Codex) para tarefas de
   código barato/rápido (simplificar) e outro (ex.: Claude) para implementação
   e auditoria, tudo na mesma Run sem trocar de motor.
2. **Seleção de modelo/effort por Step** — escolher um modelo mais forte para
   implementar e um mais leve para revisar, ou ajustar o reasoning effort por
   etapa do Pipeline, sem depender de env fixo no startup.

Forças em tensão:

- **AD-1 (config-driven):** `agent`, `model` e `effort` são dados do yml —
  o motor repassa cru, não valida valores, não hardcoda nomes de agentes.
- **AD-3 (cwd imutável por Sessão):** Sessões são por-Worktree; introduzir um
  segundo Agente para a mesma Task exige Sessões keyed por `(Agente, Worktree)`.
- **AD-5 (erros como valores):** `setModel`/`setEffort` são best-effort —
  capability ausente no adapter é no-op + log, nunca exceção pro loop.
- **Regressão zero:** todo `loopy.yml` existente sem os campos novos deve rodar
  byte-idêntico (o caminho legado `acp.command` sintetiza o Agente `default`).
- **Effort não é universal:** Codex expõe `model_reasoning_effort` via ACP
  config option; Claude não. O motor não conhece qual Agente suporta o quê.

Alternativas consideradas:

- **Inline por Step (sem registry).** Rejeitada: duplica `command` em cada Step,
  não resolve defaults por-Agente, e torna o conjunto referenciado difícil de
  computar estaticamente.
- **Fixar modelo/effort no startup via env.** Rejeitada: exige um Processo por
  combinação `(agente, modelo, effort)` em vez de um por tipo de Agente; não
  permite trocar no meio do Run; incompatível com o modelo de Sessão reusada.
- **Validar valores de `model`/`effort` contra lista fechada.** Rejeitada: viola
  AD-1 — o motor não conhece modelos válidos nem capabilities; isso é do adapter.

## Decision

### 1. Registry de Agentes nomeados (`agents:`)

Bloco top-level **opcional** no `loopy.yml` que mapeia nomes a definições de
Agente (`{ command, env?, model?, effort? }`). `agents:` e o legado
`acp.command` são **mutuamente exclusivos** (fail-fast); o legado sintetiza
`agents: { default: { command } }` na normalização (`loadConfig` →
`ResolvedAgents { byName, default }`). `acp.default_agent` (opcional) indica
qual Agente do Registry é o default; com um único Agente, o default é implícito;
com >1 sem `default_agent`, `agent:` é obrigatório em todo Step de Agente.

### 2. AD-3 evoluído: um Processo de Agente por Agente referenciado

O conjunto de Agentes **referenciado** pelo Pipeline (os que aparecem em algum
`step.agent` + o default se algum Step omite `agent:`) é estático e computável
no load. **Um Processo adapter stdio por Agente referenciado**, spawned **eager**
no início do Run (falha de spawn = Run falha rápido). Agentes do Registry não
referenciados nunca sobem. Cada Processo mantém seu `gate`/`shutdown`.

### 3. Sessões keyed por `(Agente, Worktree)`

O pool de Sessões passa de `worktree` → `${agent}::${worktree}`. Uma Task com
Steps de dois Agentes distintos tem duas Sessões, cada uma no Processo
correspondente, ambas com cwd = o Worktree da Task (cwd imutável, AD-3).
Sessões lazy (abertas no 1o uso por Agente na Task).

### 4. Seleção por Step (`agent:`, `model:`, `effort:`)

Steps `agent` ganham `agent?`, `model?`, `effort?` (open-ended, não
interpolados — mirror do `mode`). Resolução: `agentName = step.agent ?? default`;
`model = step.model ?? registry[agent].model`; `effort = step.effort ??
registry[agent].effort`. O helper puro `resolveAgentBinding` é a fonte única
dessa resolução (dry-run, orquestrador e step interpreter).

### 5. Aplicação runtime best-effort (simétrico ao `set_mode`)

`AgentSession.setModel(id)` e `setEffort(level)` são aditivos e best-effort:
descobrem o `configId` por **categoria** (`model` / `thought_level`) nos config
options anunciados pelo `session/new`, chamam `session/set_config_option`
(fallback `session/set_model` para modelo). Capability ausente ou erro do
adapter → **no-op + log** (AD-5, nunca lança pro loop). Aplicados na ordem
`setMode → setModel → setEffort` no início de cada Visita ao Step, cada Step
**reafirma** seus valores (determinismo sob Sessão reusada).

### 6. Escopo de `${env.*}` confinado

`${env.KEY}` é resolvido **só** em `agents.*.env` num passe dedicado no build do
pool — **não** entra em `buildScopeVars`. `${env.KEY}` em prompt/shell é var
desconhecida (fail-fast). Chave declarada mas ausente do ambiente = `ConfigError`
fail-fast. O valor literal de segredos nunca entra em config/prompt/log.

## Consequences

**Positivas:**
- Um Pipeline pode **misturar** Agentes: implementar com Claude, simplificar com
  Codex, auditar com outro fornecedor — selecionável **por Step**.
- Model e effort por Step permitem otimizar custo/qualidade sem trocar de motor.
- O caminho é **100% aditivo**: regressão zero para todos os `loopy.yml`
  existentes; `acp.command` legado continua válido.
- Best-effort para model/effort é robusto a mudanças do schema *unstable* do ACP
  e à assimetria entre adapters (Codex tem effort; Claude não).

**Negativas:**
- Mais de um Processo de Agente por Run consome mais recursos (memória, cold-start
  npx duplicado). Mitigado: só Agentes **referenciados** sobem.
- Custo multi-Sessão exige somar snapshots finais das N Sessões por Task (soma,
  não último snapshot). Breakdown por-Agente é follow-up.
- `session/set_config_option` é área *unstable* do ACP — o mapeamento por
  categoria pode divergir entre versões de adapters. Best-effort protege.

**Neutras:**
- O motor continua não validando valores de `model`/`effort` (AD-1) — erros de
  modelo/effort são do adapter, não do motor.
- Métricas (ADR-0003): forma persistida de `.loopy/metrics.json` inalterada;
  custo por-Task soma os snapshots das N Sessões.
- TUI (ADR-0005): Stream/Logs ACP prefixam `[<agent>]` só quando >1 Agente ativo;
  single-agent é byte-idêntico.
