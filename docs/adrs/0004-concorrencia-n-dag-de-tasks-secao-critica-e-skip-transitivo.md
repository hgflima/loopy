---
number: 0004
title: "Concorrência N: DAG de tasks, seção crítica na camada de Steps, skip transitivo, cancelamento e on_merge_conflict"
status: accepted
date: 2026-07-05
status_date: 2026-07-05
supersedes: []
superseded_by: null
---

# ADR-0004 — Concorrência N: DAG de tasks, seção crítica na camada de Steps, skip transitivo, cancelamento e on_merge_conflict

## Context

O motor roda Tasks de forma estritamente sequencial (`for...of` no Loop externo),
apesar de o domínio já definir **Concorrência** como "o grau de paralelismo entre
Tasks" (`CONTEXT.md`) e de a camada de dados estar *parallel-ready* por construção:
session pool keyed por cwd (AD-3), store keyed por `taskId`, Worktree por Task,
resume `Record<taskId, TaskCheckpoint>`. O campo `concurrency` (default `1`)
existe no schema e no tipo, mas **nunca é lido** em runtime — é schema morto.

Forças em tensão:

1. **AD-1 (config-driven):** o motor não decide "quantas Tasks rodar" nem "quais
   dependem de quais" — `concurrency` e `Deps:` vêm do `loopy.yml`/`todo.md`.
   Ausência de `Deps:` + `concurrency: 1` deve produzir comportamento
   **byte-idêntico** ao `for...of` sequencial (regressão zero — o mesmo padrão
   opt-in das Métricas, ADR-0003).
2. **Isolamento do parent:** N Tasks mutando arquivos em paralelo (cada uma no seu
   Worktree) nunca devem colidir na Parent branch compartilhada. Toda mutação do
   parent — `git worktree add`, `git merge`, `worktree remove`, `branch -D`,
   `commitPaths`, `isParentClean` — deve ser serializada.
3. **O mutex NÃO mora no `GitPort`:** correção de fato (exploração do código).
   As mutações do parent são **Steps `shell`/`approval` dirigidos pelo `loopy.yml`**
   (`examples/loopy.yml`), executados por `steps/{shell,approval}.ts` com
   `cwd = workspace root`. O `GitPort` só executa `commitPaths`, `isParentClean`
   e o teardown do `--clean`. Um mutex "dentro do `GitPort`" cobriria quase nada.
4. **Wait de aprovação vs. mutex:** o Gate de Aprovação humano está no caminho
   crítico do desbloqueio de dependentes, mas **segurar o mutex durante a
   deliberação humana** travaria o arranque de novas Tasks Prontas.
5. **Cancelamento:** o Agente é **um processo** com N Sessões (AD-3);
   `child.kill()` mataria **todas** as Tasks — proibido para abortar uma Task
   isolada. O primitivo per-Task correto é `session.cancel()` (sibling-safe,
   cooperativo).
6. **Conflito de merge:** duas Tasks DAG-independentes podem editar o mesmo
   arquivo; como os merges são serializados, o 2.º pode conflitar com o 1.º.
   Escalar cegamente força o operador a resolver manualmente; auto-rebase é
   tratável pelo motor.
7. **Contrato congelado:** `StepContext`/`StepResult` são superfícies públicas
   estabilizadas. Extensões devem ser **aditivas** — nunca quebrar assinaturas.

Alternativas consideradas:

- **Mutex no `GitPort`.** Rejeitada: o `GitPort` não executa `worktree add`,
  `merge`, `worktree remove`, `branch -D` — esses são Steps `shell`/`approval`
  do yml (AD-1). Cobriria quase nada.
- **Paralelizar Steps dentro de uma Task.** Rejeitada: Step é uma unidade do
  Pipeline com PC sequencial; paralelizar Steps quebraria o invariante do PC e
  a semântica de `on_fail`/`on_success`/`goto`.
- **`child.kill()` para cancelar uma Task.** Rejeitada: mata todas as Sessões
  (1 processo por Run, AD-3). Aceitável apenas como fallback de timeout quando
  a Run inteira encerra.
- **Arestas de dependência no `loopy.yml`.** Rejeitada: as arestas pertencem ao
  Backlog (o "o quê"), não à Configuração (o "como"). A linha `Deps:` no
  `todo.md` espelha o padrão existente de `task_id_pattern`/`pending_marker`.
- **Desbloquear dependente em "commitado no worktree" (antes do Merge).**
  Rejeitada: o Worktree do dependente nasce do `parent_branch`; sem o Merge, o
  código do predecessor não está visível. `done` = merjado.

## Decision

### 1. DAG de Tasks extraído do `todo.md` (AD-1)

Linha canônica `Deps: T-001, T-002` no corpo indentado da Task — pattern
**configurável** via `inputs.backlog.deps_pattern` (default `Deps:`
case-insensitive). Materializa `task.deps: readonly string[]` (aditivo no tipo
`Task`). A linha permanece íntegra no `task.body`.

**Grafo de tasks** (DAG): nodes = Tasks do Backlog **completo** (`done` +
pendentes); edges = `[dep, dependente]`. Validação fail-fast: ciclo ou Dep
órfã (id ausente do Backlog inteiro) aborta antes de qualquer Task rodar.

