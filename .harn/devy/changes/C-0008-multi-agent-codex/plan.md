# Plano de implementação: Múltiplos agentes de código via ACP (Codex + Claude)

> Derivado de `spec.md` (C-0008). Slice vertical, ordem topológica por dependência,
> cada Task deixa o motor **verde** (`typecheck`/`lint`/`test`) e mantém **regressão
> zero** (todo `loopy.yml` sem `agents:`/`agent:`/`model:`/`effort:` roda byte-idêntico).

## Overview

O motor deixa de assumir **um** Agente ACP por Run e passa a dirigir **N Agentes
nomeados** (um Processo adapter stdio por Agente referenciado), selecionáveis **por
Step** via `agent:`, com **model** e **effort** aplicados em runtime pela Sessão ACP
(best-effort, simétrico ao `mode`). Invariantes mantidos: **AD-1** (motor repassa
`agent`/`model`/`effort` crus, não valida valores), **AD-3 evoluído** (um Processo por
Agente **referenciado**, cwd imutável por Sessão), **AD-5** (`setModel`/`setEffort`
best-effort — no-op + log, nunca lançam).

## Architecture Decisions (as que atravessam as Tasks)

- **AD-1 (config-driven):** `agent`/`model`/`effort` são strings cruas repassadas ao
  adapter; o motor só valida `agent` **referencialmente** (existe no Registry). Nenhuma
  lista fechada de modelos/efforts no código.
- **AD-3 evoluído:** **um Processo de Agente por Agente referenciado** pelo Pipeline,
  spawned **eager** no início do Run (conjunto referenciado é estático). Sessões keyed por
  `(Agente, Worktree)` — uma Task pode ter N Sessões (uma por Agente), todas com o mesmo cwd.
- **AD-5 (erros como valores):** `setModel`/`setEffort` capturam erro do adapter, logam e
  engolem; capability ausente ⇒ no-op + log. Nunca sobem pro loop.
- **Fronteira de confiança (config):** `load` normaliza para um `ResolvedAgents { byName,
  default }` anexado ao `LoopyConfig`. Nada a jusante reprocessa o legado.

### Decisões de projeto tomadas neste plano (consistentes com a spec)

1. **`LoopyConfig` carrega `ResolvedAgents`** (`{ byName: Record<name, AgentDef>, default:
   name }`), produzido no `load`. Isso torna a resolução uniforme a jusante (dry-run, step,
   orquestrador) sem reprocessar o legado — resolve o "(ou derivável)" da spec por **anexar**.
2. **Helper puro único de binding de Agente** — `resolveAgentBinding(step, resolvedAgents) →
   { agentName, model?, effort? }` — fonte única do escopo Agente/model/effort, reusada por:
   (a) orquestrador (escolher a Sessão), (b) step `agent` (aplicar `setModel`/`setEffort`),
   (c) dry-run (imprimir). Espelha o papel de `buildScopeVars` (AD-4/AD-6, funções puras).
3. **`SessionProvider` ganha o nome do Agente:** `(agentName, cwd) => Promise<AgentSession>`.
   O orquestrador fica agnóstico a "qual pool/quantos processos" — isso é do `index.ts`.
4. **Sessão por-`(Agente, Worktree)` memoizada por Task:** o `createLazySession` único por
   Task vira um `Map<agentName, AgentSession>` de sessões lazy (abre no 1º uso daquele
   Agente naquela Task).
5. **Resolução de `${env.KEY}` é passe puro, env-only, no build do pool** (não em
   `buildScopeVars`, não persistida em `ResolvedAgents`): o segredo nunca entra em
   config/prompt/log. Chave declarada mas ausente do ambiente ⇒ `ConfigError` fail-fast.
6. **Descoberta do config option por categoria** (`model` / `thought_level`) nos
   `configOptions`/`availableModels` anunciados no `session/new`; param do payload é
   **`configId`** (não `id`), fallback `session/set_model` p/ modelo. Robusto ao schema
   *unstable* — precisa de verificação viva no handshake do `codex-acp` (ver Risks).

## Dependency Graph

