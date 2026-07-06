# Backlog: C-0008 — Múltiplos agentes de código via ACP (Codex + Claude)

> Slice vertical, ordem topológica. Cada Task deixa o motor verde
> (`typecheck`/`lint`/`test`) e mantém **regressão zero**. Ver `plan.md` para o
> detalhe de cada Task, os Checkpoints e o grafo de dependências.

- [x] T-001: Contrato + schema + normalização ResolvedAgents
  Aditivo e `.strict()` em sincronia. `types.ts`: `AgentDef`, `LoopyConfig.agents?` +
  `resolvedAgents`, `AcpConfig.command?/default_agent?`, `AgentStep.agent?/model?/effort?`.
  `schema.ts`: `agentDefSchema`/`agentsSchema` (opcional), `acp.command` opcional, superRefine
  (exclusão mútua legado×`agents:`, `agent` existe, `default_agent` existe, ≥1 resolvível,
  >1 sem `default_agent` ⇒ `agent:` obrigatório). `load.ts`: `ResolvedAgents { byName, default }`
  sintetizando `default` do legado. `warnings.ts`: dead-profile (sem warning de effort — R7).
  Helper puro `referencedAgents(pipeline, default)`. `agent/model/effort` rejeitados fora de `agent`.
  Aceite: exemplo atual valida inalterado + sintetiza default; erros de config claros; typecheck verde.
  Deps:
  Files: src/types.ts, src/config/schema.ts, src/config/load.ts, src/config/warnings.ts

- [ ] T-002: Port de Sessão setModel/setEffort (best-effort)
  `AgentSession += setModel/setEffort` (aditivo). `SessionWrapper` descobre a categoria do config
  option (`model`/`thought_level`) anunciada no `session/new`, chama `session/set_config_option`
  `{ sessionId, configId, value }` (fallback `session/set_model`); capability ausente ⇒ no-op + log;
  erro do adapter engolido (nunca lança — AD-5); effort embutido no ModelId (`gpt-5-codex[high]`)
  via `setModel`. `createLazySession` delega os dois métodos ao subjacente.
  Verificar (IV-1) o `session/new` real do codex-acp — best-effort protege divergência.
  Deps: T-001
  Files: src/types.ts, src/acp/session.ts, src/loop/orchestrator.ts

- [ ] T-003: AgentProcessPool + session pool re-keyed + resolução de env
  `openAgent` recebe `command`+`env` por-Agente. `AgentProcessPool` novo (keyed por nome, **eager**
  sobre `referencedAgents`; spawn no início; falha de spawn = Run falha rápido; Agente não
  referenciado não sobe). `createSessionPool` re-keyed por `${agent}::${worktree}`; `session(agent,
  cwd)`. Passe puro `resolveAgentEnv(agents, processEnv)` (escopo env-only; `${env.KEY}` do ambiente;
  ausente ⇒ `ConfigError` fail-fast). Unit-tested com fakes; ainda não fiado no index.ts.
  Aceite: eager só do referenciado; spawn-fail ⇒ fail-fast; 2 Sessões numa Task com 2 Agentes; reuso.
  Deps: T-001, T-002
  Files: src/acp/agent.ts, src/acp/session.ts, src/acp/pool.ts, src/config/env.ts

- [ ] T-004: Roteamento Agente→Sessão + dry-run + helper de binding
  Helper puro `resolveAgentBinding(step, resolvedAgents) → { agentName, model?, effort? }` (fonte
  única, reusada por orquestrador+step+dry-run). `SessionProvider` ganha `agentName`; `runTaskPipeline`
  mantém `Map<agentName, lazySession>` por Task; `buildTaskStepContext` recebe a Sessão do Agente
  resolvido; Steps não-`agent` inalterados. Dry-run imprime `agent`/`model`/`effort` resolvidos.
  `index.ts` atualiza a assinatura do provider minimamente (single-agent idêntico).
  Aceite: Pipeline implement(codex)→review(claude) resolve 2 Sessões; single-agent byte-idêntico.
  Deps: T-001, T-002
  Files: src/loop/orchestrator.ts, src/index.ts

