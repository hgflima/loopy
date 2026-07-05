# Meu primeiro backlog em paralelo

No [primeiro tutorial](meu-primeiro-loop.md) rodamos **uma** task. Agora vamos
ver o `loopy` processar um **backlog inteiro** — e o pulo do gato: tasks
**independentes rodam ao mesmo tempo**, enquanto uma task que **depende** de
outras espera a sua vez. Você vai montar um pequeno **DAG de dependências**,
subir a concorrência para 2 e ver, na TUI ao vivo, dois agentes trabalhando em
paralelo, uma task bloqueada, e o grafo desbloqueando sozinho quando as
predecessoras são merjadas.

O ponto que este tutorial ensina: sob paralelismo, o **trabalho pesado (o
agente) roda de verdade lado a lado**, mas toda mutação da branch compartilhada
(`worktree add`, `merge`, limpeza) é **serializada** — nunca há corrida no
`.git`.

## Antes de começar

- **Faça o tutorial [Meu primeiro loop](meu-primeiro-loop.md) primeiro** —
  reaproveitamos o mesmo esqueleto (Node ≥ 20, `node --test` sem dependências, o
  `loopy` disponível e um agente ACP autenticado). Aqui só explicamos o que muda.
- **~20 minutos.**

> Rodar N agentes ao mesmo tempo pressiona mais o processo do agente e a sua
> máquina. `concurrency: 2` é um começo conservador e suficiente para ver o
> paralelismo. Suba com cuidado.

## Passo 1 — Crie o sandbox

```bash
mkdir meu-backlog-paralelo && cd meu-backlog-paralelo
git init -b main
```

## Passo 2 — `package.json` e `.gitignore`

`package.json` (idêntico ao tutorial 1 — zero dependências):

```json
{
  "name": "meu-backlog-paralelo",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

`.gitignore`:

```gitignore
.worktrees/
.loopy/
.loopy.stop
```

Desta vez **não** criamos código nem testes no scaffold: cada task vai criar o
seu próprio módulo e o seu próprio teste. Isso é de propósito — já já você vê por
quê.

## Passo 3 — Descreva as três funções (`spec` + `plan`)

Vamos construir uma mini-calculadora de três funções, cada uma no seu arquivo.

`spec.md`:

```markdown
# Spec — mini-calculadora

Três funções, cada uma no seu módulo em `src/`:

- `soma(a, b)` → devolve `a + b`.
- `multiplica(a, b)` → devolve `a * b`.
- `calcula(a, b)` → devolve `{ soma: soma(a, b), produto: multiplica(a, b) }`,
  reutilizando as duas funções acima.
```

`plan.md`:

```markdown
# Plan — mini-calculadora

Para cada task, crie **o módulo em `src/<nome>.js`** e **um teste em
`test/<nome>.test.js`** (com `node:test`) que o valide. Não adicione dependências.

`calcula` importa `soma` de `./soma.js` e `multiplica` de `./multiplica.js` —
então ela só pode ser implementada depois que essas duas existirem.
```

## Passo 4 — O backlog com `Deps:` (o DAG)

Aqui está a novidade. Crie `tasks/todo.md` com **três** tasks — e uma linha
`Deps:` que desenha o grafo:

```markdown
# Backlog

- [ ] T-001: soma
      Implemente `soma(a, b)` em `src/soma.js` com um teste.

- [ ] T-002: multiplica
      Implemente `multiplica(a, b)` em `src/multiplica.js` com um teste.

- [ ] T-003: calcula
      Deps: T-001, T-002
      Implemente `calcula(a, b)` em `src/calcula.js`, reutilizando `soma` e
      `multiplica`, com um teste.
```

O grafo que isso descreve:

```
T-001 ─┐
       ├──► T-003
T-002 ─┘
```

`T-001` e `T-002` não têm predecessores — são **independentes** e podem rodar
juntas. A linha `Deps: T-001, T-002` diz que **`T-003` só fica _Ready_ quando as
duas estiverem _Done_ (merjadas)**. Isso não é decoração: o worktree de cada task
nasce da `main`, e o código de `calcula` importa `soma.js`/`multiplica.js` — que
só aparecem na `main` **depois** do merge. A dependência é real.

> A linha `Deps:` fica na **primeira linha** do corpo indentado. Detalhes do
> parsing na [referência do backlog](../reference/backlog.md#dependências-deps).

## Passo 5 — O `loopy.yml` (o mesmo pipeline, agora paralelo)

O pipeline é o **mesmo** do tutorial 1 — a mudança está em três pontos, marcados
abaixo:

```yaml
version: "1"
name: meu-backlog-paralelo

workspace:
  root: "."
  parent_branch: "main"
  worktrees_dir: ".worktrees"

