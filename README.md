# loopy — Motor de Loop Agêntico Config-Driven via ACP

`loopy` é um CLI em TypeScript/Node que executa um **loop agêntico de dois
níveis** sobre um diretório local, dirigindo **agentes de código via ACP
(Agent Client Protocol)** até concluir um backlog de tasks.

**Diferencial central:** `loopy` é um **motor genérico que interpreta o
`loopy.yml`** — ele **não tem pipeline hardcoded**. O que o loop faz (steps,
ordem, prompts, comandos shell, modo/autonomia do agente, retries, escalonamento
e gates) é **100% definido no `loopy.yml`**; o código só implementa a mecânica.
Esse é o invariante do projeto (**AD-1**): trocar o comportamento do loop é
editar o yml, nunca o motor.

Em uma frase: `loopy .` lê `loopy.yml` + os inputs (`spec.md` / `plan.md` /
`todo.md`) e, para cada task pendente do backlog, executa o `pipeline`
declarado no yml — tipicamente cria um worktree isolado, faz o agente implementar
até os checks passarem, simplifica, audita (read-only), commita, faz merge (com
aprovação humana) e limpa — mostrando tudo numa **TUI ao vivo (Ink)**, ou, sob
`--emit-events`, numa **GUI nativa de menubar**
([`apps/menubar/`](apps/menubar/)) que roda o motor como sidecar.

> **Novo por aqui?** Comece pelo tutorial
> [Meu primeiro loop](docs/tutorials/meu-primeiro-loop.md) — 15 minutos, do zero
> a um loop inteiro rodando.

---

## Instalação

Requer **Node ≥ 22.13** (a telemetria usa `node:sqlite`).

Pelo npm (o CLI publicado):

```
npm install -g @hgflima/loopy
```

Do código-fonte:

```
npm install
npm run build      # tsup → dist/ (o bin `loopy` + os subpath exports)
```

## Uso

```
loopy [dir]                 # roda o loop no diretório-alvo (default ".")
```

Durante o desenvolvimento do próprio `loopy`, use o entrypoint direto:

```
npx tsx src/index.ts <dir>          # equivalente a `loopy <dir>`
npm run dev -- <dir> --dry-run      # via script
```

### Flags

