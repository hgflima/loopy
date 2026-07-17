# Como recuperar uma task pausada ou escalada

Este guia mostra o que fazer quando uma task **escala** — o `on_fail` esgotou e
o Escalonamento (`policies.escalation`) pausou a task: como investigar a causa
no worktree preservado, e como decidir entre **retomar do ponto exato** (o
checkpoint) ou **descartar e recomeçar** (`--clean`).

Contexto útil: com `action: pause`, a run **continua drenando** as demais tasks
do DAG — só a task escalada (e o fecho transitivo de dependentes dela, marcado
**Skipped**) para. Para o _significado_ dos termos (Escalonamento, Visita,
Tentativa, Artefato) veja [`CONTEXT.md`](../../CONTEXT.md).

## Pré-requisitos

- Um projeto-alvo rodando com o pipeline canônico do guia
  [Configurar um projeto-alvo](configurar-projeto-alvo.md).
- `policies.escalation` com `action: pause` e `keep_worktree: true` — sem
  `keep_worktree`, o worktree é removido na escalação e não há o que
  inspecionar (o checkpoint ainda existe).

## Passos

### 1. Entenda o que foi preservado

Uma task pausada com `keep_worktree: true` deixa para trás, de propósito:

- O **worktree** (`.worktrees/<id>/`) e a **branch** da task, com o trabalho do
  agente até o momento da falha.
- O **checkpoint** em `.loopy/state.json`: a posição do Program counter (o `id`
  do step), os contadores de Visita e o último `${checks.report}` — tudo o que
  o motor precisa para retomar do ponto exato.

### 2. Investigue a causa

```bash
git -C .worktrees/T-004 status
git -C .worktrees/T-004 diff
```

Os logs da run ficam em `.loopy/logs/` (um arquivo por task com `per_task:
true`; com `capture_acp_traffic: true`, o tráfego ACP bruto também). Rode os
checks à mão dentro do worktree para reproduzir o que o verify via.

### 3. Retome do ponto exato…

Se a causa era **externa ao pipeline** (rede, credencial do agente, um check
flaky, disco cheio), conserte-a e simplesmente re-rode:

```bash
loopy . --task T-004   # só ela; ou `loopy .` para retomar tudo que ficou
```

O motor compara o fingerprint do pipeline com o do checkpoint e, batendo,
**retoma do step salvo** — com os contadores de Visita e o `${checks.report}`
de antes (os tetos `max_step_visits`/`max_attempts` não zeram). O worktree
preservado é reaproveitado; nada do trabalho do agente se perde.

> Uma task interrompida por `abort_loop` (checkpoint `aborted`) só é retomada
> com `--task` explícito — `loopy .` a ignora.

### 4. …ou descarte e recomece do zero

Se o trabalho no worktree não vale salvar, faça o teardown e re-rode a task:

```bash
loopy . --clean T-004
loopy . --task T-004
```

`--clean` remove worktree + branch + checkpoint e sai — é **best-effort**
(worktree ou branch já ausentes viram log, não erro), então serve também para
"destravar" estados pela metade. Sem o `id`, ele escolhe a única task com
checkpoint pausado/em-progresso; havendo mais de uma, pede o id.

### 5. Se precisou editar o pipeline, limpe antes de re-rodar

O checkpoint é carimbado com um **fingerprint do pipeline** (hash de ids, ordem
e conteúdo dos steps). Qualquer edição no `pipeline:` do `loopy.yml` — até num
prompt — **invalida o checkpoint**: a task não retoma; recomeça do primeiro
step. E recomeçar com o worktree velho no caminho faz o `create-worktree`
falhar (a branch e o diretório já existem). A sequência segura após editar o
yml é sempre:

```bash
loopy . --clean T-004
loopy . --task T-004
```

## Verificação

A task recuperada termina o pipeline: merjada no parent, marcada `- [x]` no
backlog, worktree e branch removidos pelo `cleanup`, e o checkpoint dela some
do `.loopy/state.json`. Dependentes que tinham sido **Skipped** voltam a rodar
na re-execução seguinte (o skip não é persistido — deriva do DAG a cada run).

## Troubleshooting

### A run nova encerra sozinha logo no início ("stop-signal presente")

Sobrou um `.loopy.stop` de quando você parou a run anterior — o motor **não o
apaga**. Remova o arquivo e re-rode.

### O resume falha de novo dentro do `cleanup` ("not a working tree")

A run anterior morreu **durante/depois do cleanup**: o checkpoint aponta para o
step de cleanup, e retomá-lo re-executa `git worktree remove` contra um
worktree que já não existe (exit 128) — pausando de novo, para sempre. Saia do
laço com `loopy . --clean <id>` e, para prevenir, torne o step de cleanup
**idempotente** (um wrapper que tolera worktree/branch já removidos).

### `--clean` reclama de múltiplos checkpoints

Mais de uma task está pausada/em-progresso. Passe o id explícito:
`loopy . --clean T-004`.

### `--clean` diz que a task não está no backlog

O teardown precisa da task no `todo.md` para derivar o nome da branch e o path
do worktree. Se você já removeu a task do backlog, limpe à mão
(`git worktree remove --force .worktrees/<id>` e `git branch -D <branch>`) — o
checkpoint órfão é podado automaticamente na run seguinte.

### A task recomeçou do primeiro step em vez de retomar

O pipeline mudou desde a pausa (fingerprint divergiu) — é o comportamento
esperado do passo 5, não um bug. Se o `create-worktree` falhou por causa do
worktree velho, `--clean` e recomece.

## Ver também

- [Configurar um projeto-alvo](configurar-projeto-alvo.md) — o §Troubleshooting
  "Uma task escalou e o worktree ficou preso" é a versão curta deste guia.
- [CLI](../reference/cli.md) — `--clean [id]`, `--task <id>` e as demais flags.
- [Configuração — `policies`](../reference/configuration.md#policies) —
  `escalation.action`, `keep_worktree` e `on_merge_conflict`.
- [ADR-0004](../adrs/0004-concorrencia-n-dag-de-tasks-secao-critica-e-skip-transitivo.md)
  — por que `pause` continua drenando o DAG e o skip é transitivo.