```
T1 Config: agentDefSchema/agentsSchema, acp.command?, agentStep.agent?/model?/effort?,
   superRefine (exclusão mútua, agent existe, default resolvível, ">1 sem default ⇒ agent
   obrigatório"), load → ResolvedAgents (sintetiza `default` do legado), dead-profile warning,
   helper puro referencedAgents(pipeline, default)
   │
   ├── T2 Session port: AgentSession += setModel/setEffort; SessionWrapper (descoberta por
   │      categoria + fallback legado; best-effort/log/swallow); createLazySession delega
   │      │
   │      ├── T3 Pools: AgentProcessPool (eager sobre referencedAgents, keyed por nome) +
   │      │      session pool keyed por (agente,worktree) + passe puro resolveAgentEnv (fail-fast)
   │      │      │
   │      │      └── T6 Wiring vivo (index.ts): monta AgentProcessPool do ResolvedAgents;
   │      │             sessionId→{taskId,agent}; onUpdate/onTraffic por Processo
   │      │             │
   │      │             ├── T7 Métricas: custo por-Task = soma dos snapshots finais das N Sessões
   │      │             └── T8 TUI: prefixa Stream/Logs ACP por Agente quando >1 ativo
   │      │
   │      └── T4 Roteamento: helper resolveAgentBinding + orquestrador resolve step.agent por
   │             Step + sessões lazy por-agente + SessionProvider(agentName,cwd) + dry-run imprime
   │             │
   │             └── T5 Step de Agente (paridade): setMode→setModel→setEffort (condicional,
   │                    best-effort, cada Step reafirma); resto do interpreter inalterado
   │
   └── T9 Exemplo canônico multi-agente + aceite dry-run + ADR-0006 + CONTEXT.md + docstrings
```

Caminho crítico: **T1 → T2 → {T3 → T6, T4 → T5}**. T7/T8 após T6; T9 por último (dry-run de
aceite viável já após T4; e2e vivo após T6).

## Task List

### Fase 1 — Fundação de config (regressão zero)

#### T1: Contrato + schema + normalização `ResolvedAgents`
**Descrição:** Estende o contrato congelado (aditivo, `.strict()` em sincronia) e normaliza o
`loopy.yml` para um `ResolvedAgents` anexado ao `LoopyConfig`, sintetizando o Agente `default`
do `acp.command` legado. Só forma/normalização — **nenhuma** mudança de runtime.

**Acceptance criteria:**
- [ ] `types.ts`: `AgentDef { command; env?; model?; effort? }`; `LoopyConfig.agents?` +
  `resolvedAgents: ResolvedAgents`; `AcpConfig.command?`/`default_agent?`;
  `AgentStep.agent?/model?/effort?` — tudo aditivo, campos existentes inalterados.
- [ ] `schema.ts`: `agentDefSchema`/`agentsSchema` (opcional top-level); `acp.command` vira
  opcional + `default_agent?`; `agentStepSchema` += 3 campos open-ended; `superRefine`:
  (a) `agents:` e `acp.command` **não coexistem**; (b) todo `step.agent` existe; (c)
  `default_agent` (se dado) existe; (d) ≥1 Agente resolvível; (e) **>1 Agente sem
  `default_agent` ⇒ `agent:` obrigatório em todo Step de agente** (mensagem lista os agentes).
- [ ] `load.ts`: produz `ResolvedAgents { byName, default }`; legado `{command}` → `byName:
  { default: {command} }`, `default: "default"`; anexa ao `LoopyConfig`.
- [ ] `warnings.ts`: warning não-bloqueante de **dead profile** (Agente no Registry nunca
  referenciado). **Sem** warning estático de effort (R7 — violaria AD-1).
- [ ] Helper puro `referencedAgents(pipeline, defaultName): Set<string>` (usado depois por T3/T6).
- [ ] `agent:`/`model:`/`effort:` **rejeitados** em `shell`/`checks`/`approval` (union + `.strict()`).

**Verification:**
- [ ] `npm test -- config` verde: exemplo canônico atual valida **inalterado** e sintetiza
  `default`; `agents:` valida; exclusão mútua/`agent` inexistente/`default_agent` inexistente/
  ">1 sem default" ⇒ `ConfigError` com mensagem clara; dead-profile warning.
- [ ] `npm run typecheck` verde (prova compatibilidade `LoopyConfigParsed` ↔ `LoopyConfig`).

**Dependencies:** None.
**Files:** `src/types.ts`, `src/config/schema.ts`, `src/config/load.ts`, `src/config/warnings.ts`, `tests/config/*`.
**Escopo:** Medium.

