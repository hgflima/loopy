# Spec: Paralelismo de Tasks dirigido pelo grafo de dependências — DAG do backlog, scheduler de N Sessões e skip transitivo

> Feature spec derivada do glossário `CONTEXT.md` e do estado atual do motor.
> **Introduz** o ADR-0004 (a criar): elevação da Concorrência de `1` (parallel-ready
> no papel) para **N efetivo**, dirigido por um **Grafo de tasks** extraído do
> Backlog. Invariante mantido (AD-1): o motor ganha a **mecânica** de agendar Tasks
> em paralelo respeitando arestas de dependência; **quantas** rodam em paralelo é
> `loopy.yml` (`concurrency`), e **quais** dependem de quais é o `todo.md` (linha
> `Deps:`). Sem `Deps:` e com `concurrency: 1`, o comportamento é **byte-idêntico**
> ao de hoje (regressão zero — o mesmo padrão opt-in das Métricas do C-0005).
>
> **Refinada via `/devy:refine`** (sessão de entrevista): 14 decisões tomadas + três
> correções de fato levantadas por exploração do código estão registradas em
> *Decisões resolvidas*. Todas as Open Questions foram fechadas.

## Objective

Substituir o Loop externo estritamente sequencial (`for...of` em
`src/loop/orchestrator.ts:1021`) por um **scheduler dirigido por um DAG de Tasks**,
de modo que Tasks **sem dependência entre si rodem concorrentemente** (cada uma em
seu Worktree/Sessão isolados) e Tasks **dependentes esperem os predecessores** —
maximizando o paralelismo sob um teto de Concorrência configurável, sem jamais
comprometer o isolamento nem a consistência da Parent branch.

O grau de paralelismo já é um termo do domínio: **Concorrência = o grau de
paralelismo entre Tasks** (`CONTEXT.md:185`), hoje `1` e nunca lido em runtime. As
camadas de baixo — session pool keyed por cwd (`src/acp/session.ts:293`), store da
TUI keyed por `taskId` (`src/tui/store.ts`), Worktree por `task.id`+branch, resume
por Task (`RunState` já é `Record<taskId, TaskCheckpoint>` — `src/types.ts:399`) —
já são **parallel-ready por construção** (AD-3). O que falta, e é o coração desta
feature, é o **scheduler** que respeite as arestas e abra até N Sessões vivas, mais
a **Seção crítica do parent** que serialize a mutação do repositório-pai.

**Usuário-alvo:** quem opera o `loopy` sobre um backlog devy cujo `plan.md`/`todo.md`
já expressa dependências entre Tasks e quer encurtar o tempo de parede de uma Run
rodando as Tasks independentes em paralelo, mantendo o Gate de Aprovação humano e o
fail-closed atuais.

**Critérios de aceite (do pedido), reenquadrados como Success Criteria** — ver seção
homônima. Em resumo: o DAG é construído a partir do `todo.md`; o scheduler respeita
as dependências e maximiza o paralelismo sob `concurrency`; a Concorrência é
configurável; o isolamento por Worktree é preservado quando Tasks mutam arquivos em
paralelo; e o motor **expõe o grafo de execução** (nodes+edges+status) que a TUI (ou
uma UI futura) consome. **Ausência de `Deps:` + `concurrency: 1` = regressão zero.**

## Enquadramento (o que o pedido esconde)

1. **"Steps em paralelo" é, na linguagem ubíqua, "Tasks em paralelo".** O pedido diz
   "executar steps em paralelo", mas **Step** tem significado fixo (uma unidade do
   Pipeline aplicado a **cada** Task — `CONTEXT.md:52`) e o paralelismo do domínio é
   entre **Tasks** (Concorrência — `CONTEXT.md:185`). Esta feature paraleliza o
   **Loop externo** (Tasks do Backlog), **não** os Steps de um Pipeline nem introduz
   paralelismo intra-Task. O PC (Program counter) segue estritamente sequencial
   **dentro** de cada Task; o que passa a rodar concorrentemente são Pipelines de
   Tasks distintas.

2. **A fonte da verdade das dependências é o `todo.md`, não o `plan.md`.** Hoje o
   grafo no `plan.md` é **ASCII-art/prosa** (frágil, e o motor **não** lê `plan.md`).
   "Deps: T-002" hoje é dobrado verbatim no `task.body` como prosa livre
   (`extractBody` coleta toda linha indentada — `src/backlog/todo.ts:117-137`).
   **Decisão:** estruturar a dependência numa **linha canônica `Deps:` no corpo da
   Task**, que o parser reconhece e materializa em `task.deps: readonly string[]`. O
   reconhecedor é **configurável** (via `inputs.backlog`, default `Deps:`
   case-insensitive), espelhando `task_id_pattern`/`pending_marker` — o parser continua
   "zero policy hardcoded" (mini-AD-1 do módulo). A feature-irmã *"gerar `loopy.yml` a
   partir de `plan.md`/`todo.md`"* (inexistente hoje) será a produtora natural dessas
   linhas; esta feature **não** depende dela (o operador escreve `Deps:` à mão).

