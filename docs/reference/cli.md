# Referência da CLI

O comando `loopy` e todas as suas flags. Derivado de `src/index.ts`
(`buildProgram`).

## Sinopse

```
loopy [dir] [opções]
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
| `--concurrency <n>` | inteiro > 0 | config | Sobrescreve o pool de tasks paralelas (`concurrency`). |
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

## Ver também

- [Configuração (`loopy.yml`)](configuration.md) — os tetos e políticas que
  algumas flags sobrescrevem.
- [Backlog (`todo.md`)](backlog.md) — a lista de tasks que `--task` seleciona.