### Fase 2 — Capacidades de runtime (isoladas, best-effort)

#### T2: Port de Sessão `setModel`/`setEffort` (best-effort)
**Descrição:** Adiciona ao `AgentSession` os dois métodos aditivos best-effort e implementa em
`SessionWrapper`, descobrindo a **categoria** do config option (`model`/`thought_level`) anunciada
no `session/new` e chamando `session/set_config_option` com `{ sessionId, configId, value }`
(fallback `session/set_model` p/ modelo). Erro do adapter/capability ausente ⇒ log + engole.

**Acceptance criteria:**
- [ ] `types.ts`: `AgentSession.setModel(modelId)`/`setEffort(level): Promise<void>` (aditivo).
- [ ] `SessionWrapper` inspeciona `configOptions`/`availableModels` do `session/new`; descobre o
  `configId` por categoria; ausente ⇒ no-op + `logger.debug`; presente ⇒ `set_config_option`.
- [ ] Effort embutido no ModelId (`gpt-5-codex[high]`) funciona naturalmente via `setModel`.
- [ ] Erro do adapter (method-not-found) é capturado, logado e **engolido** (não lança — AD-5).
- [ ] `createLazySession` (orquestrador) e quaisquer implementadores de `AgentSession` ganham os
  dois métodos delegando ao subjacente (`opened?.setModel(...)`).

**Verification:**
- [ ] `npm test -- acp/session` verde (fakes): chama `set_config_option` quando capability
  anunciada; no-op + log quando ausente; erro engolido; ModelId com effort embutido.
- [ ] `npm run typecheck`/`npm run lint` verdes.

**Dependencies:** T1.
**Files:** `src/types.ts`, `src/acp/session.ts`, `src/loop/orchestrator.ts` (lazy delega), `tests/acp/session.*`.
**Escopo:** Medium.

#### T3: `AgentProcessPool` + session pool re-keyed + resolução de `env`
**Descrição:** `openAgent` recebe `command`+`env` por-Agente; novo `AgentProcessPool` (keyed por
nome do Agente, **eager** sobre `referencedAgents`, spawn no início; falha de spawn = Run falha
rápido); `createSessionPool` re-keyed por `(agente, worktree)`; passe puro `resolveAgentEnv(agents,
processEnv)` (escopo env-only, `${env.KEY}` ⇒ valor do ambiente, ausente ⇒ `ConfigError`). Módulos
novos/editados, **unit-tested com fakes** — ainda não fiados no `index.ts`.

**Acceptance criteria:**
- [ ] `AgentProcessPool`: sobe **um** Processo por Agente **referenciado**, eager; Agente não
  referenciado **não** spawna; falha de spawn de qualquer um ⇒ rejeita o build inteiro (fail-fast).
  Cada Processo mantém `gate`/`shutdown` (AD-3); `closeAll`/`shutdown` idempotentes.
- [ ] `createSessionPool` keyed por `${agent}::${worktree}` (composto); `session(agent, cwd)`
  cria/reusa a Sessão daquele par; `peek`/`close`/`closeAll` atualizados.
- [ ] `resolveAgentEnv` puro: `${env.KEY}` resolve de `process.env`; chave ausente ⇒ `ConfigError`
  fail-fast; `${env.KEY}` **não** resolve em prompt/shell (escopo confinado — provado por T1/T4 já).
  Agente `codex` sem `env` ⇒ sobe sem env (subscription — mock).

**Verification:**
- [ ] `npm test -- acp/pool` verde: eager só do conjunto referenciado; spawn-fail ⇒ fail-fast;
  session pool cria 2 Sessões numa Task com 2 Agentes; reuso entre Steps do mesmo Agente.
- [ ] `npm test -- config/env` (ou junto): env presente resolve; ausente ⇒ `ConfigError`.
- [ ] `npm run typecheck`/`npm run lint` verdes.

**Dependencies:** T1, T2.
**Files:** `src/acp/agent.ts`, `src/acp/session.ts`, `src/acp/pool.ts` (novo), `src/config/env.ts` (novo), `tests/acp/*`.
**Escopo:** Medium.

### Checkpoint A — Fundação
- [ ] `npm run typecheck`, `npm run lint`, `npm test` verdes.
- [ ] Exemplo canônico atual carrega e `--dry-run` imprime **byte-idêntico** ao de hoje.
- [ ] Módulos de pool/session/config unit-tested; nenhuma mudança de comportamento vivo ainda.
- [ ] **Revisar com humano antes de prosseguir.**