acp:
  command: ["npx", "-y", "@agentclientprotocol/claude-agent-acp"]
  request_timeout_seconds: 1800
  permissions:
    default_mode: acceptEdits
    on_request: allow

inputs:
  spec: "spec.md"
  plan: "plan.md"
  todo: "tasks/todo.md"
  backlog:
    pending_marker: "- [ ]"
    done_marker: "- [x]"
    task_id_pattern: "T-\\d+"
    deps_pattern: "Deps:"          # (1) lê as arestas do DAG
    body: indented
    mark_done_on_success: true

checks:
  ci:
    - { name: test, run: "npm test" }

pipeline:
  - id: create-worktree
    type: shell
    run:
      - git worktree add -b "${task.branch}" "${worktree.path}" "${workspace.parent_branch}"

  - id: implement
    type: agent
    mode: acceptEdits
    prompt: |
      Implemente a task ${task.id} — ${task.title} — conforme ${inputs.spec} e ${inputs.plan}.
      ${task.body}
      Crie o módulo em src/ e um teste em test/ que o valide, e faça os checks passarem.
      NÃO rode git add/commit: deixe tudo no working tree; o pipeline commita.
    retry_prompt: |
      Os checks ainda falham. Leia o relatório, corrija o worktree e tente de novo.
      ${checks.report}
    verify: { run: ci, max_attempts: 3 }

  - id: commit
    type: shell
    run:
      - git -C "${worktree.path}" add -A
      - 'git -C "${worktree.path}" commit --allow-empty -m "feat(${task.id}): ${task.title}"'

  - id: merge
    type: approval
    prompt: "Aprovar merge da task ${task.id} (${task.title}) em ${workspace.parent_branch}?"
    run:
      - 'git -C "${workspace.root}" merge --no-ff "${task.branch}" -m "merge(${task.id}): ${task.title}"'
    on_fail: escalate

  - id: cleanup
    type: shell
    always: true
    run:
      - git -C "${workspace.root}" worktree remove --force "${worktree.path}"
      - git -C "${workspace.root}" branch -D "${task.branch}"

concurrency: 2                       # (2) até 2 tasks em voo ao mesmo tempo

stop_conditions:
  max_iterations: 10
  max_step_visits: 10
  stop_signal_file: ".loopy.stop"

policies:
  escalation:
    action: pause
    keep_worktree: true
    notify: stderr
  git:
    require_clean_parent: true
    on_merge_conflict: escalate      # (3) escalate (default) | rebase

logging:
  dir: ".loopy/logs"
  per_task: true
  capture_acp_traffic: false
