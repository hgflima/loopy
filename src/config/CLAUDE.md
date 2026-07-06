# Config — validação do `loopy.yml`

## Purpose & Scope
Valida e carrega o `loopy.yml` num `LoopyConfig` tipado, com defaults aplicados. É a **fronteira de confiança** do motor: nada a jusante revalida a config. NÃO decide comportamento de loop — só valida a *forma* que o motor interpreta (AD-1).

## Entry Points & Contracts
- `loadConfig(path)` (`load.ts`) → lê o YAML, valida com zod, lança `ConfigError` (mensagem clara, sem stack) em erro. Chamado **primeiro** no `execute()`, antes de qualquer efeito, então config inválida aborta limpa. Produz `ResolvedAgents { byName, default }` anexado ao `LoopyConfig` — a normalização uniforme do Registry de Agentes (ADR-0006).
- `loopyConfigSchema` (`schema.ts`) → contraparte runtime do contrato congelado em `../types.ts` (`LoopyConfig`). `LoopyConfigParsed` (inferido) deve ser estruturalmente compatível com `LoopyConfig`.
- `pipeline` é um `z.discriminatedUnion("type", …)` dos 4 primitivos (`agent`/`shell`/`checks`/`approval`) — cada `type` só aceita seus próprios campos.

## Usage Patterns
- Todo objeto usa `.strict()`: **chave desconhecida é rejeitada** (typo de config vira erro, não é ignorado em silêncio). Ao adicionar um campo novo, atualize o schema *e* o tipo em `../types.ts` juntos.
- Defaults documentados ficam aqui (`clear_context` → `true`, `concurrency` → `1`, `on_request` → `"allow"`), nunca como política comportamental.
- **Registry de Agentes (ADR-0006):** `agentDefSchema`/`agentsSchema` (top-level opcional); `acp.command` vira opcional + `acp.default_agent?`; `agentStepSchema` += `agent?`/`model?`/`effort?` (open-ended). `superRefine`: `agents:` e `acp.command` não coexistem; todo `step.agent` existe no Registry; `default_agent` (se dado) existe; ≥1 Agente resolvível; >1 Agente sem `default_agent` ⇒ `agent:` obrigatório em todo Step de agente. Warning não-bloqueante de dead profile.

## Anti-patterns
- Não afrouxar `.strict()` para "aceitar" configs — isso mascara typos.
- Não colocar default que altere o *que o loop faz* (só forma/estrutura). Comportamento vem do yml (AD-1).
- Não duplicar a definição da forma: `types.ts` é o contrato, o schema é o validador — mantê-los em sincronia, não divergir.

## Dependencies & Edges
- Contrato de tipos: `../types.ts`.
- Consumido por `../index.ts` (`execute`) e por todo o motor via `LoopyConfig`.
- Exemplo canônico validado: `examples/loopy.yml` (multi-agente: Claude default + Codex simplifica).

## Patterns & Pitfalls
- `onFailSchema = z.union([z.literal("escalate"), gotoSchema])`: `on_fail` aceita `"escalate"` ou `{ goto: <step-id> }` (ADR-0002). `on_success: { goto }` mora em `stepBaseShape`. `max_step_visits` (default 10) em `stop_conditions`. `superRefine` valida: `id` único, alvo de goto existe, guard do agente generalizado (`on_fail` em `agent` exige `verify` ou `expect`). Warnings não-bloqueantes para ciclos e `on_success`/`on_fail` em step `always`.
- `permissions.on_request: "policy"` é aceito pelo schema mas trata como `allow` no runtime (deny-patterns ainda não implementados — ver `../acp/`).
- Bloco **`metrics`** (opt-in, C-0005): `metrics?: { report?: { index } }`, ambos `.strict()`. Gate **por presença, não valor**: `metrics` presente (mesmo `{}`) liga coleta + `.loopy/metrics.json` + Relatório de execução; `metrics.report.index` presente adiciona o Relatório de change. Ausente = feature off (regressão zero). Espelha `MetricsConfig`/`MetricsReportConfig` em `../types.ts` (extensão aditiva — ADR-0003). `report.index` é template `${...}`, não validado como path real aqui.
- **Campos aditivos do DAG/concorrência (C-0006, ADR-0004):** `inputs.backlog.deps_pattern` (default `Deps:`, case-insensitive — pattern da linha de dependência no todo.md); `Step.parallel_safe?` (default `false` — opt-out da Seção crítica do parent; Warning estático se argv aparentar mutar o parent); `policies.git.on_merge_conflict: 'escalate' | 'rebase'` (default `escalate`). `concurrency` (`min(1).default(1)`) já existia no schema — passa a ser **lido** em runtime (ADR-0004). `RunLoopResult` ganha `paused`/`skipped` (tipo apenas).
- **Normalização multi-agente (ADR-0006):** `loadConfig` normaliza para `ResolvedAgents { byName, default }`: legado `acp.command` sintetiza `{ default: { command } }`; `agents:` valida e mapeia direto. `agents.*.env` é resolvido num passe `env.*` dedicado no build do pool — **nunca** em `buildScopeVars` (segredo confinado). `agent`/`model`/`effort` são estáticos (não interpolados — mirror do `mode`/`type`/`id`).