### Fase 3 — Roteamento + paridade (o caminho vertical)

#### T4: Roteamento Agente→Sessão + dry-run + helper de binding
**Descrição:** Introduz o helper puro `resolveAgentBinding` e liga o orquestrador a resolver o
Agente **por Step**, injetando a Sessão do `(agente, worktree)`. `SessionProvider` ganha
`agentName`; a Sessão lazy única por Task vira um `Map<agentName, lazySession>`. Dry-run passa a
imprimir Agente/model/effort resolvidos por Step. `index.ts` atualiza a assinatura do provider
minimamente (ainda um só Processo — single-agent idêntico).

**Acceptance criteria:**
- [ ] `resolveAgentBinding(step, resolvedAgents) → { agentName, model?, effort? }` puro:
  `agentName = step.agent ?? default`; `model = step.model ?? byName[agentName].model`;
  `effort = step.effort ?? byName[agentName].effort`. Reusado por orquestrador+step+dry-run.
- [ ] `SessionProvider = (agentName, cwd) => Promise<AgentSession>`; `runTaskPipeline` mantém
  `Map<agentName, AgentSession>` de sessões lazy por Task; `buildTaskStepContext` recebe a Sessão
  do Agente resolvido para o Step; Steps não-`agent` inalterados (não tocam Sessão).
- [ ] Dry-run (`resolveStep`/`renderStep`): Step `agent` mostra `agent: <nome>`, `model: <x>`,
  `effort: <y>` resolvidos (quando presentes) — via `resolveAgentBinding`.
- [ ] `index.ts` provider vira `(agentName, cwd) => …` (single-agent: ignora agentName, idêntico).

**Verification:**
- [ ] `npm test -- orchestrator` verde (fakes): Pipeline `implement(codex)→review(claude)` numa
  Task resolve as **duas** Sessões corretas; Steps não-agent inalterados; single-agent **byte-
  idêntico** (uma Sessão, resultado igual).
- [ ] `npm test -- dry-run` (ou orchestrator plan): dry-run imprime agent/model/effort resolvidos.
- [ ] `npm run typecheck`/`npm run lint`/`npm test` verdes.

**Dependencies:** T1, T2.
**Files:** `src/loop/orchestrator.ts`, `src/index.ts` (assinatura mínima), `tests/loop/*`.
**Escopo:** Medium.

#### T5: Step de Agente aplica `setModel`/`setEffort` (paridade)
**Descrição:** No início de cada visita ao Step `agent`, após `setMode`, aplica
`setModel(modelEfetivo)` → `setEffort(effortEfetivo)` (via `resolveAgentBinding` de T4),
condicional (só quando resolvido) e best-effort. Cada Step **reafirma** seu model/effort
(determinismo sob Sessão reusada). Todo o resto do interpreter fica **inalterado** — é aí que
mora a paridade exigida pelo pedido.

**Acceptance criteria:**
- [ ] Ordem: `setMode(step.mode)` → `setModel(modelEfetivo)` → `setEffort(effortEfetivo)`, cada
  um só quando resolvido; nenhum interpolado (mirror do `mode`); nenhum lança pro loop.
- [ ] `verify`/`${checks.report}`/retry, `expect`/Verdict, `on_fail` (escalate/`{goto}`),
  `on_success`, `clear_context` funcionam **idênticos**.
- [ ] `StepResult` **igual** ao de hoje quando `agent`/`model`/`effort` são omitidos.

**Verification:**
- [ ] `npm test -- steps/agent` verde: ordem setMode→setModel→setEffort com fakes; fluxo de
  verify/expect/on_fail/on_success/clear idêntico; `StepResult` igual sem campos novos.
- [ ] `npm run typecheck`/`npm run lint`/`npm test` verdes.

**Dependencies:** T2, T4.
**Files:** `src/steps/agent.ts`, `tests/steps/agent.*`.
**Escopo:** Small–Medium.

