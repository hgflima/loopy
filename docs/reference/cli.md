# Referência da CLI

O comando `loopy` e todas as suas flags. Derivado de `src/index.ts`
(`buildProgram`).

## Sinopse

```
loopy [dir] [opções]
loopy probe-agent <nome> [--json] [opções]
```

Motor de loop agêntico config-driven via ACP. Lê o `loopy.yml` do diretório-alvo
e, para cada task pendente do backlog, executa o `pipeline` declarado.

## Argumento

| Argumento | Default | Descrição |
|-----------|---------|-----------|
| `[dir]` | `.` | Diretório do projeto-alvo. Onde ficam o `loopy.yml`, os inputs e os artefatos de runtime (worktrees, `.loopy/`, logs). |

## Flags

| Flag | Valor | Default | Descrição |
|------|-------|---------|-----------|
| `-c, --config <path>` | caminho | `<dir>/loopy.yml` | Caminho alternativo do `loopy.yml`. |
| `--dry-run` | — | `false` | Planeja e imprime o pipeline resolvido para as tasks pendentes; **zero escrita, commit ou merge**. |
| `-t, --task <id>` | id da task | — | Roda apenas a task com esse `id` (ex.: `T-004`). Avisa (sem bloquear) sobre tasks pendentes anteriores no backlog. |
| `--max-iterations <n>` | inteiro > 0 | config | Sobrescreve o teto do loop externo (`stop_conditions.max_iterations`). |
| `-y, --yes` | — | `false` | Auto-aprova os Gates de Aprovação (uso não-interativo / CI). |
| `--clean [id]` | id opcional | — | Faz teardown (worktree + branch + checkpoint) e sai. Sem `id`, usa a task com checkpoint pausado/em-progresso. |
| `--concurrency <n\|auto>` | inteiro > 0 ou `auto` | config | Sobrescreve o pool de tasks paralelas (`concurrency`). `auto` calcula pelo DAG — ver [concurrency](configuration.md#concurrency). |
| `--no-tui` | — | TUI ligada | Força logs de linha (sem Ink). |
| `--verbose` | — | `false` | Inclui o tráfego ACP no log. |
| `-V, --version` | — | — | Mostra a versão e sai. |
| `-h, --help` | — | — | Mostra a ajuda e sai. |

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
loopy probe-agent <nome> [--json] [-c <path>]
```

Sonda as capabilities de um agente registrado no `loopy.yml` — abre uma sessão
ACP descartável, lê `configOptions` e imprime os valores aceitos de `mode`,
`model` e `effort`. O resultado é cacheado em `.loopy/capabilities.json`.

| Argumento / Flag | Descrição |
|------------------|-----------|
| `<nome>` | Nome do agente no Registry `agents:` do `loopy.yml`. |
| `--json` | Emite o resultado em JSON (para consumo programático / GUI). |
| `-c, --config <path>` | Caminho alternativo do `loopy.yml`. |

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

## Ver também

- [Configuração (`loopy.yml`)](configuration.md) — os tetos e políticas que
  algumas flags sobrescrevem.
- [Backlog (`todo.md`)](backlog.md) — a lista de tasks que `--task` seleciona.