3. **A aresta "T-B depende de T-A" significa "T-B precisa do código APROVADO de T-A".**
   Cada Worktree nasce do `parent_branch` (`git worktree add -b <branch> <path>
   <parentBranch>` — `examples/loopy.yml:37`); logo, T-B só **enxerga** o código de
   T-A se A já estiver **merjada no parent**. **Decisão:** a aresta desbloqueia o
   dependente quando o predecessor atinge **`done` (merjado no parent)** — não
   meramente "commitado no worktree". Consequências: (a) o **Merge deixa de poder ser
   adiado** para o fim da Run — está no caminho crítico do desbloqueio; (b) o **Gate de
   Aprovação humano** fica no caminho crítico: aprovar T-A libera T-B/T-C; (c) Tasks
   independentes de A seguem em paralelo enquanto A implementa **e** enquanto A aguarda
   aprovação — e, como o **wait de aprovação não segura o mutex** (OQ10), o arranque de
   novas Tasks Ready também não trava durante a deliberação humana.

4. **O paralelismo aperta num único ponto: a Parent branch compartilhada — e o mutex
   NÃO mora no `GitPort`.** Correção de fato (exploração do código): as mutações do
   repositório-pai **não passam pelo `GitPort`**. `worktree add`, `merge --no-ff`,
   `worktree remove` e `branch -D` são **Steps `shell`/`approval` dirigidos pelo
   `loopy.yml`** (`examples/loopy.yml:37,89,96-97`), executados por
   `src/steps/{shell,approval}.ts` com `cwd = workspace root`. O `GitPort` só executa
   `commitPaths` (mark-done), `isParentClean` e o teardown do `--clean`. Um mutex
   "dentro do `GitPort`" cobriria quase nada — e o motor, por AD-1, **não sabe** que um
   Step `shell` opaco roda `git merge` no parent. **Decisão (OQ6):** a **Seção crítica
   do parent** vive na **camada de execução de Steps** — o motor serializa, atrás de um
   mutex único da Run, **todo Step não-Agente** (o `agent` roda no worktree;
   `shell`/`approval`/`checks` standalone rodam contra o root —
   `src/loop/orchestrator.ts:610`), mais os ports `commitPaths`/`isParentClean`. O
   trabalho pesado (turnos do Agente e `verify`, ambos no worktree) roda **fora** do
   mutex, em paralelo. Um Step pode declarar **`parallel_safe: true`** para sair do
   mutex (opt-out; ex.: `npm ci --prefix`). `require_clean_parent` passa a ser
   reavaliado **dentro** do mutex, imediatamente antes de cada Merge/mark-done.

5. **Falha propaga pelo DAG: skip transitivo, com escalonamento reenquadrado.** Se uma
   Task **não** chega a `done`, seus descendentes **nunca** poderiam ficar *Ready*.
   **Decisão:** o fecho transitivo de descendentes é marcado **`skipped`** e o loop
   **continua drenando** as Tasks alcançáveis. A política de Escalonamento
   (`policies.escalation.action`) reenquadrada sob paralelismo (OQ4):
   - **`abort_loop`** → parada dura: **cancela imediatamente** as irmãs em voo, encerra
     a Run. As Tasks canceladas são **preservadas resumíveis** (OQ13); a que falhou vai
     para `escalated`.
   - **`pause`** → **continua drenando**: marca a falha `paused` (checkpoint
     preservado → resumível), pula descendentes, segue com as independentes. `pause`
     deixa de "parar a Run"; distingue-se de `skip_task` por **preservar** o checkpoint.
   - **`skip_task`** → continua drenando: pula a falha (checkpoint **abandonado**) e os
     descendentes, segue com o resto.

6. **`concurrency` é schema morto — passa a ser lido.** O campo existe
   (`src/config/schema.ts:317` — `z.number().int().min(1).default(1)`; `src/types.ts:274`)
   e é validado, mas **nenhum acesso de propriedade** o lê em runtime (grep: zero).
   Esta feature o torna **efetivo**: default `1`; `--concurrency N` sobrescreve
   (mesma cadeia de precedência `flags.X ?? config.Y` — `src/loop/orchestrator.ts:957`).

7. **O motor não expõe "grafo de execução" nem existe "Native UI".** A store é lista
   plana, sem nodes/edges (`src/tui/store.ts`); "Native UI" não existe (grep: zero).
   **Decisão:** esta feature **expõe o modelo de dados** do grafo no store observável —
   `nodes`+`edges`+derivados `ready`/`running`/`blocked`/`skipped` — como **contrato**.
   **Rendering fora do escopo** (a store nem é emitida pelo orquestrador hoje — T-017).

8. **Cancelamento é por-Sessão e cooperativo; `child.kill()` só como fallback de
   timeout na parada dura.** Correção de fato: o Agente é **um processo por Run**
   hospedando N Sessões (`src/acp/agent.ts:4-6`, AD-3), então `child.kill()` mataria
   **todas** as Tasks — **proibido para abortar UMA Task**. O primitivo per-Task correto
   é sibling-safe: **`session.cancel()`** → ACP `session/cancel` por `sessionId`
   (`src/acp/session.ts:161`), exposto no port (`src/types.ts:467`), **cooperativo** (o
   `prompt()` resolve `cancelled` — `src/acp/session.ts:68-72`). **Decisão (OQ11/OQ12):**
   na parada dura, kill agressivo no timeout — manda `session.cancel()` em todas as
   Sessões, aguarda o settle com timeout curto; ao expirar, como a **Run inteira está
   encerrando**, cai para `child.kill()` do processo (aceitável) e mata os childs execa
   de Steps `shell` em voo. Um comando git já dentro da Seção crítica **completa
   atomicamente** antes do teardown. Prompt de aprovação pendente é **abandonado** (não
   auto-aprovado).

