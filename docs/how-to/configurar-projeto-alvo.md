# Como pôr o `loopy` para rodar num projeto existente

Este guia mostra como configurar o `loopy` num repositório que já tem um backlog
de tasks — do zero até a primeira task merjada — e como escalar para **rodar
tasks em paralelo** com um DAG de dependências.

Ele é prático: cada passo entrega um resultado verificável. Para o *significado*
dos termos (Step, Verify, Verdict, Worktree, Concorrência…) veja o glossário em
[`CONTEXT.md`](../../CONTEXT.md); para o *porquê* das decisões, os
[ADRs](../adrs/); para a descrição exaustiva de cada chave, a
[referência de configuração](../reference/configuration.md).

## Pré-requisitos

- **Node ≥ 20** e o `loopy` disponível (`npm install` na raiz deste repo, ou o
  binário publicado).
- Um **repositório git** no projeto-alvo, com o `parent_branch` (ex.: `main`)
  **limpo** — sem alterações não-commitadas.
- Um **agente de código com ACP** invocável por argv (ex.:
  `npx -y @agentclientprotocol/claude-agent-acp`).
- Comandos de **verificação** do projeto-alvo (tipicamente `typecheck` / `lint` /
  `test`) — são eles que fecham o loop interno.
- Um **backlog** de tasks e, idealmente, uma spec e um plan para o agente ler.

## Passos

### 1. Estruture os inputs (`spec`, `plan`, `todo.md`)

O `loopy` lê três inputs no projeto-alvo. Só o `todo.md` (o backlog) é
obrigatório para o loop iterar; `spec` e `plan` são material que o agente lê.

O backlog é uma lista de checkboxes na **coluna 0**, cada um com um corpo
indentado:

```markdown
- [ ] T-001: Adicionar parsing do cabeçalho
    Implemente o parser conforme a seção 3 da spec.

- [ ] T-002: Validar o cabeçalho parseado
    Deps: T-001
    Valide os campos obrigatórios e rejeite o resto.
```

A linha `Deps:` no corpo declara uma **Aresta de dependência**: `T-002` só fica
**Ready** quando `T-001` estiver **Done** (merjada). Sem `Deps:`, a task não tem
predecessores. Use isto no passo 9 para habilitar paralelismo.

> Detalhes do parsing (id, slug, marcadores, `Deps:`) na
> [referência do backlog](../reference/backlog.md).

### 2. Crie o `loopy.yml` mínimo

Na raiz do projeto-alvo, comece com os três blocos de infraestrutura:

```yaml
version: "1"
name: meu-projeto

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
  spec: "docs/spec.md"
  plan: "docs/plan.md"
  todo: "docs/todo.md"
  backlog:
    pending_marker: "- [ ]"
    done_marker: "- [x]"
    task_id_pattern: "T-\\d+"
    body: indented
    mark_done_on_success: true
    deps_pattern: "Deps:"
```

Todo objeto usa `.strict()` — **um typo em uma chave vira erro de config**, não é
ignorado. O motor valida a forma **antes** de qualquer efeito colateral.

### 3. Declare os `checks`

`checks` é um mapa de **nome → lista de comandos** do projeto-alvo. Cada nome é
reutilizável por um Step `checks` ou pelo `verify` de um Step `agent`.

```yaml
checks:
  ci:
    - { name: typecheck, run: "npm run typecheck" }
    - { name: lint, run: "npm run lint" }
    - { name: test, run: "npm test" }
```

> Esses comandos são os do **projeto-alvo**, não os do `loopy`.

### 4. Monte o `pipeline`

O `pipeline` é a lista ordenada de **Steps** aplicada a cada task. A ordem
declarada é o fluxo default; `on_success`/`on_fail` com `goto` a sobrepõem
(Desvios), tornando-o um grafo navegado por um Program counter. Há quatro tipos:
`agent`, `shell`, `checks`, `approval`.

O pipeline canônico cria um worktree isolado, faz o agente implementar até os
checks passarem, simplifica, audita (read-only, via `expect`), commita, faz merge
sob aprovação humana e limpa:

