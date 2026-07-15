# Config — validação do `loopy.yml`

## Purpose & Scope
Valida e carrega o `loopy.yml` num `LoopyConfig` tipado, com defaults aplicados. É a **fronteira de confiança da *forma*** do config (AD-1: valida a forma que o motor interpreta, não decide comportamento). **Não é a fronteira de tudo**: referências que o schema não consegue cruzar — lista de checks nomeada, ids de deps do `todo.md` — só falham a jusante (runtime dos steps, scheduler).

## Entry Points & Contracts
- **Puro × I/O é a divisão que estrutura o módulo.** `load.ts` é o **único** arquivo com `node:fs` (39 linhas: lê o arquivo e delega). Todo o resto — `parse.ts`, `schema.ts`, `serialize.ts` — é puro e roda no browser: é o que sustenta o barrel `index.ts`, publicado como **`@hgflima/loopy/config`** e consumido pelo editor de config da GUI. **Nunca importe `node:fs` fora de `load.ts`** — quebra o build Vite do `apps/menubar`. (`warnings.ts` e `env.ts` ficam fora do barrel.)
- `loadConfig(path)` (`load.ts`) → wrapper de I/O; `parseConfig(source, { sourcePath })` (`parse.ts`) é o **entry point puro**. Erro vira `ConfigError` (mensagem clara, sem stack). Chamado **primeiro** no `execute()`, antes de qualquer efeito.
- `scanRemovedKeys` — **pre-scan antes do zod** (`parse.ts`): detecta chaves removidas (`on_expect_fail`, `on_conflict`, `verify.on_fail` — ADR-0001), coleta **todas** as ocorrências e lança um erro guiado ("use 'on_fail'"). **Invariante**: quem remover/renomear campo de step adiciona aqui, senão o usuário só recebe o "unknown key" cru do `.strict()`.
- `ResolvedAgents { byName, default }` (produzido por `parseConfig`, via `resolveAgents` puro): normalização do Registry de Agentes (ADR-0006). `agentDefSchema` = `{ command, env?, model?, effort?, display_name? }`.
- `serialize.ts` — a **volta** do parse, para o editor visual (C-0014): `serializeConfig(config)` emite YAML em ordem canônica (`CANONICAL_KEYS`) e strippa `resolvedAgents`; `parseConfigSource(source)` é YAML **cru, sem zod**; `initialConfigTemplate` é o template de um `loopy.yml` novo. Ver Pitfalls — os três têm armadilha.
- `warnings.ts` — **fora do zod**, puro: `collectPipelineWarnings(pipeline, resolvedAgents)` + `formatWarnings` (chamados pela CLI **depois** do parse, impressos em stderr) e **`referencedAgents`**, que é *load-bearing*: é a função que decide **quais Processos ACP são spawnados** (`../index.ts`). Os 4 warnings: ciclos, `always` + goto, `parallel_safe` cujo argv aparenta mutar o parent, dead profile.
- `env.ts` — `resolveAgentEnv(agents, processEnv)`: resolve `${env.KEY}` dos Agentes num passe dedicado. **`${env.KEY}` ausente em `process.env` é `ConfigError` fail-fast**; Agente sem `env` produz record vazio (auth por subscription).
- `loopyConfigSchema` (`schema.ts`) → contraparte runtime do contrato congelado em `../types.ts`. `pipeline` é um `z.discriminatedUnion("type", …)` dos 4 primitivos — cada `type` só aceita seus próprios campos.

## Usage Patterns
- Todo objeto usa `.strict()`: **chave desconhecida é rejeitada**. Ao adicionar um campo novo, atualize o schema *e* o tipo em `../types.ts` juntos.
- Defaults de *forma* ficam aqui (`clear_context` → `true`, `concurrency` → `1`, `max_concurrency` → `4`, `on_request` → `"allow"`, `max_step_visits` → `10`), nunca defaults comportamentais.
- **`concurrency: number | "auto"`** (ADR-0009): o schema aceita inteiro ≥ 1 ou a literal `"auto"`. O parse **não resolve** `auto` (não conhece o DAG — as tasks vêm do `todo.md`, carregado depois); a resolução é pura em `../scheduler/graph.ts` (`resolveConcurrency`). **`max_concurrency`**: inteiro ≥ 1 (default **4**), teto que **só morde o `auto`** — `concurrency: 8` + `max_concurrency: 4` roda com 8.
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
- **`inputs.backlog.deps_pattern` não tem default aqui** — é `optional()` no schema; o default `Deps:` (case-insensitive) mora a jusante, em `../backlog/parse.ts` (`DEFAULT_DEPS_PATTERN`). Ou seja: `config.inputs.backlog.deps_pattern` **pode ser `undefined`**.
- **Armadilhas do `serialize.ts`** (todas com risco de drift silencioso):
  - `CANONICAL_KEYS` espelha à mão a ordem de declaração do `loopyConfigSchema`. Chave top-level nova no schema **precisa** entrar lá, senão cai num fallback defensivo e sai fora de ordem no yml gravado.
  - `parseConfigSource` é uma **segunda porta de entrada que não passa por `scanRemovedKeys` nem pelo `.strict()`** — um bypass legítimo (o editor precisa ler yml quebrado para mostrar erro), mas significa que "config só entra pela fronteira validada" **não é mais literalmente verdade**.
  - `initialConfigTemplate` **duplica defaults do schema** (`concurrency: 1`, `max_concurrency: 4`, `max_step_visits: 10`, `clear_context: true`, `on_request: "allow"`) e usa o caminho **legado `acp.command`**, não o Registry `agents:` — diverge do `loopy.yml` deste próprio repo. Mudar um default no schema não atualiza o template.
- **`concurrency` do yml não é a palavra final**: o efetivo vem de `resolveConcurrency({ flag, declared, maxConcurrency, graph })` — precedência `flag > declared`; `--task` força 1; `auto` resolve pela Largura do grafo limitada por `max_concurrency` (ADR-0009).
- `onFailSchema = z.union([z.literal("escalate"), gotoSchema])` (ADR-0002); `on_success: { goto }` mora em `stepBaseShape`. O `superRefine` do pipeline faz **só três coisas**: `id` único, alvo de goto existente, guard do agente (`on_fail` em `agent` exige `verify` ou `expect`). **Warnings não estão no zod** — estão em `warnings.ts`.
- `resolveAgents` escolhe o default por **ordem de inserção** do YAML quando há `agents:` sem `acp.default_agent` (só alcançável com Registry de 1 agente, mas é dependência silenciosa da ordem das chaves).
- `permissions.on_request: "policy"` é aceito pelo schema mas trata como `allow` no runtime (deny-patterns não implementados — ver `../acp/`).
- Bloco **`metrics`** (opt-in, ADR-0003 estendida pela ADR-0011): gate **por presença, não valor** — `metrics` presente (mesmo `{}`) liga a telemetria SQLite (`.db/telemetry.db`); ausente = feature off. `metrics.report` continua no schema (`optional()`) só por **retrocompat**: foi **aposentado na C-0017 (D21)**, o motor o ignora e `warnings.ts` emite deprecação (`collectDeprecationWarnings`). Não reimplementar o Relatório de execução/change.
- **Campos do DAG/concorrência (ADR-0004):** `Step.parallel_safe?` (default `false` — opt-out da Seção crítica do parent; warning estático se o argv aparentar mutar o parent) e `policies.git.on_merge_conflict: 'escalate' | 'rebase'` (default `escalate`).