9. **DAG-independente ≠ merge-compatível — e o conflito é tratável por policy.** Duas
   Tasks sem aresta entre si podem editar o mesmo arquivo; como os merges são
   serializados, o 2º pode conflitar com o 1º. **Decisão (OQ14/OQ15):** o motor ganha a
   **mecânica** de auto-rebase, gateada por config (AD-1 + regressão-zero): nova policy
   **`policies.git.on_merge_conflict: escalate | rebase`** (default `escalate` =
   comportamento atual). Com `rebase`, no conflito o motor roda `git rebase <parent>` na
   branch da Task + re-tenta o merge **uma vez**, **dentro** do mutex; se ainda
   conflita, cai no `on_fail`/Escalonamento. Default preserva byte-identidade em
   `concurrency: 1`. O operador também pode sempre serializar conflitos conhecidos
   adicionando um `Deps:`.

## Linguagem ubíqua (adições/precisões — a promover em `CONTEXT.md` + ADR-0004)

O motor **interpreta** estas palavras; cada uma tem um único significado. Não
intercambiar com o cluster de controle (Iteração/Tentativa/Visita) nem com o
"flow graph" de `goto` (que é **intra-Pipeline**, entre Steps — `src/config/warnings.ts`).

- **Aresta de dependência** (*dependency edge*) = "T-B depende de T-A", materializada na
  linha `Deps:` do `todo.md` e em `task.deps`. Semântica: **T-B só fica _Ready_ quando
  T-A está _Done_ (merjada no parent)**. Direção no grafo: `[from = dep, to = dependente]`.
- **Grafo de tasks** (*task graph* / DAG) = grafo dirigido acíclico; **nodes** = Tasks do
  Backlog (**completo** — `done` + pendentes), **edges** = Arestas de dependência.
  Distinto do **flow graph de `goto`**. Acíclico: ciclo ou Dep órfã ⇒ erro fail-fast.
- **Scheduler** = componente puro (AD-6) que, dado o Grafo e o mapa de status, computa o
  **conjunto pronto** (*ready set*) e escolhe as próximas a iniciar sob **Concorrência**.
  Distinto do **PC** (navega o Pipeline dentro de uma Task).
- **Ready / Pronta** = Task cujas Deps estão **todas** `done`. Desempate entre Prontas =
  **ordem do Backlog** (determinismo).
- **Blocked / Bloqueada** = Task com ≥1 Dep não-`done` **e ainda alcançável**. Vira
  *Ready* quando a última Dep fecha.
- **Skipped / Pulada** = Task cujo fecho de Deps contém uma que **não chegou a `done`**.
  Nunca ficará *Ready*; marcada e **não executada**. Derivada do Grafo + status, **não
  persistida** (recomputada no resume).
- **Seção crítica do parent** (*parent critical section*) = região serializada por um
  mutex único da Run que embrulha a **execução de comandos de todo Step não-Agente**
  (rodam contra o root) mais os ports `commitPaths`/`isParentClean`. **Não** mora no
  `GitPort`. O **wait de aprovação** do Merge acontece **fora** do mutex; a aquisição é
  só para a **execução de comandos**, com `require_clean_parent` reavaliado logo antes.
  O auto-rebase (quando `on_merge_conflict: rebase`) roda **dentro** dela. Step
  `parallel_safe: true` fica **fora**.
- **`parallel_safe`** (*novo campo aditivo de Step*) = opt-out declarativo da Seção
  crítica: o Step **não** toca o `.git` compartilhado e pode rodar em paralelo. Default
  `false` (seguro por omissão). O motor emite **Warning estático não-fatal** se um Step
  `parallel_safe` tiver argv que aparente mutar o parent (`git merge`/`commit`/
  `worktree`/`branch`/`push`, ou `-C ${workspace.root}`).
- **`on_merge_conflict`** (*nova policy de git*) = `escalate` (default) | `rebase`.
  `rebase` = o motor faz `git rebase <parent>` + re-tenta o merge uma vez dentro do
  mutex antes de cair no `on_fail`. Config decide; mecânica é do motor (AD-1).
- **Cancelamento** = `session.cancel()` (ACP `session/cancel`, por `sessionId`,
  sibling-safe, cooperativo). Na parada dura, `child.kill()` do processo do Agente é o
  **fallback de timeout** (a Run inteira encerra). Distinto do **Stop signal**
  (`.loopy.stop`, encerra **após** a Task corrente). `child.kill()` **nunca** para
  abortar uma Task isolada.
- **Concorrência** (`CONTEXT.md:185`) — precisão: passa a ser **o teto efetivamente
  respeitado pelo scheduler**; default `1`; sem teto superior.
