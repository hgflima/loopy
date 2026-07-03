# Plano: Resume de pipeline no `loopy` (C-0002)

> Plano de implementação derivado de `spec.md` (nesta mesma pasta). Backlog
> executável em `todo.md` (ao lado). Não toca `tasks/plan.md`/`tasks/todo.md` da
> raiz (backlog vivo do projeto, T-001..T-019).

## Context

Hoje o `loopy` só retoma no nível de **task**: o `todo.md` marca `- [x]` e
`pendingTasks()` filtra as concluídas. Se uma run para **no meio de uma task**
(escalation pause, ou kill), a próxima execução recomeça a task do zero e o
primeiro step (`create-worktree`) **falha** com "path already exists", porque o
worktree/branch preservados por `keep_worktree` ainda existem. É o caso real da
T-004, que parou no step `commit`.

Esta feature torna a run **retomável a nível de step**: um `.loopy/state.json`
(gitignored, fonte de verdade única, escrito atomicamente após cada step)
registra quais steps de cada task já concluíram; ao recomeçar, o `loopy` **pula**
os concluídos e retoma do primeiro step pendente. Uma flag `--clean [T-XXX]` faz
o teardown explícito (worktree + branch + checkpoint) para recomeçar do zero.

Invariante mantido (AD-1): o motor é intérprete genérico — resume é **mecânica**
interpretada, nunca pipeline hardcodado. `checkpoint?` é **opcional** em
`OrchestratorDeps`: quando ausente (spine de teste atual), todo o resume é
inerte → **regressão zero** nos 405 testes existentes.

## Verificação do terreno (o que já existe)

- `runLoop` / `runTaskPipeline` vivem só em `src/loop/orchestrator.ts`
  (`runTaskPipeline` interna `:551`; `runLoop` exportada `:697`). O pipeline é
  **dado do config** (`config.pipeline: readonly StepConfig[]`), nunca código.
- `runTaskPipeline` hoje sempre começa no primeiro step; `attempt` é fixo em 1.
  Não há persistência entre runs além do `- [x]` do `todo.md`.
- `MarkDonePort` + `createMarkDonePort` (`orchestrator.ts:335`/`:358`) são o
  **molde exato** do novo `CheckpointPort`. `markDone` é chamado em `:757`.
- `Git` (`src/git/worktree.ts:49`) **já** expõe `removeWorktree`, `deleteBranch`
  (`git branch -D`) e `commitPaths` — `--clean` reusa tudo. **Sem mudança em
  `worktree.ts`.**
- **Não existe** helper de escrita atômica (grep por `renameSync` = vazio); o mais
  próximo é `markDoneInFile` (read-transform-write-if-changed). Criaremos tmp+rename
  em `state.ts`.
- **Não existe** uso de `node:crypto` no projeto — o fingerprint é o primeiro
  (sem dep nova).
- `pause` e `abort_loop` são hoje efetivamente idênticos (ambos encerram); o
  "pause resumível" está marcado como TODO em `decideEscalation` (`:657`). Esta
  feature o realiza.
- `.loopy/` hoje só hospeda `logging.dir` (`.loopy/logs`, `mkdirSync` recursivo no
  logger). O `state.json` fica ao lado, já coberto pelo `.gitignore`.
- Backlog: `loadBacklog`/`pendingTasks`/`selectTask` em `src/backlog/todo.ts`;
  `Task.branch` derivado do slug. `index.ts:400` filtra pending — precisaremos do
  **backlog completo** para `pruneOrphans` (knownTaskIds).
- Testes: molde em `tests/loop/run-loop.test.ts` (`scriptedRegistry`,
  `recordingMarkDone`, `makeDeps`) e `tests/steps/support.ts`
  (`makeStepContext`, `makeLogger`, `defaultConfig`). 405 testes verdes hoje.

## Architecture Decisions

- **`checkpoint?: CheckpointPort` opcional em `OrchestratorDeps`.** Ausente →
  resume totalmente inerte. Garantia de regressão zero.
- **Hash preso ao port.** `createCheckpointPort({ statePath, pipelineHash })`
  carimba o hash corrente em toda escrita (hash é constante na run). Simplifica a
  assinatura vs. spec (`recordStep(taskId, stepId, hash)` → `recordStep(taskId,
  stepId)`). `completedStepsFor(state, id, currentHash, opts)` continua **puro**
  (recebe o hash corrente para comparar), idêntico ao spec.