### 2. Scheduler puro (AD-6)

Componente puro `src/scheduler/`: `buildGraph`, `readySet`, `skipDescendants`,
`topoLayers`. Dado o Grafo e o mapa de status, computa o conjunto pronto e
escolhe as próximas a iniciar sob Concorrência. Desempate entre Prontas = ordem
do Backlog (determinismo). O scheduler **não** executa Steps (isso é do PC).

### 3. Seção crítica na camada de execução de Steps

Mutex único da Run serializa a **execução de comando** de todo Step
**não-Agente** sem `parallel_safe`, mais `commitPaths`/`isParentClean`.
Threaded via os seams do command-runner (`RunShellCommand`, `runCommand` do
approval, `ChecksRunnerPort`) — **não** via `StepContext` (intocado).

- **Step `approval`:** o wait humano (`ui.requestApproval`) roda **FORA** do
  mutex; só a execução do comando aprovado entra. A deliberação humana não
  trava o arranque de novas Tasks.
- **`require_clean_parent`:** migra para **dentro** do mutex, reavaliado antes
  de cada Merge/mark-done.
- **`parallel_safe: true`:** opt-out declarativo — o Step não toca o `.git`
  compartilhado e roda fora do mutex. Default `false` (seguro por omissão).
  Warning estático não-fatal se argv aparentar mutar o parent.
- **Checkpoint:** escrita fica **fora** do mutex — já segura por design
  (instância única por Run + escrita síncrona keyed por `taskId` ⇒ event loop
  serializa sem perda).

### 4. Pool de N Sessões (substitui o `for...of`)

`Set<Promise>` de em-voo; enche até `concurrency` com Prontas (ordem de
backlog); a cada conclusão (`Promise.race`) reavalia o *ready set*.
`concurrency` (default `1`) passa a ser **lido**; `--concurrency N`
sobrescreve. `--task <id>` força `concurrency = 1` e avisa se houver Deps
não-`done`.

### 5. `${iteration}` desacoplado do teto

- **`${iteration}`** = índice estável da Task na ordem de arquivo do Backlog
  (idêntico dry-run × run vivo ⇒ preserva AD-4).
- **`max_iterations`** = contador separado de runtime ("Tasks iniciadas";
  `skipped` não conta).

### 6. Skip transitivo + escalonamento drenante

Se uma Task não chega a `done`, o fecho transitivo de descendentes é marcado
`skipped` (nunca rodará). O pool continua drenando as alcançáveis. Política de
Escalonamento reenquadrada:

- **`abort_loop`** → cancela em-voo + encerra; canceladas preservadas resumíveis.
- **`pause`** → marca `paused` (checkpoint preservado, resumível), pula
  descendentes, **continua drenando** independentes.
- **`skip_task`** → abandona checkpoint, pula descendentes, continua.

`RunLoopResult` ganha `paused` e `skipped` (aditivo).

### 7. Cancelamento por Sessão

Parada dura: `session.cancel()` em cada Sessão em voo (sibling-safe,
cooperativo — `prompt()` resolve `cancelled`), aguarda settle com timeout;
ao expirar, `child.kill()` do processo (a Run inteira encerra). Tasks
canceladas: worktree + checkpoint preservados (resumíveis). `child.kill()`
**nunca** para abortar uma Task isolada.

### 8. Conflito de merge: `on_merge_conflict` (AD-1)

Nova policy `policies.git.on_merge_conflict: escalate | rebase` (default
`escalate` = comportamento atual). Com `rebase`, no conflito o motor roda
`git rebase <parent>` na branch da Task + re-tenta o merge uma vez, **dentro**
do mutex; persistindo, cai no `on_fail`. Default preserva regressão-zero.

## Consequences

- **Positivo:** Tasks sem aresta rodam em paralelo (até `concurrency`),
  encurtando o tempo de parede de Runs com backlogs DAG-explícitos; toda
  mutação do parent serializada (sem race); falha propaga deterministicamente
  pelo DAG (skip transitivo); cancelamento sibling-safe; conflito de merge
  tratável por policy; contrato aditivo provado por `tsc`; regressão-zero
  byte-idêntica quando `concurrency: 1` + sem `Deps:` + `on_merge_conflict:
  escalate`.
- **Negativo / custo:** superfície de código maior (~novo módulo
  `src/scheduler/`, mutex, pool); mutex coarse-grained (todo Step não-Agente
  serializado — granularidade fina é pós-MVP); auto-rebase limitado a
  retry-once (conflitos estruturais exigem intervenção humana); N Sessões
  concorrentes pressionam o processo do Agente (risco do operador).
- **Risco aceito:** `parallel_safe` é opt-out — Step mal-declarado pode mutar
  o parent fora do mutex; mitigado pelo Warning estático + `require_clean_parent`
  como backstop fail-closed no mutex. Escrita de checkpoint fora do mutex é
  segura **enquanto** a instância for única e a escrita síncrona — invariante
  documentado e validado por teste.
- **Neutro:** `concurrency: 1` + sem `Deps:` = comportamento byte-idêntico
  (mutex uncontended, pool de 1); nenhuma dependência nova.