- **Iteração** (*precisão dupla*) — desacoplam-se sob paralelismo:
  - a **var `${iteration}`** = **índice estável da Task na ordem de arquivo do Backlog**
    (o que o dry-run já resolve). Determinística e **idêntica entre dry-run e run vivo**
    ⇒ preserva **AD-4**.
  - o **teto `max_iterations`** = contador de runtime **separado**, "Tasks **iniciadas**
    nesta Run". `skipped` **não** conta. (Tentativa/Visita intra-Task intocados.)

## Design

### Fluxo (backlog → grafo → scheduler → Sessões paralelas → merge serializado)

```
parseBacklog (todo.md, +linha Deps:) ──► Task { …, deps: readonly string[] }
        │
        ▼
buildGraph(backlog COMPLETO) ──► TaskGraph { nodes, edges }  [ciclo + Dep órfã: fail-fast]
        │
        ▼
   ┌─ scheduler loop (substitui o for...of) ───────────────────────────────┐
   │  ready = readySet(graph, status) \ running                            │
   │  enquanto (running.size < concurrency && ready ≠ ∅):                  │
   │      iniciar próxima ready (ordem de backlog)  ─► runTaskPipeline(...) │  ← paralelo
   │  await primeira que terminar (Promise.race sobre as em-voo):          │
   │      done       ─► reavaliar ready (desbloqueia dependentes)          │
   │      escalate   ─► skipDescendants(graph, id); política:              │
   │                    abort→cancel em-voo+fim │ pause→paused, drena │    │
   │                    skip_task→abandona, drena                          │
   └───────────────────────────────────────────────────────────────────────┘
        │  (dentro de cada runTaskPipeline, só a execução de comando de Step
        │   não-Agente — e commitPaths/isParentClean — é serializada)
        ▼
   Seção crítica do parent (mutex, camada de execução de Steps):
       worktree add · [wait de aprovação FORA] · merge (+rebase se policy) · mark-done · cleanup
```

### Extração do DAG (parser do Backlog — `src/backlog/todo.ts`)

- Linha canônica `Deps: T-001, T-002` (ou `Deps: nenhuma`/ausente ⇒ `deps = []`).
  Pattern **configurável** em `inputs.backlog` (novo campo aditivo, default `Deps:`
  case-insensitive), espelhando `task_id_pattern`. Ids validados contra
  `task_id_pattern`. A linha **permanece** íntegra no `task.body`.
- `Task` ganha, **aditivamente**, `readonly deps: readonly string[]`.
- **Validação estática** no boundary de carga: (a) toda Dep referencia um `id`
  **presente no Backlog completo** (`done`+pendentes) — Dep órfã ⇒ fail-fast; (b) grafo
  **acíclico** — ciclo ⇒ fail-fast (lista o ciclo). Erros como valores (AD-5).

### Scheduler (núcleo puro — `src/scheduler/`, NOVO — AD-6)

```ts
export type TaskStatus =
  | 'blocked' | 'ready' | 'running' | 'done' | 'escalated' | 'paused' | 'skipped';

export interface TaskGraph {
  readonly nodes: readonly string[];                        // ids, ordem de backlog
  readonly edges: readonly (readonly [string, string])[];   // [dep, dependente]
}

buildGraph(tasks: readonly Task[]): Result<TaskGraph>   // backlog COMPLETO; valida ciclo/órfã
readySet(g: TaskGraph, status: ReadonlyMap<string, TaskStatus>): string[]  // ordem de backlog
skipDescendants(g: TaskGraph, failedId: string): Set<string>               // fecho transitivo
topoLayers(g: TaskGraph): string[][]                                       // camadas p/ dry-run
```

`buildGraph` recebe o Backlog **completo** (Tasks `[x]` entram como nodes pré-marcados
`done` ⇒ uma Dep sobre elas já está satisfeita). `readySet` retorna as Prontas em ordem
de backlog. O scheduler **não** executa Steps (isso é do PC).

### Orquestrador (`src/loop/orchestrator.ts` — substitui o `for...of`)

- O `for (const task of tasks)` (`:1021`) vira um **pool de N Sessões**: `Set<Promise>`
  de em-voo; enche até `concurrency` com Prontas (ordem de backlog); a cada conclusão
  (`Promise.race`) reavalia o *ready set* e escala/skipa/cancela.
- **Seção crítica (camada de execução de Steps):** mutex único serializa a **execução de
  comando** de todo Step **não-Agente** sem `parallel_safe`, + `commitPaths`/`isParentClean`.
  Aquisição embrulha **só a execução de comando** — no Step `approval`, o **wait humano
  precede a aquisição**; ao aprovar: mutex → reavalia `require_clean_parent` → `git merge`
  (+ rebase-retry se `on_merge_conflict: rebase`) → mark-done → libera. Aprovações em
  **FIFO** (`src/tui/approval.ts:11`), mas a deliberação **não** segura o `.git`.
- **Cancelamento (parada dura):** `session.cancel()` em cada Sessão em voo, aguarda o
  settle com timeout; ao expirar, `child.kill()` do processo + kill dos childs execa
  (a Run está encerrando). As Tasks canceladas ficam **resumíveis** (worktree+checkpoint
  preservados — OQ13). Nunca `child.kill()` para abortar uma Task só.