- **Port síncrono.** `state.ts` faz I/O síncrono atômico (tmp+rename); manter o
  port síncrono evita `await` no hot-path por-step e simplifica o fake. (Difere do
  `MarkDonePort` async, async só por commitar via git.)
- **`aborted` = "comporta-se como hoje".** Sob auto-resume, checkpoint `aborted`
  → `completedStepsFor` retorna vazio → a task roda do zero (podendo colidir no
  worktree preservado, como hoje). O operador usa `--clean` ou `--task`.
- **`allowAborted = flags.task !== undefined`.** Só `--task` retoma um checkpoint
  aborted de onde parou.
- **`pruneOrphans` usa o backlog completo** (todas as ids de `loadBacklog`), não o
  subset de `pendingTasks`.

## Dependência entre componentes

```
src/types.ts (tipos)
    └── src/resume/state.ts (puro: fingerprint, completedStepsFor, load/save atômico, transições)   [T-020]
            └── src/loop/orchestrator.ts (CheckpointPort + skip/record + reconciliação)              [T-021]
                    └── src/index.ts (wire .loopy/state.json + flag --clean)                          [T-022]
```

Fatiamento vertical: T-020 = camada de dados testável isolada; T-021 = resume
vivo através do `runLoop` com CheckpointPort fake (o valor central: pular
concluídos, consertar T-004); T-022 = disco real + superfície de operador
(`--clean`, auto-resume).

## Fase 1 — Fundação pura (dados + fingerprint + I/O atômico)

### T-020: `src/resume/state.ts` + tipos em `types.ts`

**Description:** Módulo puro + wrapper de I/O no molde de `backlog/todo.ts`
(`parse*`/`*InFile`) e `config/load.ts` (`parseConfig`/`loadConfig`). Nenhuma
mudança no comportamento do loop — só a camada de dados.

**Tipos novos em `src/types.ts`:**
- `TaskStatus = "running" | "paused" | "aborted"`
- `TaskCheckpoint { readonly pipelineHash: string; readonly completedSteps: readonly string[]; readonly status: TaskStatus }`
- `RunState { readonly version: 1; readonly tasks: Readonly<Record<string, TaskCheckpoint>> }`
- `CheckpointPort { read(): RunState; recordStep(taskId, stepId): void; setStatus(taskId, status): void; clearTask(taskId): void; pruneOrphans(knownTaskIds): void }`
- `RunFlags.clean?: string | boolean` (campo opcional adicionado)

**Funções em `src/resume/state.ts`:**
- `pipelineFingerprint(pipeline): string` → `sha256:${createHash("sha256").update(JSON.stringify(pipeline)).digest("hex")}` (`node:crypto`).
- `completedStepsFor(state, taskId, currentHash, { allowAborted }): ReadonlySet<string>` — puro; vazio se checkpoint ausente, hash diverge, ou `status:"aborted"` e `!allowAborted`.
- Transições puras `(state, ...) => RunState`: `recordStepIn`, `setStatusIn`, `clearTaskIn`, `pruneOrphansIn(state, knownTaskIds)`.
- `emptyState(): RunState` (`{ version: 1, tasks: {} }`).
- `loadState(path): RunState` — ausente → `emptyState()`; JSON inválido → `emptyState()` (tolera; nunca lança na fronteira).
- `saveState(path, state): void` — `mkdirSync(dirname, {recursive:true})`, grava `${path}.tmp`, `renameSync` por cima.

**Acceptance criteria:**
- [ ] `pipelineFingerprint` estável (mesmo pipeline → mesmo hash) e sensível a conteúdo (mudar prompt/comando/mode/ordem/id → hash muda).
- [ ] `completedStepsFor` respeita hash divergente e `allowAborted`.
- [ ] `saveState` nunca deixa `state.json` parcial (tmp+rename); `loadState` tolera ausência e corrupção.

**Verification:**
- [ ] `npx vitest run tests/resume/state.test.ts` verde.
- [ ] `npm run typecheck` e `npm run lint` verdes.

**Dependencies:** Nenhuma.
**Files:** `src/resume/state.ts` (novo), `src/types.ts`, `tests/resume/state.test.ts` (novo).
**Scope:** M (3 arquivos).