```yaml
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
      ${checks.report}
      **CRITICAL**: NÃO rode git add/commit. Deixe tudo no working tree; o pipeline commita.
    retry_prompt: |
      A tentativa anterior está no worktree, mas os checks falharam. Leia o código e corrija.
      ${checks.report}
    verify: { run: ci, max_attempts: 3 }

  - id: review
    type: agent
    mode: default
    prompt: |
      Reveja a task ${task.id} contra ${inputs.spec}. NUNCA EDITE NADA.
      Diff sob revisão:
      ${worktree.diff}
      Responda na ÚLTIMA linha exatamente "REVIEW: PASS" ou "REVIEW: FAIL: <motivo>".
    expect: "REVIEW: PASS"
    on_fail: { goto: implement }

  - id: commit
    type: shell
    run:
      - git -C "${worktree.path}" add -A
      - 'git -C "${worktree.path}" commit --allow-empty -m "feat(${task.id}): ${task.title}"'

  - id: merge
    type: approval
    prompt: "Aprovar merge da task ${task.id} em ${workspace.parent_branch}?"
    run:
      - 'git -C "${workspace.root}" merge --no-ff "${task.branch}" -m "merge(${task.id}): ${task.title}"'
    on_fail: escalate

  - id: cleanup
    type: shell
    always: true
    run:
      - git -C "${workspace.root}" worktree remove --force "${worktree.path}"
      - git -C "${workspace.root}" branch -D "${task.branch}"
```

Pontos que fazem o pipeline funcionar:

- **`verify: { run: ci, max_attempts: 3 }`** é o loop interno: roda `ci`, e se
  falhar re-prompta o agente com `${checks.report}` até passar ou esgotar as
  tentativas.
- **`expect: "REVIEW: PASS"`** exige que o Verdict do agente contenha essa string.
  `on_fail: { goto: implement }` fecha um fix-loop: reprovou → volta a implementar.
  Em um Step `agent`, `on_fail` **exige** `verify` ou `expect`.
- **`always: true`** faz o `cleanup` rodar mesmo se um Step anterior falhou.
- Um Step de agente que emite Verdict via `expect` **não** deve usar `mode: plan`
  (veja o Troubleshooting).

> O exemplo completo e validado pelos testes vive em
> [`examples/loopy.yml`](../../examples/loopy.yml). Feche o `loopy.yml` com os
> blocos de controle:

```yaml
stop_conditions:
  max_iterations: 25
  max_step_visits: 10
  stop_signal_file: ".loopy.stop"

concurrency: 1   # sequencial por enquanto; ver passo 9

policies:
  escalation:
    action: pause
    keep_worktree: true
    notify: stderr
  git:
    require_clean_parent: true
    on_merge_conflict: escalate

logging:
  dir: ".loopy/logs"
  per_task: true
  capture_acp_traffic: true
```

### 5. Ignore os artefatos de runtime

O `loopy` cria artefatos **no projeto-alvo** que **não** devem ser commitados.
Como `require_clean_parent: true` exige o parent limpo antes de cada merge, um
`.gitignore` incompleto quebra a run logo de cara. Adicione:

```gitignore
.worktrees/
.loopy/
.loopy.stop
```

### 6. Valide sem efeitos colaterais (`--dry-run`)

Antes de qualquer escrita, resolva e imprima o pipeline com a interpolação real:

```bash
loopy . --dry-run
```

`--dry-run` produz as **strings idênticas** às que rodariam de verdade (mesmas
variáveis de interpolação), mas **não escreve, não commita e não merja**. Use
para conferir prompts, comandos e a resolução de `${…}`. Uma variável
desconhecida aborta aqui, fail-fast, com o nome da variável e o Step.

### 7. Rode uma task isolada (`--task`)

Comece por uma task só, para validar o pipeline fim-a-fim:

```bash
loopy . --task T-001
```

O `loopy` cria o worktree, dirige o agente, e no Step `merge` **pausa** pedindo
sua aprovação. Aprovado, a task é merjada, marcada `- [x]` e o worktree é limpo.
Para não-interativo (CI), some `--yes` para auto-aprovar os Gates. `--task`
avisa (sem bloquear) se houver tasks pendentes anteriores no backlog.

### 8. Rode o backlog inteiro

```bash
loopy .
```

O loop externo itera as tasks pendentes em ordem, aplicando o pipeline a cada
uma, e termina com o backlog vazio ou por parada explícita. Para **encerrar após
a task corrente**, crie o Stop signal:

```bash
touch .loopy.stop
```

### 9. (Opcional) Habilite concorrência N

Por default `concurrency: 1` — comportamento sequencial, byte-idêntico ao loop
`for...of`. Para rodar tasks **independentes** em paralelo (ADR-0004):

1. **Declare o DAG** com linhas `Deps:` no `todo.md` (passo 1). Tasks sem aresta
   entre si podem rodar juntas; uma task só fica **Ready** quando todas as suas
   deps estão **Done**.