- **Conflito de merge:** o Step merge retorna conflito bem-formado; com
  `on_merge_conflict: rebase`, o motor tenta `git rebase <parent>` + re-merge uma vez
  dentro do mutex; persistindo, cai no `on_fail` do yml (`escalate` ou `goto`).
- **`require_clean_parent`** migra para **dentro** do mutex, antes de Merge/mark-done.
- **`${iteration}`** = **índice estável** do backlog (determinístico; idêntico ao
  dry-run — AD-4). O contador que gate `max_iterations` é **separado** ("Tasks iniciadas";
  `skipped` não conta).
- **`RunLoopResult`** ganha, **aditivamente**, `paused: string[]` e `skipped: string[]`
  ao lado de `completed`/`escalated`. Taxonomia: `completed`=merjada; `escalated`=falhou
  sob `abort_loop`/`skip_task`; `paused`=falhou sob `pause` (resumível);
  `skipped`=descendente transitivamente bloqueado (nunca rodou).

### Concorrência configurável

- `config.concurrency` (default `1`) passa a ser **lido** e é o teto do pool.
  `--concurrency N` (via `parsePositiveInt`) sobrescreve, como `--max-iterations`.
  `--task <id>` força `concurrency = 1` e **avisa** se a Task tiver Deps não-`done`
  (análogo a `src/index.ts:405-423`) — roda mesmo assim.
- **Sem teto superior** (`.min(1)`, sem `.max`). Nota: o Agente é **um processo** com N
  Sessões concorrentes; N muito alto pode pressioná-lo — risco do operador.
- **Regressão zero:** `concurrency: 1` **e** nenhum `Deps:` **e** `on_merge_conflict:
  escalate` ⇒ ordem de arquivo, uma Task/um Merge por vez — **byte-idêntico** ao `for...of`.

### Modelo de grafo na TUI (`src/tui/store.ts` — só dados, sem rendering)

- `StoreState` ganha `edges: readonly [string, string][]`; o `TaskStatus` da store ganha
  `'blocked'`/`'skipped'`/`'paused'` (hoje: `pending`/`running`/`done`/`escalated` —
  `src/tui/store.ts:31`). A store já é array keyed por `taskId` sem singleton
  (parallel-ready, testado — `tests/tui/store.test.ts:349-377`).
- Derivados (`ready`/`running`/`blocked`/`skipped`) = **funções puras** (AD-6). Nenhum
  rendering novo. (A store usa `findIndex` O(n)/evento — aceitável no MVP; `Map` é pós-MVP.)

### Resume / checkpoint (`src/resume/state.ts`)

- Correção (boa notícia): `RunState` **já é** `Record<taskId, TaskCheckpoint>` sem "Task
  corrente" (`src/types.ts:399`; multi-task testado — `resume.test.ts:181-212`). Mudança
  **mínima**, sem reformar o schema.
- Ao retomar: reconstrói o Grafo, marca `done` as já merjadas (**fonte da verdade = `[x]`
  do `todo.md`**), **recomputa** *ready set* e `skipped` do Grafo + status (skip **não**
  persistido). As em-voo interrompidas/canceladas **retomam do PC checkpointado**
  (`resumeStateFor` restaura pc+visits+carry — `src/resume/state.ts:45-56`); **não**
  recomeçam do zero. O status `paused` mantém a Task resumível.
- O `TaskStatus` **de resume** (`running`/`paused`/`aborted` — `src/types.ts:384`) fica
  intocado; `skipped`/`blocked` são **derivados**, não estados de checkpoint.

### Cancelamento (parada dura)

- `session.cancel()` por Sessão (cooperativo — `await` o `prompt()` resolver `cancelled`,
  com timeout). No timeout: `child.kill()` do processo + kill dos childs execa (a Run
  encerra de qualquer forma). Um comando **dentro** do mutex completa atomicamente. Tasks
  canceladas: worktree+checkpoint **preservados** (resumíveis).

### Dry-run (planner puro — AD-6)

`--dry-run` imprime o **DAG resolvido**: **camadas topológicas** (`topoLayers`),
**Concorrência efetiva**, **ordem de Merge** prevista, + Pipeline interpolado por Task —
**zero escrita**. `${iteration}` = índice estável ⇒ dry-run e run vivo resolvem idêntico
(AD-4). Opera sobre o Backlog **completo** (ignora `--task`, como hoje — `src/index.ts:614`).

## Tech Stack

Sem dependências novas (scheduler = grafo em memória; concorrência = Promises; mutex =
fila de Promise interna). Stack atual: TypeScript/Node ≥20 ESM, `@agentclientprotocol/sdk`,
`commander`, `execa`, `ink`+`react`, `yaml`, `zod`, `vitest`, `tsup`.

## Commands

```
Dev:        npm run dev -- [args]        # ex.: npm run dev -- --concurrency 4 --dry-run
Typecheck:  npm run typecheck
Lint:       npm run lint
Test:       npm test
Build:      npm run build
```

## Project Structure

