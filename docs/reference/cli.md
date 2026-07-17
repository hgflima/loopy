# Referência da CLI

O comando `loopy` e todas as suas flags. Derivado de `src/index.ts`
(`buildProgram`).

## Sinopse

```
loopy [dir] [opções]
loopy probe-agent <nome> [--json] [opções]
loopy verdict set --task <id> --pass|--fail [dir]
loopy verdict clear --task <id> [dir]
loopy bug add --task <id> --severity <nível> --title <t> [dir]
loopy change --abandoned|--failed [dir]
```

Motor de loop agêntico config-driven via ACP. Lê o `loopy.yml` do diretório-alvo
e, para cada task pendente do backlog, executa o `pipeline` declarado.

## Argumento

| Argumento | Default | Descrição                                                                                                              |
| --------- | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| `[dir]`   | `.`     | Diretório do projeto-alvo. Onde ficam o `loopy.yml`, os inputs e os artefatos de runtime (worktrees, `.loopy/`, logs). |

## Flags

| Flag                      | Valor                 | Default           | Descrição                                                                                                                                                                                                      |
| ------------------------- | --------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-c, --config <path>`     | caminho               | `<dir>/loopy.yml` | Caminho alternativo do `loopy.yml`.                                                                                                                                                                            |
| `--dry-run`               | —                     | `false`           | Planeja e imprime o pipeline resolvido para as tasks pendentes; **zero escrita, commit ou merge**.                                                                                                             |
| `-t, --task <id>`         | id da task            | —                 | Roda apenas a task com esse `id` (ex.: `T-004`); força `concurrency = 1`. Avisa (sem bloquear) sobre tasks pendentes anteriores no backlog.                                                                    |
| `--max-iterations <n>`    | inteiro > 0           | config            | Sobrescreve o teto do loop externo (`stop_conditions.max_iterations`).                                                                                                                                         |
| `-y, --yes`               | —                     | `false`           | Auto-aprova os Gates de Aprovação (uso não-interativo / CI).                                                                                                                                                   |
| `--clean [id]`            | id opcional           | —                 | Faz teardown (worktree + branch + checkpoint) e sai. Sem `id`, usa a task com checkpoint pausado/em-progresso.                                                                                                 |
| `--concurrency <n\|auto>` | inteiro > 0 ou `auto` | config            | Sobrescreve o pool de tasks paralelas (`concurrency`). `auto` calcula pelo DAG — ver [concurrency](configuration.md#concurrency).                                                                              |
| `--no-tui`                | —                     | TUI ligada        | Força logs de linha (sem Ink).                                                                                                                                                                                 |
| `--emit-events`           | —                     | `false`           | O stdout vira o canal NDJSON do Transport (motor→UI); todo texto de log vai para o stderr. É como a GUI menubar roda o motor como sidecar — ver [ADR-0007](../adrs/0007-transport-ndjson-duplex-native-ui.md). |
| `--verbose`               | —                     | `false`           | Inclui o tráfego ACP no log.                                                                                                                                                                                   |
| `-V, --version`           | —                     | —                 | Mostra a versão e sai.                                                                                                                                                                                         |
| `-h, --help`              | —                     | —                 | Mostra a ajuda e sai.                                                                                                                                                                                          |

## Notas

- Argumentos em excesso são rejeitados (`allowExcessArguments(false)`).
- `--dry-run` resolve o pipeline com as mesmas variáveis de interpolação de um run
  vivo (AD-4), então imprime as strings idênticas às que seriam executadas — sem
  qualquer efeito colateral.
- `--task` e `--concurrency` não se combinam de forma útil: `--task` seleciona uma
  única task isolada.
- Durante o desenvolvimento do próprio `loopy`, use o entrypoint direto via `tsx`:
  `npm run dev -- [dir] [opções]`.

## Subcomandos

### `probe-agent`

```
loopy probe-agent <nome> [--json] [--model <id>] [-c <path>]
loopy probe-agent --command <argv...> [--env K=V] [--model <id>]
```

Sonda as capabilities de um agente — abre uma sessão ACP descartável, lê
`configOptions` e imprime os valores aceitos de `mode`, `model` e `effort`. O
resultado é cacheado em `.loopy/capabilities.json`.

O agente pode ser dito de **duas formas**: pelo `<nome>` no Registry do
`loopy.yml` **salvo**, ou pelo argv literal (`--command`), que dispensa o
registry — é o que a GUI usa para sondar um agente que ainda é só um rascunho
(recém-criado, ou com o preset acabado de trocar).

| Argumento / Flag      | Descrição                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `<nome>`              | Nome do agente no Registry `agents:` do `loopy.yml`. Dispensável com `--command`.                                      |
| `--json`              | Emite o resultado em JSON (para consumo programático / GUI).                                                           |
| `--model <id>`        | Sonda **com este model aplicado**. Default: o `model` do agente no Registry.                                           |
| `--command <argv...>` | Argv literal do adapter — sonda **sem** passar pelo Registry nem pelo yml salvo. **Deve vir por último** (ver abaixo). |
| `--env K=V`           | Env do adapter (repetível). Só faz sentido com `--command`.                                                            |
| `-c, --config <path>` | Caminho alternativo do `loopy.yml`.                                                                                    |

**`--command` consome o resto da linha.** O argv de um adapter é opaco para o
motor e carrega flags que não são nossas (`npx -y …` é o argv de todo preset npm
do Catálogo), então tudo o que vem depois de `--command` é tratado como argv,
literalmente — flags inclusive. Corolário: as flags do próprio `probe-agent`
(`--json`, `--model`, `--env`, `-c`) precisam vir **antes** dele.

```
loopy probe-agent --json --model gpt-5-codex --command npx -y @agentclientprotocol/codex-acp
```

**Exemplo:**

```
$ loopy probe-agent claude-code
modes: plan, acceptEdits
models: —
efforts: low, medium, high, max
```

Use este comando para descobrir o dialeto literal de `mode`/`model`/`effort`
antes de escrevê-los no `loopy.yml`. Ver
[agents — dialeto literal](configuration.md#dialeto-literal-e-loopy-probe-agent).

#### Por que a sondagem aplica um `model`

Nem toda Capability é estática. O **OpenCode** deriva o `effort` do **model
corrente**: os níveis são as _variants_ daquele model, então ele só anuncia
`thought_level` quando o model tem variants — e a lista **muda com o model**
(`zai-coding-plan/glm-5.2` → `high, max`; `openai/gpt-5` → `minimal, low,
medium, high`; um model sem variants → nenhum). Claude e Codex anunciam
`thought_level` fixo já no `session/new`.

Por isso a sondagem aplica o model antes de ler as capabilities, e o **cache é
keyed por argv + model** (`opencode acp::zai-coding-plan/glm-5.2`). Sondar
"pelado" um agente OpenCode lê o model default do adapter e responde
"sem effort" — para um agente que tem effort.

```
$ loopy probe-agent opencode --model zai-coding-plan/glm-5.2
modes: build, plan
efforts: high, max
```

### Anotações de telemetria (`verdict` · `bug` · `change`)

Escrevem no `.db/telemetry.db` do projeto-alvo (a telemetria da ADR-0011). São a
**superfície de escrita** que a aba Insights da GUI invoca como subprocesso — mas
funcionam também na mão. O último argumento posicional é o `[dir]` do projeto-alvo
(default `.`); o `.db` **precisa já existir** (foi criado por uma Run com `metrics:`
presente), senão o comando sai com erro acionável.

O `<id>` da task é o id da telemetria, no formato `<change>/<task>` (ex.:
`C-0016/T-002`) — não o `T-\d+` cru do backlog.

#### `verdict set` / `verdict clear` — veredito humano de uma task

```
loopy verdict set --task <id> --pass|--fail [--note <texto>] [--by <autor>] [dir]
loopy verdict clear --task <id> [dir]
```

Registra o veredito humano de uma task (tri-estado `pass` / `fail` / não-avaliada).
`set` é upsert (muda `by`/`at` a cada mudança); `clear` apaga a linha, voltando ao
estado "não avaliada".

| Flag                | Descrição                                                       |
| ------------------- | --------------------------------------------------------------- |
| `--task <id>`       | Id da task na telemetria (ex.: `C-0016/T-002`). Obrigatório.    |
| `--pass` / `--fail` | O veredito. Exatamente **um** dos dois em `set`.                |
| `--note <texto>`    | **Opcional.** Nota livre.                                       |
| `--by <autor>`      | **Opcional.** Autor. Default: `git config user.name` → `$USER`. |

#### `bug add` — registra um bug ligado a uma task

```
loopy bug add --task <id> --severity <low|medium|high|critical> --title <t> [--detail <d>] [--found-in <change>] [dir]
```

Insere um bug com FK para a task. **Sem restrição de change** — um bug encontrado
numa change posterior, ligado a uma task de change anterior, é o caso normal.

| Flag                  | Descrição                                                             |
| --------------------- | --------------------------------------------------------------------- |
| `--task <id>`         | Id da task na telemetria. Obrigatório.                                |
| `--severity <nível>`  | `low` · `medium` · `high` · `critical`. Obrigatório.                  |
| `--title <texto>`     | Título curto do bug. Obrigatório.                                     |
| `--detail <texto>`    | **Opcional.** Descrição.                                              |
| `--found-in <change>` | **Opcional.** Id da change onde o bug foi encontrado (ex.: `C-0017`). |

#### `change --abandoned` / `--failed` — fecha a dimensão change

```
loopy change --abandoned|--failed [--change <id>] [dir]
```

Fecha a dimensão `change` **fora** do caminho `merged` (que fecha sozinho ao zerar
o backlog). É o único `UPDATE` da telemetria fora do `INSERT OR IGNORE` inicial da
change.

| Flag                       | Descrição                                                            |
| -------------------------- | -------------------------------------------------------------------- |
| `--abandoned` / `--failed` | O status terminal. Exatamente um dos dois.                           |
| `--change <id>`            | **Opcional.** Id da change. Default: a única change aberta no `.db`. |

## Ver também

- [Configuração (`loopy.yml`)](configuration.md) — os tetos e políticas que
  algumas flags sobrescrevem; o bloco `metrics` que liga a telemetria.
- [Backlog (`todo.md`)](backlog.md) — a lista de tasks que `--task` seleciona.