2. **Suba o pool** — no `loopy.yml` (`concurrency: 4`) ou por flag, que
   sobrescreve:

   ```bash
   loopy . --concurrency 4
   ```

   O Scheduler computa o *ready set* e enche o pool até o teto, desempatando pela
   ordem do backlog.
3. **Marque steps read-only como `parallel_safe: true`.** Toda mutação do parent
   compartilhado (`worktree add`, `merge`, `worktree remove`, `branch -D`) é
   serializada por uma **Seção crítica** (um mutex por Run). Um Step que **não**
   toca o `.git` compartilhado pode sair do mutex e rodar em paralelo de verdade
   — por exemplo, instalar dependências dentro do worktree:

   ```yaml
   - id: install-deps
     type: shell
     parallel_safe: true
     run:
       - npm ci --prefix "${worktree.path}"
   ```

   O default é `false` (seguro por omissão). O wait humano de um Step `approval`
   já roda **fora** do mutex — deliberar sobre um merge não trava o arranque de
   outras tasks Prontas.
4. **Escolha a política de conflito de merge.** Com merges serializados, o 2.º
   merge pode conflitar com o 1.º. `on_merge_conflict: escalate` (default)
   entrega ao operador; `rebase` faz o motor rodar `git rebase <parent>` na
   branch da task e re-tentar o merge uma vez, dentro do mutex — persistindo o
   conflito, cai no `on_fail`.

   ```yaml
   policies:
     git:
       on_merge_conflict: rebase
   ```

> Se uma task falha e não chega a **Done**, todo o fecho transitivo de
> descendentes é marcado **Skipped** (nunca roda), e o pool continua drenando as
> tasks independentes.

## Verificação

Ao final de uma run limpa: o `parent_branch` compila/linta/testa verde, cada
task concluída tem **um commit + um merge**, e **nenhum** worktree ou branch
temporário sobra — exceto os preservados por escalação (`keep_worktree: true`).

## Troubleshooting

### O parent não está limpo (`require_clean_parent` falha logo no início)

Quase sempre é `.gitignore` incompleto: os artefatos de runtime (`.worktrees/`,
`.loopy/`, `.loopy.stop`) aparecem como não-rastreados e sujam o parent. Volte ao
passo 5 e ignore-os.

### `npm ci` falha num projeto-alvo sem lockfile

`npm ci` exige um `package-lock.json`. Num repo novo ainda sem lockfile, troque
por `npm install` no Step de instalação, ou gere o lockfile antes de rodar.

### O Step `commit` sai com erro / "nothing to commit"

O agente commitou por conta própria e deixou a árvore limpa; o `git commit` do
pipeline então falha com exit 1. Duas defesas, ambas no exemplo acima: **proíba
o commit no prompt** ("NÃO rode git add/commit") e use `commit --allow-empty`
para o Step ser idempotente.

### O Verdict do agente aparece "ausente" (o `expect` nunca casa)

Um Step de agente com `expect:` **não** pode rodar em `mode: plan`. Em Modo plan
(read-only) o Verdict vai para o artefato de plan, que não é bufferizado — o
motor não o vê e o `expect` sempre falha. Use `mode: default` (ou `acceptEdits`)
no Step que emite Verdict.

### Uma task escalou e o worktree ficou preso

Com `escalation.action: pause` + `keep_worktree: true`, o worktree e o checkpoint
são **preservados de propósito** para você inspecionar. Depois de investigar,
faça o teardown (worktree + branch + checkpoint) e saia:

```bash
loopy . --clean T-004     # limpa uma task específica
loopy . --clean           # limpa a task com checkpoint pausado/em-progresso
```

Em seguida, re-rode a task com `loopy . --task T-004`.

### A run aborta antes de qualquer task com erro de DAG

Um **ciclo** de dependências ou uma **dep órfã** (`Deps:` apontando para um id
que não existe no backlog inteiro) aborta fail-fast, antes de rodar qualquer
task. Corrija as linhas `Deps:` no `todo.md`.

## Ver também

- [Referência de configuração](../reference/configuration.md) — toda chave, tipo
  e default do `loopy.yml`.
- [Referência da CLI](../reference/cli.md) — todas as flags (`--dry-run`,
  `--task`, `--concurrency`, `--clean`, `--yes`…).
- [Referência do backlog](../reference/backlog.md) — o formato do `todo.md` e as
  regras de `Deps:`.
- [ADR-0004](../adrs/0004-concorrencia-n-dag-de-tasks-secao-critica-e-skip-transitivo.md)
  — o *porquê* da concorrência, do DAG e da seção crítica.
- [`examples/loopy.yml`](../../examples/loopy.yml) — o config canônico completo.