```
src/backlog/todo.ts     → reconhece a linha `Deps:` (pattern configurável via
                          inputs.backlog) → Task.deps (aditivo); validação estática de
                          Dep órfã (fail-fast) sobre o Backlog COMPLETO
src/scheduler/          → NOVO (puro — AD-6): TaskGraph, buildGraph (valida ciclo/órfã via
                          Result), readySet, skipDescendants, topoLayers
src/loop/orchestrator.ts→ pool de N Sessões dirigido pelo scheduler; Seção crítica na
                          camada de execução de Steps (serializa Steps não-Agente sem
                          parallel_safe + commitPaths/isParentClean); wait de aprovação
                          FORA; auto-rebase (policy) DENTRO; cancelamento (session.cancel
                          → child.kill no timeout); require_clean_parent no mutex;
                          ${iteration}=índice estável; RunLoopResult += paused/skipped
src/steps/*.ts          → execução de comando passa pelo mutex quando não-Agente e não
                          parallel_safe; approval.ts separa wait (fora) de execução (dentro)
src/git/worktree.ts     → GitPort essencialmente inalterado; commitPaths/isParentClean
                          adquirem o mutex; + rebase helper p/ on_merge_conflict: rebase
src/config/schema.ts    → concurrency já existe (garante leitura); + Step.parallel_safe
                          (aditivo, default false); + inputs.backlog.deps_pattern;
                          + policies.git.on_merge_conflict (escalate|rebase, default
                          escalate); + Warning estático parallel_safe/parent
src/types.ts            → aditivo: Task.deps; Step.parallel_safe?; TaskGraph/TaskStatus;
                          StoreState.edges + status; RunLoopResult.paused/skipped;
                          policies.git.on_merge_conflict. RunState/TaskCheckpoint: já
                          Record — mudança mínima
src/tui/store.ts        → edges + status blocked/skipped/paused; derivados puros. Sem render.
src/resume/state.ts     → multi-in-flight reusa PC-based por Task; skip/ready recomputados
                          do Grafo + [x] (não persistidos)
src/acp/session.ts      → session.cancel() já existe; passa a ser invocado na parada dura
src/index.ts            → flag --concurrency N; --task avisa Deps não satisfeitas;
                          dry-run imprime o DAG (camadas + ordem de merge)
examples/loopy.yml      → concurrency > 1 (comentado); on_merge_conflict; Deps: no fixture;
                          padrão recomendado: split create-worktree (git worktree add,
                          serializado) + install-deps (npm ci, parallel_safe: true)
tests/fixtures/...      → todo.md com linhas Deps: (DAG de teste)
docs/adrs/0004-*.md     → ADR (Concorrência N + skip transitivo + Seção crítica na camada
                          de Steps + cancelamento + on_merge_conflict + AD-1)
```

## Code Style

Contrato aditivo, provado por `tsc`; erros como valores no boundary (AD-5); puro onde dá
(AD-6). Ex.:

```ts
// aditivo à Task (src/backlog/todo.ts) — contrato existente INALTERADO
export interface Task {
  readonly id: string; readonly slug: string; readonly title: string;
  readonly body: string; readonly branch: string; readonly done: boolean;
  /** ids das Tasks que devem estar `done` (merjadas) antes desta ficar Ready. */
  readonly deps: readonly string[];
}

// aditivo ao Step — opt-out da Seção crítica do parent
export interface StepBase {
  // …campos existentes inalterados…
  /** true ⇒ o Step NÃO toca o `.git` compartilhado; roda fora do mutex. Default false. */
  readonly parallel_safe?: boolean;
}

// aditivo à policy de git
export interface GitPolicy {
  readonly require_clean_parent: boolean;
  /** `escalate` (default) | `rebase` (rebase+retry-once no conflito, dentro do mutex). */
  readonly on_merge_conflict: 'escalate' | 'rebase';
}

export type TaskStatus =
  | 'blocked' | 'ready' | 'running' | 'done' | 'escalated' | 'paused' | 'skipped';
```

## Testing Strategy

`vitest`, testes junto ao código. Cobertura por camada:

- **Puro (unit) — o coração:** `buildGraph` (nodes/edges do Backlog completo; Tasks `[x]`
  pré-`done`; **detecta ciclo** e **Dep órfã** → Result de erro); `readySet` (só Blocked
  com **todas** as deps `done`; ordem de backlog no desempate); `skipDescendants` (fecho
  transitivo, inclusive diamante A→{B,C}→D); `topoLayers`. Determinismo.
- **Parser:** linha `Deps:` (vírgulas, espaços, case; `nenhuma`/ausente → `[]`); pattern
  `deps_pattern` custom; ids inválidos/órfãos sinalizados; `body` íntegro.
- **Orquestrador (integração com fakes):** DAG A→C, B (indep), `concurrency 2` → A e B
  **iniciam juntas**, C **espera** A `done`; A escala → C `skipped`, B conclui.
  **Seção crítica:** dois Merges nunca se sobrepõem (mutex provado); `require_clean_parent`
  **dentro** do mutex; Step `parallel_safe` **fora** (dois `npm ci` fake sobrepostos);
  **wait de aprovação fora do mutex** (um `worktree add` procede durante aprovação pendente).