```

As três mudanças:

1. **`deps_pattern: "Deps:"`** — manda o parser ler as arestas do DAG a partir do
   `todo.md`. (É o default, mas deixamos explícito para ver o grafo funcionar.)
2. **`concurrency: 2`** — o loop externo deixa de ser um `for` sequencial e vira um
   **pool** de até 2 sessões. O Scheduler enche o pool com as tasks _Ready_
   (desempatando pela ordem do backlog).
3. **`on_merge_conflict: escalate`** — como os merges são serializados, o 2.º pode
   conflitar com o 1.º; esta política decide o que fazer (mais no fim).

**O que roda em paralelo e o que não roda?** O Step de agente (`implement`) roda
**fora** da Seção crítica — é por isso que dois agentes trabalham de verdade ao
mesmo tempo. Já `create-worktree`, `commit`, `merge` e `cleanup` tocam a branch
compartilhada, então são **serializados** por um mutex da Run. E o *wait* de
aprovação humana também fica **fora** do mutex: deliberar sobre um merge não trava
o arranque de outra task Pronta.

## Passo 6 — Commit do scaffold na `main`

```bash
git add -A
git commit -m "chore: scaffold da mini-calculadora"
```

## Passo 7 — Espie o plano com `--dry-run`

```bash
loopy . --dry-run
```

As **três** tasks pendentes aparecem com o pipeline resolvido — `T-001` e `T-002`
prontas para começar, `T-003` com as suas dependências. Nenhuma escrita, nenhum
merge.

## Passo 8 — Rode o backlog em paralelo

Sem `--task` desta vez — queremos o backlog inteiro:

```bash
loopy .
```

Na TUI, o pool arranca **`T-001` e `T-002` juntas**, e `T-003` fica **bloqueada**
esperando as duas (repare nos símbolos: `▶` rodando, `◦` bloqueada):

    loopy · meu-backlog-paralelo · concurrency 2

    ▶ T-001  soma          → implement   … npm test
    ▶ T-002  multiplica    → implement   … npm test
    ◦ T-003  calcula       (aguardando T-001, T-002)

Cada agente cria o seu módulo e o seu teste no **seu próprio worktree**, e o
`verify` roda `npm test` ali dentro. Como o worktree de `T-001` só contém o que o
agente dele criou (o teste de `T-002` está no worktree do outro, não neste), não
há teste-vermelho cruzado — cada `npm test` fecha verde de forma independente.

## Passo 9 — Aprove os merges (a fila)

Quando um agente termina e chega ao `merge`, o `loopy` pede a sua aprovação. Com
duas tasks em voo, os pedidos **enfileiram** (FIFO). Responda **`s`** para cada:

    Aprovar merge da task T-001 (soma) em main? [y/N] s
    Aprovar merge da task T-002 (multiplica) em main? [y/N] s

Repare: enquanto você pensa se aprova `T-001`, `T-002` **continua trabalhando** —
o wait não segura o pool. (Quer ver o pool drenar sem parar em cada gate? Rode com
`--yes` para auto-aprovar.)

## Passo 10 — Veja o DAG desbloquear

Assim que `T-001` **e** `T-002` ficam `✔` _Done_, o Scheduler recomputa o conjunto
_Ready_ e `T-003` — antes bloqueada — arranca sozinha:

    ✔ T-001  soma          merjada
    ✔ T-002  multiplica    merjada
    ▶ T-003  calcula       → implement   … npm test

O worktree de `T-003` nasceu da `main` **já com** `soma.js` e `multiplica.js`
merjados, então o agente consegue importá-los e o teste de `calcula` fecha verde.
Aprove o último merge e o backlog zera.

## Passo 11 — Confira o resultado

```bash
npm test
git log --oneline --graph -8
git status
cat tasks/todo.md
```

Você deve ver:

- **`npm test`** passando na `main` com os três testes verdes.
- **`git log`** com os três merges. A ordem entre `T-001` e `T-002` depende de
  quem terminou primeiro (é uma corrida!), mas `T-003` vem sempre **depois** das
  duas:

      * merge(T-003): calcula
      * merge(T-002): multiplica
      * merge(T-001): soma
      * chore: scaffold da mini-calculadora

- **`git status`** limpo e **`.worktrees/` vazio**.
- **`tasks/todo.md`** com os três `- [x]`.

## O que você construiu

Você viu o `loopy` transformar um backlog num **grafo** e executá-lo: duas tasks
independentes correndo em paralelo, uma dependente esperando as suas
predecessoras, e o grafo se desbloqueando sozinho — tudo com a branch
compartilhada protegida por uma Seção crítica, sem uma única corrida no `.git`. E,
de novo: você **descreveu** esse comportamento (uma linha `Deps:`, um número em
`concurrency`), não o programou.

## Explore mais (opcional)

- **E se uma task falhar?** Se `T-001` esgotasse as `max_attempts` e escalasse, o
  `loopy` marcaria todo o fecho transitivo de descendentes como **pulado** (`⊘`) —
  `T-003` nunca rodaria —, mas `T-002`, independente, seguiria até o fim. É o
  **skip transitivo**: a falha propaga pelo DAG, o pool drena o que dá:

      ✖ T-001  soma          (checks falharam 3×, escalonada)
      ✔ T-002  multiplica
      ⊘ T-003  calcula        (pulada: depende de T-001)

- **Steps que não tocam o parent** (ex.: `npm ci` dentro do worktree) podem sair
  do mutex e rodar em paralelo de verdade marcando-os `parallel_safe: true`.
- **Conflito de merge:** com merges serializados, trocar `on_merge_conflict` para
  `rebase` faz o motor rebasear a branch da task sobre o parent e re-tentar o
  merge uma vez, dentro do mutex.
- **Sobrescrever pela CLI:** `loopy . --concurrency 3` ignora o valor do yml para
  esta run.

Os três primeiros têm um passo a passo no
[guia de projeto-alvo, seção "concorrência N"](../how-to/configurar-projeto-alvo.md#9-opcional-habilite-concorrência-n).

## Próximos passos

- **[Como pôr o `loopy` num projeto existente](../how-to/configurar-projeto-alvo.md)**
  — aplique DAG + concorrência a um repositório de verdade, com o pipeline
  canônico completo.
- **[Referência do backlog](../reference/backlog.md)** — a sintaxe de `Deps:`, o
  slug, os status de task (Ready/Blocked/Done/Skipped…).
- **[Referência da CLI](../reference/cli.md)** — `--concurrency`, `--task`,
  `--clean`.
- **[ADR-0004](../adrs/0004-concorrencia-n-dag-de-tasks-secao-critica-e-skip-transitivo.md)**
  — o *porquê* da concorrência, do DAG, da Seção crítica e do skip transitivo.
- **[`CONTEXT.md`](../../CONTEXT.md)** — glossário (Scheduler, Seção crítica,
  Concorrência, DAG de tasks).