| Flag                      | Efeito                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `-c, --config <path>`     | Caminho alternativo do `loopy.yml` (default: `<dir>/loopy.yml`).                                                                     |
| `--dry-run`               | Planeja e imprime o pipeline **resolvido** (com interpolação) e o DAG, **sem** nenhuma escrita/commit/merge (Success Criterion #8).  |
| `-t, --task <id>`         | Roda apenas a task com este id (ex.: `T-004`); força `concurrency = 1`. Avisa — sem bloquear — se houver tasks pendentes anteriores. |
| `--clean [id]`            | Teardown (worktree + branch + checkpoint) e sai. Sem `id`, usa a task com checkpoint pausado/em-progresso.                           |
| `--concurrency <n\|auto>` | Sobrescreve o pool de tasks paralelas; `auto` deriva do DAG ([ADR-0009](docs/adrs/0009-concorrencia-derivada-do-dag.md)).            |
| `--max-iterations <n>`    | Sobrescreve o teto do loop externo (`stop_conditions.max_iterations`).                                                               |
| `-y, --yes`               | Auto-aprova os gates de aprovação (não-interativo / CI).                                                                             |
| `--no-tui`                | Força logs de linha (sem Ink). Também degrada automaticamente sem TTY.                                                               |
| `--emit-events`           | O stdout vira canal NDJSON para a GUI ([ADR-0007](docs/adrs/0007-transport-ndjson-duplex-native-ui.md)); texto vai pro stderr.       |
| `--verbose`               | Inclui o tráfego ACP no log.                                                                                                         |
| `-V, --version`           | Mostra a versão.                                                                                                                     |

Há também subcomandos: `loopy probe-agent <nome>` sonda as capabilities de um
agente ([ADR-0008](docs/adrs/0008-capabilities-de-agente-por-descoberta.md)), e
`loopy verdict` / `loopy bug` / `loopy change` gravam anotações humanas na
telemetria ([ADR-0011](docs/adrs/0011-telemetria-sqlite-insert-only-e-granularidade-por-tentativa.md)).
A referência completa — flags e subcomandos — está em
[`docs/reference/cli.md`](docs/reference/cli.md).

> **Nota:** os checks (`typecheck` / `lint` / `test`) rodados **dentro do loop**
> são os comandos do **projeto-alvo**, definidos em `loopy.yml` — não os comandos
> de desenvolvimento do próprio `loopy` listados abaixo.

### Exemplo

```
loopy .                       # processa todo o backlog pendente, com TUI
loopy . --dry-run             # só mostra o pipeline resolvido, sem efeitos
loopy . --task T-004 --yes    # roda uma task, auto-aprovando o merge
loopy . --no-tui --verbose    # logs de linha + tráfego ACP
```

Para **encerrar após a task corrente**, crie o arquivo de sinal:

```
touch .loopy.stop
```

## Configuração (`loopy.yml`)

Todo o comportamento do loop vive no `loopy.yml` (o exemplo canônico e comentado
vive em [`examples/loopy.yml`](examples/loopy.yml)). O resumo abaixo é um mapa; a **referência completa** de cada bloco,
chave, tipo e default está em [`docs/reference/`](docs/reference/README.md). Para
um passo a passo de como pôr o `loopy` para rodar num projeto existente (inclusive
com concorrência N), veja o guia
[Configurar um projeto-alvo](docs/how-to/configurar-projeto-alvo.md). Blocos:

- **`workspace`** — `root`, `parent_branch` (destino do merge), `worktrees_dir`.
- **`acp`** — mecânica do subprocesso ACP (`command`, timeout, `permissions`) —
  o modo legado de agente único.
- **`agents`** — o Registry de agentes nomeados
  ([ADR-0006](docs/adrs/0006-multi-agente-acp.md)): `preset` do Catálogo (ou
  `command` literal), `model`/`effort` no dialeto do agente. Mutuamente
  exclusivo com `acp.command`.
- **`inputs`** — caminhos de `spec` / `plan` / `todo` + regras do `backlog`
  (inclusive `deps_pattern`, que lê as arestas do DAG).
- **`checks`** — listas nomeadas e reutilizáveis de comandos do projeto-alvo.
- **`pipeline`** — a lista de steps tipados (o loop em si). A ordem declarada é o fluxo default; Desvios (`on_fail: { goto }` / `on_success: { goto }`) sobrepõem-na, permitindo saltos e ciclos (fix-loop).
- **`stop_conditions`** — `max_iterations`, `max_step_visits` (teto de visitas por step por task, default 10) + `stop_signal_file`.
- **`concurrency`** — o pool de tasks paralelas: inteiro (default `1`) ou `auto`
  = `min(largura do DAG, max_concurrency)`
  ([ADR-0004](docs/adrs/0004-concorrencia-n-dag-de-tasks-secao-critica-e-skip-transitivo.md),
  [ADR-0009](docs/adrs/0009-concorrencia-derivada-do-dag.md)).
- **`policies`** — `escalation` (pause / skip_task / abort_loop + `keep_worktree`)
  e `git` (`require_clean_parent`, `on_merge_conflict: escalate | rebase`).
- **`logging`** — `dir`, `per_task`, `capture_acp_traffic`.
- **`metrics`** — telemetria opt-in em SQLite (`.db/telemetry.db`), ligada pela
  **presença** do bloco ([ADR-0011](docs/adrs/0011-telemetria-sqlite-insert-only-e-granularidade-por-tentativa.md)).

### Primitivas de step

Cada item de `pipeline` é uma das 4 primitivas, validadas por **zod** no _shape_:

| `type`     | Papel                            | Campos                                                                                                                                            |
| ---------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`    | Um turno do agente ACP           | `prompt`, `retry_prompt`, `mode`, `clear_context` (default `true`), `verify:{run,max_attempts}` (loop interno), `expect`, `on_fail`, `on_success` |
| `shell`    | Comandos externos (execa)        | `run:[…]`, `always`, `on_fail`, `on_success`                                                                                                      |
| `checks`   | Roda uma lista nomeada de checks | `run` (referência a `checks:`), `on_fail`, `on_success`                                                                                           |
| `approval` | Gate humano + ação               | `prompt`, `run:[…]`, `on_fail`, `on_success`                                                                                                      |

### Os dois loops

- **Loop externo** — o motor consome as tasks `- [ ]` do backlog — sob
  `concurrency > 1`, quem escolhe as próximas é o **Scheduler** (o _ready set_
  do DAG de `Deps:`), com a ordem do arquivo como desempate — e, para
  cada uma, executa o `pipeline` via **Program counter (PC)**: a ordem declarada
  é o default, mas Desvios (`on_fail: { goto }` / `on_success: { goto }`)
  saltam para outro step pelo `id`, permitindo ciclos intencionais (fix-loop).
  Cada entrada num step conta uma **Visita**, limitada por `max_step_visits`
  (default 10, fail-closed → escalate). Marca `- [x]` **apenas** após o
  pipeline inteiro da task ter sucesso, e commita essa marcação.
- **Loop interno** — o bloco `verify:` de um step `agent`:
  `prompt → checks → em falha, re-prompta com ${checks.report}` até passar ou
  esgotar `max_attempts`, aí aplica `on_fail`.

### Interpolação `${…}`

Resolvida uma vez por task/tentativa. Variáveis conhecidas:

```
${task.id} ${task.slug} ${task.title} ${task.body} ${task.branch}
${worktree.path} ${worktree.diff}
${iteration} ${attempt} ${checks.report}
${inputs.spec|plan|todo}
${workspace.root|parent_branch|worktrees_dir}
${change.id} ${change.dir}
```

Uma variável **desconhecida** aborta a run (fail-fast, com nome da variável +
step). Uma variável conhecida-porém-vazia renderiza vazio.

## Artefatos de runtime & `.gitignore`

No projeto-alvo, o `loopy` gera em runtime:

- `.worktrees/<id>/` — worktrees isolados por task;
- `.loopy/logs/<id>.log` — log por task (+ tráfego ACP quando `capture_acp_traffic`);
- `.loopy.stop` — sinal de parada (criado pelo operador);
- `.db/telemetry.db` — a telemetria SQLite, só quando `metrics:` está presente
  (opt-in; ver [ADR-0011](docs/adrs/0011-telemetria-sqlite-insert-only-e-granularidade-por-tentativa.md)).

Todos devem estar no `.gitignore` (este repo já ignora `.worktrees/`, `.loopy/`,
`.loopy.stop` e `.db/`). Numa run limpa, ao final o `parent_branch` fica verde e
nenhum worktree/branch temporário sobra — exceto os preservados por escalonamento
(`keep_worktree: true`).

## GUI nativa (menubar)

Além da TUI, este repo é um monorepo (`workspaces: ["apps/*"]`) que hospeda
[`apps/menubar/`](apps/menubar/) — um app macOS de menubar (Tauri v2 + React)
que spawna o motor como sidecar (`loopy --no-tui --emit-events`) e conversa com
ele por NDJSON duplex
([ADR-0007](docs/adrs/0007-transport-ndjson-duplex-native-ui.md)). Ele renderiza
o mesmo estado da TUI (Kanban, grafo, streams), edita o `loopy.yml` visualmente
e hospeda a aba **Insights** da telemetria
([ADR-0011](docs/adrs/0011-telemetria-sqlite-insert-only-e-granularidade-por-tentativa.md)).

```
npm run dev -w apps/menubar   # roda a GUI em dev
npm run menubar               # empacota o .app (tauri build)
```

## Comandos de desenvolvimento (do próprio repo)

```
npm run dev -- <dir>     # roda o CLI via tsx
npm run build            # tsup → dist/ (bin + subpath exports)
npm run typecheck        # tsc --noEmit (raiz + apps/menubar)
npm run lint             # eslint .
npm run format           # prettier --write .
npm test                 # vitest run (só a raiz; o app: npm test -w apps/menubar)
npm run test:watch       # vitest
```

---

## Success Criteria — matriz de aceitação (Checkpoint E)

Os oito critérios do `SPEC.md` são demonstráveis fim-a-fim; cada um é provado
pelos testes abaixo (`npm test`). O invariante **AD-1** (motor **config-driven**,
sem loop hardcoded) atravessa todos.

| #      | Critério                                                                                                                         | Prova (teste)                                                                                                                                                                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#1** | `loopy .` processa as tasks em ordem, executando o `pipeline` do yml, e termina com backlog vazio ou parada explícita.           | `tests/loop/run-loop.test.ts` (ordem + mark-done), `tests/e2e/e2e-agent.test.ts` (AC1)                                                                                                |
| **#2** | Trocar o comportamento do loop é **editar o `loopy.yml`** — sem tocar no motor (AD-1).                                           | `tests/e2e/e2e-agent.test.ts` ("honors a config-defined verdict token without any engine change"), `tests/acceptance/success-criteria.test.ts` (reordenar o pipeline reverte o plano) |
| **#3** | Cada task marcada `- [x]` = **um commit + um merge** no parent, com checks verdes e `AUDIT: PASS`.                               | `tests/e2e/e2e-agent.test.ts` (AC1), `tests/loop/run-loop.test.ts` (e2e non-agent)                                                                                                    |
| **#4** | Task cujos checks falham `max_attempts` vezes **não** é marcada, o worktree é **preservado**, e a escalação é aplicada e logada. | `tests/e2e/e2e-agent.test.ts` (AC2), `tests/policies/escalation.test.ts`, `tests/steps/agent.test.ts`                                                                                 |
| **#5** | O gate de merge (`approval`) pausa e só integra após aprovação (ou `--yes`); `.loopy.stop` encerra após a task corrente.         | `tests/steps/approval.test.ts`, `tests/loop/run-loop.test.ts` (stop_signal_file halts after current task)                                                                             |
| **#6** | A TUI mostra ao vivo tasks / `try k/max` / status por check / stream; degrada para logs de linha sem TTY ou com `--no-tui`.      | `tests/tui/start.test.ts`, `tests/tui/store.test.ts`, `tests/tui/view.test.ts`, `tests/tui/line-reporter.test.ts`                                                                     |
| **#7** | Ao final de uma run limpa, o `parent_branch` compila/linta/testa verde e nenhum worktree/branch temporário sobra.                | `tests/loop/run-loop.test.ts` (cleanup + `isParentClean`), `tests/e2e/e2e-agent.test.ts` (AC1), `tests/acceptance/success-criteria.test.ts` (hygiene do repo)                         |
| **#8** | `--dry-run` resolve e imprime o pipeline (com interpolação) sem nenhuma escrita/commit/merge.                                    | `tests/cli/dry-run.test.ts` ("does not write, commit, or merge anything")                                                                                                             |

Rode a matriz inteira com `npm test`; a suíte de aceitação isolada é
`npx vitest run tests/acceptance`.