- **Escalonamento:** `abort_loop` → `session.cancel()` nas em-voo + **timeout → child.kill**
  (fake registra), Run encerra, canceladas **preservadas resumíveis**; `pause` → falha
  `paused` (checkpoint preservado), descendentes `skipped`, independentes **seguem**;
  `skip_task` → checkpoint **abandonado**, resto drena.
- **Cancelamento:** `session.cancel()` sibling-safe (só a alvo recebe); `prompt()`
  `cancelled` tratado como stop; `child.kill()` **nunca** para abortar uma Task só (só no
  fallback de timeout da parada dura).
- **Conflito de merge:** `on_merge_conflict: escalate` (default) → conflito escala (=hoje);
  `rebase` → rebase+re-merge uma vez dentro do mutex; conflito persistente → `on_fail`.
- **Concorrência configurável:** `--concurrency N` sobrescreve; pool nunca excede N; `--task`
  avisa Deps não satisfeitas.
- **`${iteration}` estável (AD-4):** dry-run e run vivo resolvem idêntico p/ a mesma Task.
- **Store:** eventos concorrentes não corrompem; `edges`+status expostos; derivados corretos.
- **`RunLoopResult`:** `paused`/`skipped` populados corretamente por política e por skip.
- **Regressão zero (aceite):** fixture **sem** `Deps:`, `concurrency: 1`, `on_merge_conflict:
  escalate` → sequencial, um Merge por vez — **byte-idêntico** (mesma sequência observável).
  2º fixture **com** DAG + `concurrency > 1` → paralelismo + ordem de Merge respeitando arestas.
- **Dry-run:** camadas topológicas + ordem de Merge + Concorrência efetiva, zero escrita.

## Boundaries

- **Always:** mudanças de contrato **aditivas** (tsc prova) — `Task.deps`,
  `Step.parallel_safe?`, `inputs.backlog.deps_pattern`, `policies.git.on_merge_conflict`,
  `TaskGraph`, `StoreState.edges`, `RunLoopResult.paused/skipped`, status novos;
  **serializar toda mutação do parent** na Seção crítica (camada de Steps, não `GitPort`);
  **wait de aprovação FORA do mutex**; desbloquear dependentes **só** quando a Dep está
  `done`; **skip transitivo** ao falhar; **cancelar via `session.cancel()`** na parada dura
  (com fallback `child.kill()` só no timeout, quando a Run inteira encerra); **preservar
  resumíveis** as Tasks canceladas; **grafo sobre o Backlog completo**; **fail-fast** em
  ciclo/Dep órfã; scheduler **puro** (AD-6); erros como valores (AD-5); **gatear** o
  paralelismo em `concurrency`; desempate por **ordem de backlog**; `${iteration}` = índice
  estável (AD-4); **seguro por omissão** (`parallel_safe` e `on_merge_conflict` defaults =
  regressão-zero).
- **Ask first:** alterar contratos congelados **além** dos aditivos previstos
  (`RunState`/`TaskCheckpoint` só ganham uso multi-in-flight, sem mudar a forma;
  `StepContext`/`StepResult` **não** mudam — PC intra-Task intocado; `Step` ganha **só**
  `parallel_safe?`); adicionar dependência (nenhuma prevista); rendering de grafo na TUI;
  refinar a granularidade do mutex (liberar comandos dentro de um Step) — pós-MVP.
- **Never:** hardcodar comportamento de loop no motor (AD-1) — quantas é `concurrency`,
  quais deps é `Deps:`, o que é safe fora do mutex é `parallel_safe`, se rebasa no conflito
  é `on_merge_conflict` (tudo yml); paralelizar **Steps** dentro de uma Task; deixar dois
  Merges/mark-done tocarem o parent juntos; segurar o mutex durante o wait de aprovação;
  desbloquear um dependente antes de a Dep estar merjada; deixar um descendente de Task
  falha rodar (ou ficar preso "blocked" — é `skipped`); `child.kill()` para abortar **uma**
  Task; editar o `parent_branch` direto (fora do Merge); Artefato de runtime fora do
  `.loopy/` gitignored.

## Success Criteria

1. **DAG do `todo.md`:** linha `Deps:` (pattern configurável) → `task.deps`; `buildGraph`
   (Backlog completo) monta nodes+edges; ciclo/Dep órfã ⇒ **fail-fast** (Run não inicia).
2. **Scheduler respeita deps e maximiza paralelismo:** Tasks sem aresta rodam juntas (até
   `concurrency`); uma Task só inicia com **todas** as Deps `done`; desempate por ordem de
   backlog. Provado com DAG diamante + fakes.
3. **Concorrência configurável e efetiva:** `concurrency` (yml) **lido** e limita o pool;
   `--concurrency N` sobrescreve; pool nunca excede N.
4. **Isolamento preservado:** N Tasks mutando arquivos em paralelo nunca colidem; **toda**
   mutação do parent serializada na Seção crítica (camada de Steps); dois Merges nunca se
   sobrepõem; `require_clean_parent` no mutex; wait de aprovação **não** segura o mutex;
   `parallel_safe` roda fora.
