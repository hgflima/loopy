# Meu primeiro loop

Neste tutorial vamos montar um projeto minúsculo do zero e ver o `loopy` dirigir
um agente por um **loop inteiro**: ele cria um worktree isolado, implementa uma
função até um teste passar (✓ verde), commita, faz o merge **sob a sua
aprovação** e limpa tudo. No fim você terá visto os cinco passos de um pipeline
`loopy` rodarem de ponta a ponta — `create-worktree → implement → commit →
merge → cleanup` — e uma função nova, testada, na sua branch `main`.

Não presumimos que você conheça o `loopy` por dentro; só que tem Node e git à
mão. Para o *significado* preciso de cada termo (Worktree, Step, Verify, Gate de
Aprovação…), há o glossário em [`CONTEXT.md`](../../CONTEXT.md) — mas aqui é só
seguir junto.

## Antes de começar

- **Node ≥ 20** — usaremos o test runner embutido (`node --test`), então o
  sandbox não terá **nenhuma dependência** para instalar.
- **git**.
- **O `loopy` disponível** na linha de comando (veja
  [Instalação no README](../../README.md#instalação)).
- **Um agente de código com ACP** invocável por argv — o default é
  `npx -y @agentclientprotocol/claude-agent-acp`, autenticado. É ele que o Step
  `implement` vai dirigir.
- **~15 minutos.** Tudo o que criarmos é descartável — é um sandbox de
  aprendizado, não um projeto de verdade.

> Rodando de dentro do repositório do próprio `loopy`? Troque `loopy` por
> `npm run dev --` nos comandos (ex.: `npm run dev -- ../meu-primeiro-loop
> --dry-run`).

## Passo 1 — Crie o projeto-sandbox

```bash
mkdir meu-primeiro-loop && cd meu-primeiro-loop
git init -b main
```

A saída deve ser algo como:

    Initialized empty Git repository in .../meu-primeiro-loop/.git/

Repare no `-b main`: essa branch `main` será o nosso **Parent branch** — o
destino do merge, e a base de onde cada worktree nasce. Ela precisa de pelo
menos um commit antes do loop rodar; faremos esse commit no Passo 5.

## Passo 2 — Escreva o código-alvo (a função que o agente vai completar)

Vamos criar três arquivos: o `package.json`, uma função **stub** (vazia de
propósito) e o **teste** que fixa o contrato.

`package.json`:

```json
{
  "name": "meu-primeiro-loop",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

`src/saudacao.js` — o stub que o agente vai preencher:

```js
export function saudacao(nome) {
  // TODO: o agente vai implementar isto.
  return "";
}
```

`test/saudacao.test.js` — o nosso **Check**, que hoje está vermelho:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { saudacao } from "../src/saudacao.js";

test("saúda pelo nome", () => {
  assert.equal(saudacao("mundo"), "Olá, mundo!");
});
```

Rode o teste agora e confirme que ele **falha**:

```bash
npm test
```

    ✖ saúda pelo nome (...)
      AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
      + actual - expected
      + ''
      - 'Olá, mundo!'
    ...
    # fail 1

Esse vermelho é o ponto de partida. Fazê-lo virar verde é exatamente o trabalho
que vamos entregar ao loop.

## Passo 3 — Dê ao agente o que ler (`spec` + `plan`) e o que fazer (`todo`)

O `loopy` alimenta o agente com três inputs. Vamos criá-los curtinhos.

`spec.md` — o *quê*:

```markdown
# Spec — saudação

A função `saudacao(nome)` deve devolver a saudação no formato `Olá, <nome>!`.

Exemplo: `saudacao("mundo")` → `"Olá, mundo!"`.
```

`plan.md` — o *como*:

```markdown
# Plan — saudação

Implemente `saudacao` em `src/saudacao.js`. O teste em `test/saudacao.test.js`
já fixa o contrato — basta fazê-lo passar. Não adicione dependências.
```

`tasks/todo.md` — o **Backlog**, com uma única task pendente:

```markdown
# Backlog

- [ ] T-001: Implementar a saudação
      Faça `saudacao(nome)` devolver `Olá, <nome>!`, conforme a spec.
      O teste já existe e está vermelho — deixe-o verde.
```

Repare no formato: o `- [ ]` fica na **coluna 0** e o corpo vem **indentado**
embaixo. É assim que o loop externo distingue uma task pendente do seu corpo.

## Passo 4 — Escreva o `loopy.yml` (os cinco steps)

Aqui mora todo o comportamento do loop. Crie `loopy.yml` na raiz do sandbox:

```yaml
version: "1"
name: meu-primeiro-loop

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
      Faça os checks passarem. NÃO rode git add/commit: deixe tudo no working tree; o pipeline commita.
    retry_prompt: |
      Os checks ainda falham. Leia o relatório, corrija o código no worktree e tente de novo.
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

logging:
  dir: ".loopy/logs"
  per_task: true
  capture_acp_traffic: false
```

Cada um dos cinco steps do `pipeline`, em uma linha:

1. **`create-worktree`** — cria `.worktrees/T-001/` numa branch nova a partir da
   `main`. É lá que o agente edita, isolado da `main`.
2. **`implement`** — um turno do agente. O bloco `verify: { run: ci, max_attempts:
   3 }` é o **loop interno**: roda `npm test` e, se falhar, re-prompta o agente
   com o relatório até passar ou esgotar 3 tentativas.
3. **`commit`** — commita o trabalho do agente na branch da task. O
   `--allow-empty` e o "NÃO rode git add/commit" no prompt são um par: garantem
   que o Step commita mesmo que o agente já tenha deixado a árvore limpa.
4. **`merge`** — um **Gate de Aprovação**: pausa, pergunta a você, e só então faz
   `git merge --no-ff` na `main`.
5. **`cleanup`** — `always: true` faz este step rodar sempre, mesmo se algo antes
   falhar; remove o worktree e a branch temporária.

> Não precisa decorar nada disto. A [referência de configuração](../reference/configuration.md)
> descreve cada chave, e o [guia de projeto-alvo](../how-to/configurar-projeto-alvo.md)
> mostra o pipeline canônico completo (com simplificação e revisão).

## Passo 5 — Ignore os artefatos e faça o primeiro commit na `main`

O `loopy` cria arquivos de runtime que **não** devem ser commitados. Como
`require_clean_parent: true` exige a `main` limpa antes do merge, um `.gitignore`
incompleto quebraria a run logo no começo. Crie `.gitignore`:

```gitignore
.worktrees/
.loopy/
.loopy.stop
```

Agora commite tudo na `main`:

```bash
git add -A
git commit -m "chore: scaffold do sandbox (teste vermelho de proposito)"
```

Sim — estamos commitando com o teste **vermelho**, de propósito. A `main` é só o
ponto de partida; o loop vai consertá-la num worktree isolado e só tocar a `main`
no merge. O `require_clean_parent` verifica se a árvore git está **limpa**, não se
os testes passam.

## Passo 6 — Espie o plano com `--dry-run`

Antes de qualquer escrita, veja o pipeline **resolvido** — as strings idênticas
às que rodariam de verdade, mas sem nenhum efeito colateral:

```bash
loopy . --dry-run
```

A saída (ilustrativa) mostra a task com o `${…}` já interpolado:

    T-001  Implementar a saudação
      branch:    T-001-implementar-a-saudacao
      worktree:  .worktrees/T-001
      1. create-worktree (shell)
         git worktree add -b "T-001-implementar-a-saudacao" ".worktrees/T-001" "main"
      2. implement (agent)  verify: ci ×3
      3. commit (shell)
      4. merge (approval)
      5. cleanup (shell)

Repare como `${task.branch}` virou `T-001-implementar-a-saudacao` (o id + o slug
do título) e `${worktree.path}` virou `.worktrees/T-001`. Se você tivesse digitado
uma variável desconhecida no yml, o `--dry-run` abortaria aqui, apontando o nome
da variável e o step — antes de qualquer dano.

## Passo 7 — Rode o loop

```bash
loopy . --task T-001
```

O `--task` roda **uma** task isolada — ideal para o primeiro contato. Uma TUI ao
vivo abre e você vê os steps acenderem em sequência:

1. **create-worktree** — `.worktrees/T-001/` aparece.
2. **implement** — o agente lê a spec e o plan, edita `src/saudacao.js`, e o
   `verify` roda `npm test`. Você vê o check virar **✓ verde**. (Se falhasse, o
   loop re-prompta o agente e tenta de novo, até 3×.)
3. **commit** — `feat(T-001)` é commitado na branch da task.
4. **merge** — o loop **pausa** e mostra o pedido de aprovação.

## Passo 8 — Aprove o merge

Quando a TUI perguntar `Aprovar merge da task T-001 …?`, responda **`s`** (ou
`y`) para aprovar; `n` ou `Esc` rejeitaria.

    Aprovar merge da task T-001 (Implementar a saudação) em main? [y/N] s

Aprovado, o loop faz o `git merge --no-ff` na `main`, marca a task como `- [x]`
no `todo.md` (e commita essa marcação), e o **cleanup** remove o worktree e a
branch temporária.

> Sem TTY ou com `--no-tui`, o `loopy` pergunta numa linha `[y/N]` — digite `s` +
> Enter. Para auto-aprovar (CI, não-interativo), rode com `--yes`.

## Passo 9 — Confira o resultado

```bash
npm test
git log --oneline -5
git status
cat tasks/todo.md
```

Você deve ver:

- **`npm test`** agora **passa** na `main` — ✓ verde.
- **`git log`** com o merge da T-001 trazendo o `feat(T-001)`, e o commit que
  marcou a task concluída:

      * chore(loopy): conclui T-001
      *   merge(T-001): Implementar a saudação
      |\
      | * feat(T-001): Implementar a saudação
      |/
      * chore: scaffold do sandbox (teste vermelho de proposito)

- **`git status`** limpo, e **`.worktrees/` vazio** — nenhum worktree ou branch
  temporária sobrou.
- **`tasks/todo.md`** com `- [x] T-001` no lugar do `- [ ]`.

## O que você construiu

Você viu um pipeline `loopy` inteiro rodar sobre um projeto de verdade: um
worktree isolado, um agente implementando até o **Verify** ficar verde, um
commit, um **Gate de Aprovação** humano no merge, e a limpeza — os cinco steps
que você declarou no `loopy.yml`, e nada mais. O ponto central: **você não
programou o loop, você o descreveu.** Trocar o que o loop faz é editar o yml,
nunca o motor.

## Próximos passos

- **[Meu primeiro backlog em paralelo](meu-primeiro-backlog-paralelo.md)** — o
  próximo tutorial: rode um backlog inteiro com tasks independentes em paralelo e
  uma dependente esperando, usando `Deps:` e `concurrency`.
- **[Como pôr o `loopy` num projeto existente](../how-to/configurar-projeto-alvo.md)**
  — leve isto para um repositório de verdade: o pipeline canônico (com
  simplificação e revisão) e como rodar tasks **em paralelo** com um DAG de
  dependências.
- **[Referência da CLI](../reference/cli.md)** — todas as flags (`--dry-run`,
  `--task`, `--clean`, `--yes`, `--concurrency`…).
- **[Referência de configuração](../reference/configuration.md)** e
  **[da interpolação `${…}`](../reference/interpolation.md)** — cada chave do
  `loopy.yml` e cada variável.
- **[`CONTEXT.md`](../../CONTEXT.md)** — o glossário da linguagem ubíqua, quando
  quiser cravar o significado de um termo.