### Checkpoint A — Fundação
- [ ] `typecheck`/`lint`/`test` verdes; `state.test.ts` cobre fingerprint, `completedStepsFor` e I/O atômico. Nenhuma mudança no comportamento do loop ainda.

## Fase 2 — Resume no orquestrador (valor central: pular concluídos)

### T-021: `CheckpointPort` + resume em `runTaskPipeline`/`runLoop`

**Description:** A mecânica de resume no coração do motor, atrás de
`deps.checkpoint?` — ausente ⇒ comportamento idêntico ao atual.

**`src/loop/orchestrator.ts`:**
- `createCheckpointPort({ statePath, pipelineHash }): CheckpointPort` (molde de
  `createMarkDonePort`): mantém `state` em memória (`loadState` no início), aplica
  as transições puras de `state.ts` e `saveState` após cada mutação; carimba
  `pipelineHash` em `recordStep`/`setStatus`.
- `OrchestratorDeps`: `checkpoint?: CheckpointPort` e `knownTaskIds?: readonly string[]`.
- `runTaskPipeline` ganha `completedSteps: ReadonlySet<string>`:
  - No topo do laço: se `completedSteps.has(step.id)` → log `resume: step "X" já
    concluído` e `continue` (efeito preservado no worktree; conserta
    `create-worktree`, protege `cleanup`/`always` já feitos). **Antes** da lógica
    de skip por falha/keep_worktree.
  - Após **cada step ok**: `deps.checkpoint?.recordStep(task.id, step.id)`.
  - Novo parâmetro `completedSteps` (default `new Set()` quando o chamador não tem checkpoint).
- `runLoop` — reconciliação **antes** do laço (só se `deps.checkpoint`):
  - `pipelineHash = pipelineFingerprint(config.pipeline)`.
  - `deps.checkpoint.pruneOrphans(deps.knownTaskIds ?? [])` com log por órfão podado.
  - `state = read()`; para cada task em `tasks`, se há checkpoint com hash
    divergente → log de aviso (`resume: pipeline mudou desde o checkpoint de
    T-XXX — recomeçando`); `completedStepsFor(state, id, pipelineHash, {
    allowAborted: flags.task !== undefined })`.
  - Antes de `runTaskPipeline`: `setStatus(task.id, "running")`.
  - `markDone` (sucesso): `clearTask(task.id)`.
  - Escalação: `pause` → `setStatus(id,"paused")` antes de `finish("escalation_pause")`;
    `abort_loop` → `setStatus(id,"aborted")` antes de `finish("escalation_abort")`;
    `skip_task` → `clearTask(id)` antes de continuar.

**Acceptance criteria:**
- [ ] Checkpoint fake com `[create-worktree, implement, simplify, audit]` concluídos → esses steps **pulados** (log resume-skip), `commit` re-executa; nenhum concluído roda de novo.
- [ ] Checkpoint gravado após cada step ok; falha persistente grava `paused` (ou `aborted`/limpa conforme a ação); conclusão limpa a entrada.
- [ ] Hash divergente ⇒ `completedSteps` vazio ⇒ task do zero, com aviso.
- [ ] `running`/`paused` auto-retomam; `aborted` só com `allowAborted`.
- [ ] **Sem `checkpoint` em `deps`: comportamento idêntico ao atual.**

**Verification:**
- [ ] `npx vitest run tests/loop/run-loop.test.ts tests/loop/resume.test.ts` verde.
- [ ] `npm test` inteiro verde (regressão zero nos 405).
- [ ] `typecheck`/`lint` verdes.

**Dependencies:** T-020.
**Files:** `src/loop/orchestrator.ts`, `tests/loop/run-loop.test.ts` (estende skip/record/status), `tests/loop/resume.test.ts` (novo, E2E com CheckpointPort fake).
**Scope:** M (3 arquivos).

### Checkpoint B — Resume vivo (fake port)
- [ ] E2E de resume passa: parar num step → retomar → pular concluídos → refazer só o que faltou; status paused/running/aborted tratados; regressão zero. **Revisão humana antes da Fase 3.**

## Fase 3 — Superfície CLI (auto-resume real + `--clean`)

### T-022: wire `.loopy/state.json` no CLI + flag `--clean`

**Description:** Conecta o `CheckpointPort` real (disco) ao `runLoop` e adiciona
`--clean [T-XXX]` (teardown + sai, não roda o loop).