5. **Skip transitivo + escalonamento paralelo:** fecho de descendentes vira `skipped`;
   `abort_loop` cancela em-voo (timeout→child.kill) e encerra, canceladas resumíveis;
   `pause` marca `paused` e **continua**; `skip_task` abandona e continua; `RunLoopResult`
   distingue `completed`/`escalated`/`paused`/`skipped`.
6. **Grafo exposto:** store expõe `nodes`+`edges`+derivados; **sem** rendering novo.
7. **Regressão zero:** **sem** `Deps:`, `concurrency: 1`, `on_merge_conflict: escalate` ⇒
   **byte-idêntico** ao atual.
8. **Conflito de merge:** `on_merge_conflict: rebase` faz rebase+retry-once dentro do mutex,
   depois `on_fail`; default `escalate` = comportamento atual.
9. **Resume/dry-run:** checkpoint retoma com N Tasks (done/paused/skipped/em-voo do PC);
   `--dry-run` imprime o DAG; `${iteration}` idêntico dry-run×run vivo (AD-4).
10. **Cancelamento correto:** parada dura usa `session.cancel()` (sibling-safe, cooperativo);
    `child.kill()` só como fallback de timeout quando a Run inteira encerra.
11. `npm run typecheck`, `npm run lint`, `npm test` verdes.

## Decisões resolvidas (ex-Open Questions + refine)

- **OQ1 — Fonte do grafo:** linha `Deps:` no `todo.md` → `task.deps` (pattern
  **configurável** via `inputs.backlog`, default `Deps:`). Não parseia `plan.md`; não põe
  arestas no `loopy.yml`.
- **OQ2 — Semântica da aresta:** desbloqueia com o predecessor **`done` (merjado)**. Merge e
  Gate de Aprovação no caminho crítico; independentes seguem em paralelo (o wait de
  aprovação **não** segura o mutex — OQ10).
- **OQ3 — Grão do paralelismo:** entre **Tasks**, nunca entre Steps. PC intra-Task
  sequencial; `StepContext`/`StepResult` intocados.
- **OQ4 — Falha no DAG:** **skip transitivo** + escalonamento: `abort_loop` → cancela em-voo
  e encerra; `pause` → `paused` (resumível), pula descendentes, **continua**; `skip_task` →
  abandona, continua.
- **OQ5 — Grafo pra UI:** só o modelo de dados; **rendering fora do escopo**.
- **OQ6 — Serialização do parent (corrigida):** o mutex **não** mora no `GitPort`. Vive na
  **camada de execução de Steps**: serializa todo Step não-Agente + `commitPaths`/
  `isParentClean`. Opt-out por **`parallel_safe: true`** (default `false`). Granularidade
  fina é pós-MVP.
- **OQ7 — Concorrência:** reutiliza `concurrency` (default `1`) + `--concurrency N`. Sem
  campo novo; sem teto superior.
- **OQ8 — Determinismo:** desempate por **ordem do Backlog**. `${iteration}` = **índice
  estável** (AD-4); `max_iterations` = contador separado de Tasks iniciadas.
- **OQ9 — `--task` com Deps:** roda isolada (`concurrency` efetivo `1`) e **avisa** se
  houver Deps não-`done`.
- **OQ10 — Aprovação × mutex:** o **wait de aprovação roda FORA do mutex**; só a execução do
  `git merge` (+ re-check + mark-done) entra. A deliberação humana **não** trava o arranque.
- **OQ11 — Cancelamento:** parada dura **cancela imediatamente** via `session.cancel()`
  (sibling-safe, cooperativo).
- **OQ12 — Fallback de kill:** no timeout do cancel cooperativo, cai para `child.kill()` do
  processo + kill dos childs execa (aceitável — a Run inteira encerra). **Nunca** para
  abortar uma Task só.
- **OQ13 — Tasks canceladas:** worktree + checkpoint **preservados resumíveis** (não
  falharam — só foram interrompidas); resume re-executa do PC. Independe de `keep_worktree`.
- **OQ14 — Conflito de merge:** DAG-independente ≠ merge-compatível. Tratado por policy
  (não escala cegamente): auto-rebase disponível.
- **OQ15 — Gate do auto-rebase:** nova policy **`policies.git.on_merge_conflict:
  escalate | rebase`** (default `escalate`). `rebase` = motor faz `git rebase <parent>` +
  retry-once dentro do mutex, depois `on_fail`. Preserva AD-1 + regressão-zero (config
  decide; mecânica é do motor).
- **OQ16 — Warning `parallel_safe`:** **Warning estático não-fatal** (padrão `warnings.ts`)
  se um Step `parallel_safe` aparentar mutar o parent. `require_clean_parent` no mutex é o
  backstop fail-closed.
- **OQ17 — Validação de Deps:** grafo sobre o **Backlog completo** (`done`+pendentes); Tasks
  `[x]` como nodes `done`; órfã = id ausente do Backlog inteiro.
- **OQ18 — Buckets do resultado:** `RunLoopResult` ganha `paused` + `skipped` (aditivo);
  taxonomia `completed`/`escalated`/`paused`/`skipped`.
- **OQ19 — Local da spec:** `.harn/devy/changes/C-0006-parallel-dag-scheduler/` (padrão
  dogfooded C-0001…C-0005, AD-7). Não usa `SPEC.md` na raiz.