### Checkpoint B — Roteamento + paridade
- [ ] Roteamento multi-agente e paridade provados com fakes; single-agent byte-idêntico.
- [ ] Dry-run mostra Agente/model/effort resolvidos por Step.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` verdes.
- [ ] **Revisar com humano antes de prosseguir.**

### Fase 4 — Wiring vivo + integração

#### T6: Wiring multi-processo no `index.ts`
**Descrição:** `defaultRunLive` constrói o `AgentProcessPool` a partir do `ResolvedAgents`
(eager sobre `referencedAgents`; falha de spawn = Run falha rápido), usa o session pool re-keyed
e o `resolveAgentEnv`; o `Map<sessionId, taskId>` da TUI passa a `Map<sessionId, {taskId, agent}>`;
`onUpdate`/`onTraffic` são registrados **por Processo de Agente**. Aqui `agent: codex` spawna
`codex-acp` de verdade.

**Acceptance criteria:**
- [ ] `AgentProcessPool` montado do `ResolvedAgents`; só sobem os Agentes referenciados; spawn-fail
  ⇒ Run falha rápido antes de qualquer Task; `pool.closeAll()`+`shutdown` de todos no `finally`.
- [ ] `sessionProvider(agentName, cwd)` roteia ao Processo certo e registra `sessionId →
  {taskId, agent}`; `onUpdate`/`onTraffic` carimbam taskId por sessão em **cada** Processo.
- [ ] `resolveAgentEnv` invocado aqui (segredo só no env do Processo, nunca em config/log).
- [ ] Single-agent: idêntico ao de hoje (um Processo, um provider).

**Verification:**
- [ ] `npm test -- index` / testes de `runLive` com hooks verdes (sem spawnar agente real).
- [ ] `/verify` manual (subscription): `npm run dev -- ../alvo --dry-run` do exemplo multi-agente
  resolve; com `codex login`, um Run curto sobe Claude + Codex (checagem manual, e2e leve).
- [ ] `npm run typecheck`/`npm run lint`/`npm test` verdes.

**Dependencies:** T3, T4.
**Files:** `src/index.ts`, `src/acp/pool.ts`, `tests/e2e/*` (hooks).
**Escopo:** Medium–Large.

#### T7: Métricas — custo por-Task sob multi-Sessão
**Descrição:** O Agregado de Task passa a **somar** o snapshot final de custo de **cada** Sessão da
Task (uma por Agente), best-effort (`n/d` quando um Agente não reporta). Uso (tokens) por-turno
somado por Step permanece inalterado. Forma persistida de `.loopy/metrics.json` inalterada.

**Acceptance criteria:**
- [ ] `runTaskPipeline`: `TaskMetrics.cost` = soma dos `readCost()` finais das Sessões da Task
  (itera o `Map<agentName, session>`), não mais "último snapshot"; `null`/ausente tolerado.
- [ ] Rollup por-Step de custo continua **não** existindo; forma de `metrics.json` inalterada.
- [ ] Single-agente (uma Sessão): custo idêntico ao de hoje.

**Verification:**
- [ ] `npm test -- metrics` / `orchestrator` verde: 2 Sessões numa Task ⇒ custo somado; 1 Sessão ⇒
  idêntico; Agente sem custo ⇒ soma o que houver (`n/d` a jusante).
- [ ] `npm run typecheck`/`npm run lint`/`npm test` verdes.

**Dependencies:** T4 (multi-Sessão por Task). Integra completo após T6.
**Files:** `src/loop/orchestrator.ts`, `src/metrics/folds.ts` (se necessário), `tests/metrics/*`.
**Escopo:** Small.

#### T8: TUI — prefixa Stream/Logs ACP por Agente quando >1
**Descrição:** Quando **>1** Agente está ativo no Run, a store/view prefixa Stream e Tráfego ACP
com o nome do Agente da Sessão (C-0007). Single-agent = **byte-idêntico** (sem prefixo).

**Acceptance criteria:**
- [ ] Eventos `stream_chunk`/`acp_traffic` carregam o Agente (do `Map<sessionId,{taskId,agent}>`);
  a view prefixa `[<agent>]` **só** quando >1 Agente ativo.
- [ ] Single-agent: nenhum prefixo — saída byte-idêntica à de hoje.

**Verification:**
- [ ] `npm test -- tui` verde: >1 Agente ⇒ prefixo; 1 Agente ⇒ idêntico.
- [ ] `npm run typecheck`/`npm run lint`/`npm test` verdes.

**Dependencies:** T6.
**Files:** `src/tui/store.ts`, `src/tui/view.ts`, `src/index.ts`, `tests/tui/*`.
**Escopo:** Small–Medium.

### Fase 5 — Exemplo + docs (aceite)

#### T9: Exemplo canônico multi-agente + ADR-0006 + CONTEXT.md + docstrings
**Descrição:** `examples/loopy.yml` vira um Pipeline multi-agente real (Claude implementa como
**default** + Codex simplifica com `effort: low` + Claude audita em `mode: plan`); teste de aceite
carrega e `--dry-run` imprime Agente/model/effort por Step. ADR-0006 registra a evolução (AD-3
evoluído; model/effort best-effort; Registry). CONTEXT.md promove Agente/Processo de
Agente/Sessão + Registry/Model/Effort. Docstrings e CLAUDE.md filhos (config/acp/loop/steps/
metrics/tui) atualizados.

**Acceptance criteria:**
- [ ] `examples/loopy.yml`: `agents: { claude, codex }`, `acp.default_agent: claude`,
  `agent: codex` só no simplify (`effort: low`), audit em `mode: plan`; carrega e resolve.
- [ ] Teste de aceite: exemplo multi-agente `--dry-run` imprime, por Step, Agente/model/effort
  resolvidos, **sem escrever nada**.
- [ ] `docs/adrs/0006-*.md` (via skill de ADR); CONTEXT.md com os termos novos; CLAUDE.md filhos
  e docstrings dos módulos tocados atualizados.

**Verification:**
- [ ] `npm test -- accept` (ou e2e leve) verde: exemplo multi-agente carrega + dry-run resolve.
- [ ] `npm run typecheck`/`npm run lint`/`npm test` **todos verdes** (Success Criterion #10).

**Dependencies:** T4, T5 (dry-run de aceite); e2e vivo após T6.
**Files:** `examples/loopy.yml`, `docs/adrs/0006-*.md`, `CONTEXT.md`, `src/**/CLAUDE.md`, `tests/*`.
**Escopo:** Medium.

### Checkpoint C — Completo
- [ ] Todos os 10 Success Criteria da spec atendidos.
- [ ] e2e leve: dry-run do exemplo multi-agente resolve; (manual) Run curto sobe Claude+Codex.
- [ ] Regressão zero confirmada: `loopy.yml` sem campos novos byte-idêntico.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` verdes.
- [ ] **Pronto para review.**

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|------|---------|-----------|
| `session/set_config_option` é área *unstable* do ACP; `configId`/categorias podem divergir do `codex-acp` real | Médio | Descoberta **por categoria** em runtime (nada hardcodado) + best-effort (no-op + log); **verificar o `session/new` real do `codex-acp` no handshake** (T2/T6) antes de fechar o mapeamento; context7/ACP como fonte |
| Mudança de assinatura do `SessionProvider` e do session pool ripa pra `index.ts` | Médio | T4 atualiza a assinatura **minimamente** (single-agent idêntico); T6 faz o wiring real — cada Task fica verde |
| Custo multi-Sessão pode duplicar se somar snapshot não-final | Baixo | Somar **só** o snapshot final por Sessão ao término da Task (não por-Step); best-effort `n/d` |
| Segredo (`CODEX_API_KEY`) vazar em config/log | Alto | `${env.*}` só em `agents.*.env`, resolvido no build do pool, **nunca** em `buildScopeVars`/`ResolvedAgents`/log; ausente ⇒ fail-fast |
| Regressão em `loopy.yml` existente | Alto | `.strict()` aditivo; `default` sintetizado do legado; testes de regressão byte-idêntica em cada Checkpoint |
| Effort sem paridade no Claude tratado como erro | Baixo | Modelado como capacidade **por-Agente**: no-op + log em runtime (R7), nunca erro de config |

## Open Questions

As OQ-A/B/C e R1–R11/F1–F3 já foram **resolvidas** na spec (Refino rodada 2). Restam apenas
verificações de implementação (não decisões de produto):

- **IV-1:** Confirmar, no `session/new` real do `@agentclientprotocol/codex-acp@1.1.0`, os
  `configOptions`/categorias exatas (`model`/`thought_level`/reasoning) e o nome do param
  (`configId`). Verificar em T2 (handshake vivo / context7 ACP) — best-effort protege se divergir.
- **IV-2:** Confirmar que `openAgent` com `env` por-Agente + herança de `process.env` no spawn
  basta para a auth por subscription do Codex (`auth.json`) sem scrubbing. Verificar em T6.
