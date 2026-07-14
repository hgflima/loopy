# Referência de configuração (`loopy.yml`)

Todo bloco, chave, tipo e default do `loopy.yml`. Derivado de
`src/config/schema.ts` (o schema zod, contraparte runtime do contrato congelado
em `src/types.ts`).

O motor valida a config **primeiro**, antes de qualquer efeito: config inválida
aborta limpa com uma `ConfigError` (mensagem clara, sem stack). Todo objeto usa
`.strict()` — **chave desconhecida é rejeitada**. O motor valida só a *forma* que
interpreta; nenhum default aqui altera *o que* o loop faz (AD-1).

## Chaves de nível superior

| Chave | Tipo | Descrição |
|-------|------|-----------|
| `version` | `string` | Versão do formato do config. |
| `name` | `string` | Nome do config (identifica a Run em logs/relatórios). |
| `workspace` | objeto | Raiz, parent branch e diretório de worktrees. Ver [`workspace`](#workspace). |
| `acp` | objeto | Como iniciar e falar com o Agente ACP. Ver [`acp`](#acp). |
| `agents` | objeto | **Opcional.** Registry de agentes nomeados. Mutuamente exclusivo com `acp.command`. Ver [`agents`](#agents). |
| `inputs` | objeto | Paths dos inputs e formato do backlog. Ver [`inputs`](#inputs). |
| `checks` | objeto | Listas de checks nomeadas e reutilizáveis. Ver [`checks`](#checks). |
| `pipeline` | lista | Steps ordenados aplicados a cada task. Ver [`pipeline`](#pipeline). |
| `stop_conditions` | objeto | Tetos e sinal de parada. Ver [`stop_conditions`](#stop_conditions). |
| `concurrency` | `number \| "auto"` | Tamanho do pool de tasks paralelas. Inteiro ≥ 1 ou `"auto"`. **Default `1`**. Ver [concurrency](#concurrency). |
| `max_concurrency` | `number` | Teto do pool quando `concurrency: auto`. Inteiro ≥ 1. **Default `4`**. Só morde o `auto` — valor numérico explícito de `concurrency` não é limitado por este teto. |
| `policies` | objeto | Escalonamento e política de git. Ver [`policies`](#policies). |
| `logging` | objeto | Destino e granularidade dos logs. Ver [`logging`](#logging). |
| `metrics` | objeto | Instrumentação opt-in. **Opcional**. Ver [`metrics`](#metrics). |

---

## `workspace`

| Chave | Tipo | Descrição |
|-------|------|-----------|
| `root` | `string` | Raiz do repositório-alvo. |
| `parent_branch` | `string` | Branch de destino dos merges; limpa entre tasks. |
| `worktrees_dir` | `string` | Diretório onde os worktrees isolados são criados (ex.: `.worktrees`). |

## `acp`

| Chave | Tipo | Descrição |
|-------|------|-----------|
| `command` | `string[]` | Argv para iniciar o processo do Agente (mín. 1 elemento). |
| `request_timeout_seconds` | `number` | Timeout por requisição ACP (> 0). |
| `permissions` | objeto | Ver abaixo. |

### `acp.permissions`

| Chave | Tipo | Default | Descrição |
|-------|------|---------|-----------|
| `default_mode` | `string` | — | Modo (autonomia) ACP inicial das sessões (`acceptEdits`, `plan`, …). |
| `on_request` | `"allow" \| "policy"` | `"allow"` | Como responder pedidos de permissão. `"policy"` é aceito pelo schema mas **tratado como `allow` no runtime** (deny-patterns ainda não implementados). |

## `agents`

Registry de **agentes nomeados** (ADR-0006). Cada chave é o nome do agente; o
valor define como iniciá-lo. O motor spawna **um Processo ACP por agente
referenciado** no pipeline (eager, na abertura da Run).

```yaml
agents:
  claude:
    command: ["npx", "-y", "@agentclientprotocol/claude-agent-acp"]
  codex:
    command: ["npx", "-y", "@agentclientprotocol/codex-acp"]
    effort: low
  opencode:
    command: ["opencode", "acp"]   # subcomando do binário, não pacote npm
```

> **`agents` e `acp.command` são mutuamente exclusivos.** Use `agents:` quando
> precisar de mais de um agente (ou quiser nomeá-lo); use `acp.command` no modo
> legado (agente único, sem Registry). O schema rejeita a presença simultânea.

| Chave (por agente) | Tipo | Descrição |
|--------------------|------|-----------|
| `command` | `string[]` | **Obrigatório.** Argv para iniciar o Processo ACP do agente (mín. 1 elemento). Para adaptadores npm use `["npx", "-y", "<pacote>"]`; para subcomandos nativos use o binário diretamente (ex.: `["opencode", "acp"]`). |
| `env` | `Record<string, string>` | **Opcional.** Variáveis de ambiente passadas ao processo. Suporta `${env.KEY}` (resolvido de `process.env`; ausência é `ConfigError` fail-fast). Omitir = auth por subscription/login do agente. |
| `model` | `string` | **Opcional.** Modelo default para steps que usem este agente. Valor é o **dialeto literal** do agente (ex.: `"provider/model"` para opencode, `"claude-sonnet-4-5-20250514"` para claude). |
| `effort` | `string` | **Opcional.** Reasoning effort default (ex.: `"low"`, `"high"`, `"max"`). Valor é o dialeto literal — nem todo agente suporta; se não suportar, é no-op com log. |
| `display_name` | `string` | **Opcional.** Nome de exibição na TUI/GUI. Se omitido, usa a chave do Registry. |

### Dialeto literal e `loopy probe-agent`

Os valores de `mode`, `model` e `effort` são passados **tal qual** ao agente —
o motor **não traduz** entre dialetos. Cada agente expõe vocabulário próprio:

| Agente | `mode` (exemplos) | `effort` | Descoberta |
|--------|--------------------|----------|------------|
| claude-acp | `acceptEdits`, `plan` | `low` … `max` (≥ v0.59) | `loopy probe-agent claude` |
| codex-acp | `read-only`, `agent`, `agent-full-access` | `low` … `high` | `loopy probe-agent codex` |
| opencode | `build`, `plan` | — (não suporta) | `loopy probe-agent opencode` |

Use `loopy probe-agent <nome> [--json]` para descobrir os modos, modelos e
níveis de effort que um agente aceita. O resultado vem de `configOptions` da
sessão ACP — é a fonte canônica. Ver [CLI — `probe-agent`](cli.md#probe-agent).

### Resolução do agente em steps

- **`acp.default_agent`**: se definido, steps sem `agent:` explícito usam esse agente.
- **Registry com 1 agente**: se há apenas um agente e `default_agent` não foi definido, ele é o default implícito.
- **Registry com >1 agente sem `default_agent`**: todo step de agente **deve** declarar `agent:` — o schema rejeita omissão.

## `inputs`

| Chave | Tipo | Descrição |
|-------|------|-----------|
| `spec` | `string` | Path do documento de spec (`${inputs.spec}`). |
| `plan` | `string` | Path do documento de plan (`${inputs.plan}`). |
| `todo` | `string` | Path do backlog (`${inputs.todo}`). |
| `backlog` | objeto | Formato do backlog. Ver abaixo. |

### `inputs.backlog`

| Chave | Tipo | Descrição |
|-------|------|-----------|
| `pending_marker` | `string` | Prefixo (coluna 0) de uma task pendente (ex.: `- [ ]`). |
| `done_marker` | `string` | Prefixo de uma task concluída (ex.: `- [x]`). |
| `task_id_pattern` | `string` | Regex-source do id da task (ex.: `T-\d+`). |
| `deps_pattern` | `string` | **Opcional.** Prefixo da linha de dependências no corpo da task (default `Deps:`, case-insensitive). |
| `body` | `"indented"` | Modo de extração do corpo. Único valor aceito: `indented`. |
| `mark_done_on_success` | `boolean` | Se marca a task como done ao concluir o pipeline. |

Ver [Backlog (`todo.md`)](backlog.md) para a semântica completa do parsing.

## `checks`

Mapa de **nome → lista de checks**. Cada nome (ex.: `ci`) é referenciável por um
Step `checks` ou por `verify.run` de um Step `agent`.

```
checks:
  <nome>:
    - { name: <string>, run: <string> }
    - ...
```

| Chave (por check) | Tipo | Descrição |
|-------------------|------|-----------|
| `name` | `string` | Rótulo do check no Report. |
| `run` | `string` | Comando a executar. |

## `pipeline`

Lista ordenada (mín. 1) de **Steps**, como uma união discriminada por `type`
(AD-1): cada `type` só aceita seus próprios campos. A ordem declarada é o default;
`on_success`/`on_fail` com `goto` a sobrepõem, tornando o pipeline um grafo
dirigido navegado por um Program counter.

### Campos comuns a todo Step

| Chave | Tipo | Default | Descrição |
|-------|------|---------|-----------|
| `id` | `string` | — | Identificador único no pipeline (alvo de `goto`). |
| `type` | `"agent" \| "shell" \| "checks" \| "approval"` | — | Discriminante do Step. |
| `always` | `boolean` | `false` | Roda mesmo após um Step anterior falhar (ex.: `cleanup`). |
| `on_success` | `{ goto: <step-id> }` | — | Salta para o alvo em sucesso, em vez de seguir sequencial. |
| `parallel_safe` | `boolean` | `false` | Opt-out da Seção crítica do parent (Step pode rodar fora do mutex). |

### `type: agent`

Turno de conversa com o Agente. Campos próprios:

| Chave | Tipo | Default | Descrição |
|-------|------|---------|-----------|
| `agent` | `string` | — | **Opcional.** Nome do agente no Registry (`agents:`). Omitir usa o `acp.default_agent` (ou o único agente quando o Registry tem um só). |
| `prompt` | `string` | — | Template do prompt inicial (interpolável). |
| `retry_prompt` | `string` | — | **Opcional.** Template usado a partir da 2ª tentativa; sem ele, reusa `prompt`. |
| `mode` | `string` | — | **Opcional.** Sobrescreve o modo ACP da Sessão neste Step. Valor é o **dialeto literal** do agente (ex.: `acceptEdits` para claude, `build` para opencode). |
| `model` | `string` | — | **Opcional.** Modelo para este Step. Dialeto literal do agente (ex.: `provider/model`). |
| `effort` | `string` | — | **Opcional.** Reasoning effort para este Step. Dialeto literal (ex.: `low`, `high`). |
| `clear_context` | `boolean` | `true` | Limpa o contexto da Sessão antes do turno. |
| `verify` | objeto | — | **Opcional.** Loop interno de checks. Ver abaixo. |
| `expect` | `string` | — | **Opcional.** Condição textual esperada no Verdict (ex.: `AUDIT: PASS`). |
| `on_fail` | `"escalate" \| { goto: <step-id> }` | — | **Opcional.** Ação em falha. **Exige `verify` ou `expect`** (sem um deles não há modo de falha a governar). |

#### `agent.verify`

| Chave | Tipo | Descrição |
|-------|------|-----------|
| `run` | `string` | Nome da lista de checks (chave de `checks`) rodada a cada tentativa. |
| `max_attempts` | `number` | Teto do loop interno (inteiro ≥ 1). |

### `type: shell`

Executa comandos (argv, sem shell). Campos próprios:

| Chave | Tipo | Descrição |
|-------|------|-----------|
| `run` | `string[]` | Lista não-vazia de comandos. |
| `on_fail` | `"escalate" \| { goto: <step-id> }` | **Opcional.** Ação em falha. |

### `type: checks`

Roda uma lista de checks nomeada. Campos próprios:

| Chave | Tipo | Descrição |
|-------|------|-----------|
| `run` | `string` | Nome da lista de checks (chave de `checks`). |
| `on_fail` | `"escalate" \| { goto: <step-id> }` | **Opcional.** Ação em falha. |

### `type: approval`

Gate de Aprovação humano, opcionalmente seguido de comandos. Campos próprios:

| Chave | Tipo | Descrição |
|-------|------|-----------|
| `prompt` | `string` | Texto mostrado ao humano no Gate. |
| `run` | `string[]` | **Opcional.** Comandos a executar após a aprovação (ex.: o merge). |
| `on_fail` | `"escalate" \| { goto: <step-id> }` | **Opcional.** Ação em falha. |

### Ações de fluxo

| Chave | Forma | Semântica |
|-------|-------|-----------|
| `on_fail: escalate` | literal | Dispara o Escalonamento (`policies.escalation.action`). Default implícito de um Step que falha. |
| `on_fail: { goto: <id> }` | Desvio | Salta para o Step alvo em vez de escalar (fix-loop). |
| `on_success: { goto: <id> }` | Desvio | Salta para o Step alvo em sucesso; omitir = sequencial. |

### Validações de pipeline (`superRefine`)

O schema rejeita, com erro claro:

1. **`id` duplicado** no pipeline.
2. **`goto`** (em `on_success` ou `on_fail`) que referencia um `id` inexistente.
3. **Step `agent` com `on_fail` mas sem `verify` nem `expect`.**

Warnings **não-bloqueantes** são emitidos para ciclos de `goto` e para
`on_success`/`on_fail` num Step marcado `always`.

## `stop_conditions`

| Chave | Tipo | Default | Descrição |
|-------|------|---------|-----------|
| `max_iterations` | `number` | — | Teto de Tasks iniciadas no loop externo (inteiro > 0). |
| `max_step_visits` | `number` | `10` | Teto de Visitas a um mesmo Step (fail-closed → escalate ao exceder). |
| `stop_signal_file` | `string` | — | Path do Stop signal; sua presença encerra a Run após a Task corrente. |

## `concurrency`

Controla quantas tasks rodam em paralelo.

| Valor | Comportamento |
|-------|---------------|
| `1` (default) | Sequencial — uma task por vez. |
| `<n>` (inteiro ≥ 1) | Pool fixo de `n` tasks simultâneas. |
| `"auto"` | O motor calcula `min(maxLayerWidth(DAG), max_concurrency)`. `maxLayerWidth` é a largura da maior camada topológica do DAG de tasks (derivado das dependências `Deps:` do `todo.md`). |

`max_concurrency` (default `4`) limita **apenas** o `auto` — um `concurrency`
numérico explícito não é afetado. Use `auto` quando o backlog tiver dependências
declaradas e o paralelismo ideal depender da forma do DAG.

A flag `--concurrency <n|auto>` da CLI sobrescreve o valor do yml. `--task`
força `concurrency = 1` independente do config.

```yaml
concurrency: auto
max_concurrency: 4   # teto do auto; default 4
```

## `policies`

### `policies.escalation`

| Chave | Tipo | Descrição |
|-------|------|-----------|
| `action` | `"pause" \| "skip_task" \| "abort_loop"` | O que fazer ao escalar. |
| `keep_worktree` | `boolean` | Preserva o worktree ao escalar (para inspeção). |
| `notify` | `string` | Canal/mensagem de notificação. |

### `policies.git`

| Chave | Tipo | Default | Descrição |
|-------|------|---------|-----------|
| `require_clean_parent` | `boolean` | — | Exige o parent limpo antes de operações de git. |
| `on_merge_conflict` | `"escalate" \| "rebase"` | `"escalate"` | Como reagir a conflito de merge. |

## `logging`

| Chave | Tipo | Descrição |
|-------|------|-----------|
| `dir` | `string` | Diretório dos logs. |
| `per_task` | `boolean` | Um arquivo de log por Task. |
| `capture_acp_traffic` | `boolean` | Registra o tráfego ACP bruto. |

## `metrics`

**Opcional.** Instrumentação opt-in (ADR-0003). O gate é **por presença, não por
valor**:

- Ausente → feature off (regressão zero, comportamento byte-idêntico).
- Presente (mesmo `{}`) → liga coleta, persiste `.loopy/metrics.json` e emite o
  Relatório de execução (stderr por Run).
- `metrics.report.index` presente → adiciona o Relatório de change no path dado.

| Chave | Tipo | Descrição |
|-------|------|-----------|
| `report` | objeto | **Opcional.** Ver abaixo. |

### `metrics.report`

| Chave | Tipo | Descrição |
|-------|------|-----------|
| `index` | `string` | Path (template `${…}`) do `index.md` do Relatório de change. Persistido só ao zerar o backlog. |

## Ver também

- [Interpolação (`${…}`)](interpolation.md) — variáveis usáveis em `prompt`,
  `run`, `notify`, `report.index`.
- [CLI](cli.md) — flags que sobrescrevem `max_iterations` e `concurrency`;
  subcomando `probe-agent` para descobrir dialetos.
- `examples/loopy.yml` — o exemplo canônico validado pelos testes de aceite.
