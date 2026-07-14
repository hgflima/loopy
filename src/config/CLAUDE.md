# Config — validação do `loopy.yml`

## Purpose & Scope
Valida e carrega o `loopy.yml` num `LoopyConfig` tipado, com defaults aplicados. É a **fronteira de confiança da *forma*** do config (AD-1: valida a forma que o motor interpreta, não decide comportamento). **Não é a fronteira de tudo**: referências que o schema não consegue cruzar — lista de checks nomeada, ids de deps do `todo.md` — só falham a jusante (runtime dos steps, scheduler).

## Entry Points & Contracts
- `loadConfig(path)` (`load.ts`) → wrapper de I/O; `parseConfig(source, { sourcePath })` é o **entry point puro** (sem disco), que os testes usam. Erro vira `ConfigError` (mensagem clara, sem stack). Chamado **primeiro** no `execute()`, antes de qualquer efeito.
- `scanRemovedKeys` — **pre-scan antes do zod** (`load.ts`): detecta chaves removidas (`on_expect_fail`, `on_conflict`, `verify.on_fail` — ADR-0001), coleta **todas** as ocorrências e lança um erro guiado ("use 'on_fail'"). **Invariante**: quem remover/renomear campo de step adiciona aqui, senão o usuário só recebe o "unknown key" cru do `.strict()`.
- `ResolvedAgents { byName, default }` (produzido por `loadConfig`): normalização do Registry de Agentes (ADR-0006). `agentDefSchema` = `{ command, env?, model?, effort?, display_name? }`.
- `warnings.ts` — **fora do zod**, puro: `collectPipelineWarnings(pipeline, resolvedAgents)` + `formatWarnings` (chamados pela CLI **depois** do parse, impressos em stderr) e **`referencedAgents`**, que é *load-bearing*: é a função que decide **quais Processos ACP são spawnados** (`../index.ts`). Os 4 warnings: ciclos, `always` + goto, `parallel_safe` cujo argv aparenta mutar o parent, dead profile.
- `env.ts` — `resolveAgentEnv(agents, processEnv)`: resolve `${env.KEY}` dos Agentes num passe dedicado. **`${env.KEY}` ausente em `process.env` é `ConfigError` fail-fast**; Agente sem `env` produz record vazio (auth por subscription).
- `loopyConfigSchema` (`schema.ts`) → contraparte runtime do contrato congelado em `../types.ts`. `pipeline` é um `z.discriminatedUnion("type", …)` dos 4 primitivos — cada `type` só aceita seus próprios campos.

## Usage Patterns
- Todo objeto usa `.strict()`: **chave desconhecida é rejeitada**. Ao adicionar um campo novo, atualize o schema *e* o tipo em `../types.ts` juntos.
- Defaults de *forma* ficam aqui (`clear_context` → `true`, `concurrency` → `1`, `on_request` → `"allow"`, `max_step_visits` → `10`), nunca defaults comportamentais.
- **Registry de Agentes (ADR-0006):** `agents:` (top-level opcional) e `acp.command` (legado) não coexistem; todo `step.agent` existe no Registry; `default_agent` (se dado) existe; ≥1 Agente resolvível; **>1 Agente sem `default_agent` ⇒ `agent:` obrigatório em todo Step de agente**. `agent`/`model`/`effort` são estáticos (não interpolados — mirror de `mode`/`type`/`id`).

## Anti-patterns
- Não afrouxar `.strict()` para "aceitar" configs — isso mascara typos.
- Não colocar default que altere o *que o loop faz* (só forma/estrutura). Comportamento vem do yml (AD-1).
- Não duplicar a definição da forma: `types.ts` é o contrato, o schema é o validador.
- Não assumir que "passou no schema ⇒ vai rodar": ver Pitfalls (checks nomeados, deps, campos inertes).

## Dependencies & Edges
- Contrato de tipos: `../types.ts`. Consumido por `../index.ts` (`execute`) e por todo o motor via `LoopyConfig`.
- A jusante: `../scheduler/` (deps viram DAG), `../steps/` (referências de checks), `../acp/` (Registry → Processos).
- Exemplo canônico validado: `examples/loopy.yml` (multi-agente: Claude default + Codex simplifica).

## Patterns & Pitfalls
- **O que o schema NÃO pega** (e por isso não confie nele como fronteira única): (a) `checks` / `agent.verify.run` apontando uma **lista de checks inexistente** só explode em runtime, dentro do step; (b) **ciclo ou dep órfã** no `todo.md` é erro do **scheduler**, não do config; (c) `acp.permissions.default_mode` e `acp.request_timeout_seconds` são **required no schema e não têm nenhum leitor** — são inertes hoje (não presuma que timeout/modo default funcionam).
- **`inputs.backlog.deps_pattern` não tem default aqui** — é `optional()` no schema; o default `Deps:` (case-insensitive) mora a jusante, em `../backlog/todo.ts`. Ou seja: `config.inputs.backlog.deps_pattern` **pode ser `undefined`**.
- **`concurrency` do yml não é a palavra final**: o efetivo é `flags.concurrency ?? config.concurrency`, e `--task` força 1.
- `onFailSchema = z.union([z.literal("escalate"), gotoSchema])` (ADR-0002); `on_success: { goto }` mora em `stepBaseShape`. O `superRefine` do pipeline faz **só três coisas**: `id` único, alvo de goto existente, guard do agente (`on_fail` em `agent` exige `verify` ou `expect`). **Warnings não estão no zod** — estão em `warnings.ts`.
- `resolveAgents` escolhe o default por **ordem de inserção** do YAML quando há `agents:` sem `acp.default_agent` (só alcançável com Registry de 1 agente, mas é dependência silenciosa da ordem das chaves).
- `permissions.on_request: "policy"` é aceito pelo schema mas trata como `allow` no runtime (deny-patterns não implementados — ver `../acp/`).
- Bloco **`metrics`** (opt-in, ADR-0003): gate **por presença, não valor** — `metrics` presente (mesmo `{}`) liga coleta + `.loopy/metrics.json` + Relatório de execução; `metrics.report.index` presente adiciona o Relatório de change. Ausente = feature off. `report.index` é template `${...}`, não validado como path real.
- **Campos do DAG/concorrência (ADR-0004):** `Step.parallel_safe?` (default `false` — opt-out da Seção crítica do parent; warning estático se o argv aparentar mutar o parent) e `policies.git.on_merge_conflict: 'escalate' | 'rebase'` (default `escalate`).
