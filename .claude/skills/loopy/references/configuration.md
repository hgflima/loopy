# Schema do `loopy.yml` (destilado)

Destilado de `docs/reference/configuration.md` do repo do motor
(`acp-agentic-loop`). A verdade final é o schema zod do motor — por isso todo
yml gerado termina num `--dry-run`, que valida contra a versão que vai rodar.
Todo objeto é `.strict()`: **chave desconhecida é rejeitada**.

## Topo

```yaml
version: "1"
name: <nome-da-run>            # identifica a Run em logs
workspace:
  root: "."
  parent_branch: "main"        # destino dos merges; precisa estar limpo
  worktrees_dir: ".worktrees"
agents: { … }                  # Registry (ver abaixo); exclusivo com acp.command
acp: { … }
inputs: { … }
checks: { … }
pipeline: [ … ]                # mín. 1 step
stop_conditions: { … }
concurrency: auto              # 1 (default) | n ≥ 1 | "auto"
max_concurrency: 3             # teto do auto (default 4); NÃO limita n explícito
policies: { … }
logging: { … }
metrics: {}                    # presença liga a telemetria (.db/telemetry.db)
```

## `agents` — Registry

Um Processo ACP por agente referenciado (eager). `preset` empresta o argv do
Catálogo do motor — o yml não guarda `npx -y …`:

```yaml
agents:
  claude:
    preset: claude        # npx -y @agentclientprotocol/claude-agent-acp@0.59.0
  codex:
    preset: codex         # npx -y @agentclientprotocol/codex-acp (auth: codex login)
    effort: low           # dialeto literal — valide via probe-agent
  opencode:
    preset: opencode      # opencode acp (subcomando do binário, não é npm)
```

- `preset` × `command: string[]` são mutuamente exclusivos; um dos dois é
  obrigatório. `command` é a saída para adapters fora do Catálogo.
- `env:` opcional (`${env.KEY}` resolve de `process.env`; ausência é erro
  fail-fast). Omitir = auth por subscription/login.
- `model`/`effort` opcionais, **dialeto literal** do agente (nunca traduzido).

## `acp`

```yaml
acp:
  default_agent: claude          # steps sem `agent:` usam este
  request_timeout_seconds: 1800
  permissions:
    default_mode: acceptEdits    # modo ACP inicial das sessões
    on_request: allow
```

Registry com >1 agente e sem `default_agent` → todo step de agente **deve**
declarar `agent:` (o schema rejeita omissão).

## `inputs`

```yaml
inputs:
  spec: ".harn/devy/changes/C-00NN-slug/spec.md"
  plan: ".harn/devy/changes/C-00NN-slug/plan.md"
  todo: ".harn/devy/changes/C-00NN-slug/todo.md"
  backlog:
    pending_marker: "- [ ]"      # coluna 0
    done_marker: "- [x]"
    task_id_pattern: "T-\\d+"    # derive do todo.md real (ex.: T\d+\.\d+)
    body: indented               # único valor aceito
    mark_done_on_success: true
    deps_pattern: "Deps:"        # opcional; linha de deps DEVE ser isolada
```

## `checks`

Mapa nome → lista; referenciável por step `checks` ou por `verify.run`:

```yaml
checks:
  ci:
    - { name: typecheck, run: "npm run typecheck" }
    - { name: test, run: "npm test" }
```

`run` é **argv sem shell** — sem `&&`, pipes, redirects ou `test -f`; composição
vai num script npm do alvo.

## `pipeline` — steps

Campos comuns: `id` (único; alvo de `goto`), `type`, `always: false` (roda
mesmo após falha — ex.: cleanup), `on_success: { goto: id }`,
`parallel_safe: false` (true = opt-out do mutex do parent).

### `type: agent`

| Campo | Nota |
| --- | --- |
| `agent` | Nome no Registry; omissível só com default resolvível. |
| `prompt` / `retry_prompt` | Templates interpoláveis; `retry_prompt` vale da 2ª Tentativa em diante. |
| `mode` / `model` / `effort` | Dialeto literal do agente (probe-agent). |
| `clear_context` | Default `true` — limpa a Sessão antes do turno. |
| `verify: { run: <checks>, max_attempts: n }` | Loop interno: checks a cada Tentativa. |
| `expect: "TEXTO"` | Gate de veredito: o Verdict do turno deve conter o texto. |
| `on_fail` | `escalate` \| `{ goto: id }`. **Exige `verify` ou `expect`.** |

### `type: shell`

`run: string[]` (argv sem shell, interpolável). `on_fail` opcional.

### `type: checks`

`run: <nome-da-lista>`. `on_fail` opcional.

### `type: approval`

Gate humano: `prompt` + `run: string[]` opcional executado **após** aprovação
(tipicamente o merge). `on_fail` opcional.

### Validações que o schema aplica

`id` duplicado; `goto` para id inexistente; step `agent` com `on_fail` sem
`verify`/`expect`. Ciclos de `goto` são permitidos (fix-loop) mas limitados
por `max_step_visits` (default 10, fail-closed → escalate).

## `stop_conditions`

```yaml
stop_conditions:
  max_iterations: 25        # teto de Tasks iniciadas
  max_step_visits: 10
  stop_signal_file: ".loopy.stop"
```

## `concurrency`

`"auto"` = `min(maxLayerWidth(DAG), max_concurrency)` — a largura vem das
arestas `Deps:` do `todo.md`. Sem `Deps:`, o DAG é plano e `auto` vira
`max_concurrency` — por isso a análise de colisão de arquivos importa antes de
liberar paralelismo.

## `policies`

```yaml
policies:
  escalation:
    action: pause            # pause | skip_task | abort_loop
    keep_worktree: true
    notify: stderr
  git:
    require_clean_parent: true
    on_merge_conflict: escalate   # escalate (default) | rebase
```

`rebase` só resolve conflito de replay; duas tasks paralelas editando o mesmo
trecho produzem conflito idêntico de novo → pause. Serialize com `Deps:`.

## `logging` e `metrics`

```yaml
logging:
  dir: ".loopy/logs"
  per_task: true
  capture_acp_traffic: true

metrics: {}   # gate por PRESENÇA: ausente = off; {} = telemetria SQLite ligada
```

`metrics.report` é **obsoleto** (aceito com warning, ignorado) — não gere.

## Interpolação (`${…}`)

Vars conhecidas: `task.*` (`id`, `title`, `body`, `branch`, `deps`),
`worktree.*` (`path`, `diff`), `iteration`, `attempt`, `checks.report`,
`inputs.*`, `workspace.*`, `change.*`. Var desconhecida aborta fail-fast.
Nunca passe dado interpolado para um shell — steps rodam argv sem shell
justamente para o dado nunca ser reexpandido.
