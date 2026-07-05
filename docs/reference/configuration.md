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
| `inputs` | objeto | Paths dos inputs e formato do backlog. Ver [`inputs`](#inputs). |
| `checks` | objeto | Listas de checks nomeadas e reutilizáveis. Ver [`checks`](#checks). |
| `pipeline` | lista | Steps ordenados aplicados a cada task. Ver [`pipeline`](#pipeline). |
| `stop_conditions` | objeto | Tetos e sinal de parada. Ver [`stop_conditions`](#stop_conditions). |
| `concurrency` | `number` | Tamanho do pool de tasks paralelas. Inteiro ≥ 1. **Default `1`**. |
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
| `prompt` | `string` | — | Template do prompt inicial (interpolável). |
| `retry_prompt` | `string` | — | **Opcional.** Template usado a partir da 2ª tentativa; sem ele, reusa `prompt`. |
| `mode` | `string` | — | **Opcional.** Sobrescreve o modo ACP da Sessão neste Step. |
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
- [CLI](cli.md) — flags que sobrescrevem `max_iterations` e `concurrency`.
- `examples/loopy.yml` — o exemplo canônico validado pelos testes de aceite.