**`src/index.ts`:**
- `execute()`: manter o backlog completo — `const backlog = loadBacklog(...)`,
  `const pending = pendingTasks(backlog)` — para derivar `knownTaskIds`.
- `toFlags`: mapear `clean` de `--clean [id]` (`string | boolean | undefined`).
- `buildProgram`: `.option("--clean [id]", "teardown (worktree+branch+checkpoint) e sai; sem id usa a task com checkpoint pausado/em-progresso")`.
- Se `flags.clean` truthy → `cleanFlow` e retorna (não roda o loop):
  - alvo: com id explícito, essa task; sem id, a única entrada do `state.json` com
    status `paused`/`running` (0 ou >1 → erro claro pedindo id).
  - resolve o `Task` no backlog por id → `worktreePathFor(config, task)` + `task.branch`.
  - `git.removeWorktree(path, { force: true })` e `git.deleteBranch(branch)` em
    **best-effort** (tolera "não existe", loga); `clearTask(id)`.
  - imprime confirmação; retorna 0. Nunca apaga worktree por inferência — só aqui.
- `defaultRunLive`: `deps.checkpoint = createCheckpointPort({ statePath: resolvePath(root, ".loopy/state.json"), pipelineHash: pipelineFingerprint(config.pipeline) })` e `deps.knownTaskIds` (backlog completo via `RunLiveArgs`).

**Acceptance criteria:**
- [ ] **T-004 real (kill):** com `state.json` marcando os 4 primeiros steps, rodar `loopy` pula-os (resume-skip logado), `commit` re-executa, task conclui; nenhum `git worktree add` duplicado, nenhum "path already exists".
- [ ] `--task T-004` num checkpoint pausado retoma de onde parou.
- [ ] `--clean T-004` remove worktree + branch + entrada e **sai** (não roda o loop); rodar `loopy` de novo recomeça a T-004 limpa.
- [ ] Entrada órfã (task sumiu do backlog) é podada com aviso.

**Verification:**
- [ ] `npx vitest run tests/cli/resume.test.ts` verde.
- [ ] `npm test` inteiro verde.
- [ ] Manual: `npx tsx src/index.ts <dir> --clean T-XXX` derruba e sai; `npx tsx src/index.ts <dir>` auto-detecta e retoma.

**Dependencies:** T-021.
**Files:** `src/index.ts`, `tests/cli/resume.test.ts` (novo). (`worktree.ts` **sem mudança**.)
**Scope:** M (2 arquivos).

### Checkpoint C — Completo
- [ ] Todos os Success Criteria do spec atendidos (T-004 kill, escrita atômica, `todo.md` intocado, hash invalida checkpoint, auto-resume por status, `--task` retoma, `--clean` derruba+sai, órfãos podados, regressão zero).
- [ ] `typecheck`/`lint`/`test` verdes antes do commit.

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Resume quebrar os 405 testes | Alto | `checkpoint?` opcional; sem ele, caminho idêntico. Suite inteira roda em cada task. |
| `create-worktree` colidir mesmo com resume | Alto | Skip do step concluído (não re-executa) é o conserto central; T-021 + T-022. |
| `--clean` apagar worktree errado | Médio | Só id explícito ou a única entrada pausada/em-progresso; >1 sem id → erro. Best-effort tolera ausência. |
| Editar `loopy.yml` retomar no step errado | Médio | `pipelineFingerprint` cobre ids+ordem+conteúdo; hash divergente invalida o checkpoint inteiro. |
| `state.json` corrompido/parcial | Médio | tmp+rename atômico; `loadState` tolera JSON inválido → estado vazio. |

## Verificação end-to-end

1. `npm test` — suite inteira verde (regressão zero; alvo 405 + novos).
2. `npx vitest run tests/resume/state.test.ts tests/loop/resume.test.ts tests/cli/resume.test.ts`.
3. Manual num repo-alvo: parar num step (ou simular via `state.json`), depois `npx tsx src/index.ts <dir>` e conferir logs `resume: step "X" já concluído` + `commit` re-executando sem "path already exists".
4. `npx tsx src/index.ts <dir> --clean T-XXX` → confirma teardown e saída sem rodar o loop; `git worktree list` e `git branch` limpos.

## Open Questions (do spec, já resolvidas)

- OQ-R1: zero-config, `.loopy/state.json` por convenção. OQ-R2: SIGINT/SIGTERM
  gracioso fica para v2. OQ-R3: `--clean` respeita escopo de seleção.