- [ ] T-005: Step de Agente aplica setModel/setEffort (paridade)
  Após `setMode`, aplica `setModel(modelEfetivo)` → `setEffort(effortEfetivo)` (via
  `resolveAgentBinding`), condicional/best-effort, cru (mirror do `mode`); cada Step reafirma
  (determinismo sob Sessão reusada). Resto do interpreter **inalterado** (paridade): verify/
  `${checks.report}`/retry, expect/Verdict, on_fail (escalate/`{goto}`), on_success, clear_context.
  `StepResult` igual ao de hoje quando `agent`/`model`/`effort` omitidos.
  Aceite: ordem setMode→setModel→setEffort; fluxo atual idêntico; StepResult igual sem campos novos.
  Deps: T-002, T-004
  Files: src/steps/agent.ts

- [ ] T-006: Wiring multi-processo no index.ts
  `defaultRunLive` monta `AgentProcessPool` do `ResolvedAgents` (eager sobre `referencedAgents`;
  spawn-fail = Run falha rápido), usa o session pool re-keyed e `resolveAgentEnv`. Map da TUI vira
  `sessionId → {taskId, agent}`; `onUpdate`/`onTraffic` por Processo. `agent: codex` spawna
  `codex-acp` de verdade. Single-agent idêntico (um Processo). Verificar auth por subscription (IV-2).
  Aceite: só sobem Agentes referenciados; shutdown de todos no finally; dry-run do exemplo resolve.
  Deps: T-003, T-004
  Files: src/index.ts, src/acp/pool.ts

- [ ] T-007: Métricas — custo por-Task sob multi-Sessão
  `TaskMetrics.cost` = soma dos `readCost()` finais de **cada** Sessão da Task (itera
  `Map<agentName, session>`), best-effort (`n/d` tolerado). Uso por-turno somado por Step inalterado.
  Custo nunca por-Step; forma de `.loopy/metrics.json` inalterada. Single-agente idêntico.
  Aceite: 2 Sessões ⇒ custo somado; 1 Sessão ⇒ idêntico; Agente sem custo ⇒ soma o que houver.
  Deps: T-004
  Files: src/loop/orchestrator.ts, src/metrics/folds.ts

- [ ] T-008: TUI — prefixa Stream/Logs ACP por Agente quando >1
  Eventos `stream_chunk`/`acp_traffic` carregam o Agente (do map sessionId→{taskId,agent}); a view
  prefixa `[<agent>]` **só** quando >1 Agente ativo. Single-agent = byte-idêntico (sem prefixo).
  Aceite: >1 Agente ⇒ prefixo; 1 Agente ⇒ idêntico.
  Deps: T-006
  Files: src/tui/store.ts, src/tui/view.ts, src/index.ts

- [ ] T-009: Exemplo canônico multi-agente + ADR-0006 + CONTEXT.md + docstrings
  `examples/loopy.yml` multi-agente (Claude default implementa + Codex simplifica `effort: low` +
  Claude audita `mode: plan`; `acp.default_agent: claude`). Teste de aceite: `--dry-run` imprime
  Agente/model/effort por Step, sem escrever nada. ADR-0006 (via skill de ADR). CONTEXT.md promove
  Agente/Processo de Agente/Sessão + Registry/Model/Effort. CLAUDE.md filhos (config/acp/loop/steps/
  metrics/tui) e docstrings dos módulos tocados atualizados. `typecheck`/`lint`/`test` verdes (SC#10).
  Aceite: exemplo carrega + dry-run resolve; docs atualizadas; suíte inteira verde.
  Deps: T-004, T-005
  Files: examples/loopy.yml, CONTEXT.md, docs/adrs/0006-multi-agente-acp.md
