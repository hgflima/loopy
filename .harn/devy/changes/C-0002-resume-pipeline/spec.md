# Spec: Resume de pipeline no `loopy`

> Feature spec derivada do `SPEC.md` do projeto. Mesmo invariante (AD-1): o motor
> é intérprete genérico; o resume é **mecânica** interpretada, nunca pipeline
> hardcodado. Onde esta spec e o `SPEC.md`-mãe divergirem, o `SPEC.md` vence para
> tudo que não seja resume.

## Objective

Tornar uma run do `loopy` **retomável a nível de step**. Hoje o resume só existe a
nível de **task** (o `todo.md` marca `- [x]` e `pendingTasks()` filtra os done —
tasks concluídas não são refeitas). Falta o caso em que a run para **no meio de
uma task**: hoje ela recomeça do zero e o primeiro step (`create-worktree`)
**falha**, porque o worktree/branch já existem (é o caso real da T-004, que parou
no step `commit`).

Depois desta feature:

- Ao recomeçar, o `loopy` **retoma a task parada a partir do primeiro step ainda
  não concluído**, pulando os steps já feitos (cujos efeitos estão preservados no
  worktree por `keep_worktree`).
- O progresso de cada task é **persistido atomicamente** em `.loopy/state.json`
  (fonte de verdade **única**, gitignored) **após cada step**.
- O `state.json` é a **única** fonte — o `todo.md` **não** é tocado ao parar (ver
  “Decisão de design: sem marcador”). Isso mantém o parent limpo entre tasks sem
  nenhuma reconciliação de marcador.
- Uma flag `--clean [T-XXX]` faz o **teardown** explícito (worktree + branch +
  checkpoint) para quem quer recomeçar do zero.

**Usuário:** o operador do `loopy` que rodou o motor contra um repo-alvo, foi
interrompido (escalation pause ou fechou o terminal / kill) e quer continuar de
onde parou sem refazer trabalho nem lidar manualmente com worktrees pendentes.

**Não-objetivo (v1):** checkpoint gracioso de SIGINT/SIGTERM com cancelamento do
turno ACP em voo (fica para v2 — ver OQ-R2); retomar no meio das tentativas do
inner-loop `verify` (granularidade é **step**, o `verify` sempre reinicia em
`attempt 1`).

## Enquadramento (o que o pedido esconde)

O pedido tem duas granularidades:
1. "Recomeçar da task em que parou" — **já existe** (task-level, via `todo.md`).
2. "Retomar do step do pipeline em que parou" — **novo** (step-level).

O trabalho real **não é persistir o progresso** (isso é trivial). É **retomar num
estado consistente** sem re-executar efeitos colaterais. A estratégia é **pular
os steps já concluídos**, não torná-los idempotentes um a um.

### Quais paradas deixam uma task no meio

Rastreando o `runLoop`, o `stop_signal_file` é checado **no topo da iteração,
antes de `runTaskPipeline`** — logo **stop-signal encerra entre tasks**, nunca no
meio de uma (parent já limpo, sem checkpoint parcial). Só **dois** caminhos deixam
uma task no meio:

- **escalation pause** — um step falhou persistentemente (`verify` esgotou
  `max_attempts`, ou `audit` deu FAIL). Encerra de forma graciosa; grava
  `status: "paused"`.
- **kill abrupto** (terminal fechado, SIGKILL) — o processo morre; sobrevive só o
  `state.json` (gravado após cada step ok), com o último `status: "running"`.

`skip_task` e `abort_loop` **não** deixam um checkpoint auto-retomável (ver
“Ciclo de vida do checkpoint”).

## Tech Stack

Sem novas dependências. TypeScript estrito (`noUncheckedIndexedAccess`), Node ≥ 20
(`node:fs`, `node:crypto` para o fingerprint, `node:path`), vitest. Mesmo estilo e
tooling do motor (eslint + prettier).

## Commands

```
Typecheck: npm run typecheck
Lint:      npm run lint
Test:      npm test
Test 1:    npx vitest run tests/resume/state.test.ts
Dry-run:   npx tsx src/index.ts <dir> --dry-run
Resume:    npx tsx src/index.ts <dir>                 # auto-detecta e retoma
Task:      npx tsx src/index.ts <dir> --task T-004    # retoma essa task isolada
Clean:     npx tsx src/index.ts <dir> --clean T-004   # teardown e sai (recomeço)
```

## Design

### Fonte de verdade — `.loopy/state.json` (gitignored)

Gravado no **root do repo-alvo** (junto de `.worktrees/` e `.loopy/logs/`; já
coberto pelo `.gitignore`). Caminho fixo por convenção — **zero-config**, sem bloco
`resume:` no `loopy.yml` (ver OQ-R1). Escrita **atômica**: grava em
`state.json.tmp` e `rename` por cima (matar no meio nunca deixa um JSON inválido).

```jsonc
{
  "version": 1,
  "tasks": {
    "T-004": {
      "pipelineHash": "sha256:…",          // fingerprint do pipeline (ids + conteúdo)
      "completedSteps": ["create-worktree", "implement", "simplify", "audit"],
      "status": "paused"                    // running | paused | aborted
    }
  }
}
```

- `completedSteps` é a informação mínima; `nextStep` é **derivado** (primeiro step
  do `pipeline` que não está em `completedSteps`).
- **`status`** distingue o tratamento na reconciliação:
  - `running` — task em progresso (setado quando a task começa). O **kill** deixa
    este valor. → **auto-retoma**.
  - `paused` — escalation pause. → **auto-retoma**.
  - `aborted` — escalation `abort_loop`. → **não** auto-retoma; só via `--task`
    explícito.
  - `skip_task` e **conclusão** (`markDone`) **apagam a entrada** — checkpoint
    presente sempre significa “há trabalho parcial de uma task não-concluída”.
- **Fingerprint (`pipelineHash`)**: hash **do pipeline serializado — ids, ordem E o
  conteúdo de cada step** (prompt/comandos/mode/verify…), via
  `sha256(JSON.stringify(pipeline))`. Se o hash gravado **diverge** do pipeline
  atual (você editou o `loopy.yml`), o checkpoint da task é **invalidado**: a task
  recomeça do zero, com um aviso claro. Cobrir o conteúdo (não só os ids) impede o
  caso silencioso de você editar o prompt de um step, manter o `id`, e o resume
  **pular** esse step achando que está feito — sua edição seria ignorada.
  Trade-off aceito: editar **qualquer** step invalida o checkpoint da task pausada
  inteira (tasks pausadas são raras e você quer sua edição aplicada).

### Decisão de design: sem marcador no `todo.md`

A versão anterior desta spec escrevia um marcador `<!-- loopy: … -->` no `todo.md`
ao parar. **Cortado.** Racional:

- O `state.json` já carrega **toda** a informação de resume — o marcador é
  redundante.
- O único caminho que conseguiria escrevê-lo é o **escalation pause** (o kill não
  tem chance; o stop-signal não deixa task no meio). E nesse ponto **o parent já
  está limpo** (nem `commit` nem `merge` rodaram), então não há colisão real com
  `require_clean_parent` a resolver.
- Escrever no `todo.md` **suja o parent** — criando exatamente o problema que o
  marcador depois precisava “reconciliar antes do gate”.

Cortá-lo elimina três fontes de complexidade e risco: sujar o parent, filtrar a
linha do `${task.body}` (risco de vazar pro prompt do agente) e reconciliar o
marcador antes do gate `require_clean_parent`. O “reflexo legível” do progresso
fica nos **logs** e no próprio `state.json`.

**Consequência:** o parser de `todo.md` (`backlog/todo.ts`) **não muda** — nenhuma
lógica de ignorar comentários, nenhum novo teste de vazamento.

### Fluxo de execução

**`runTaskPipeline`** ganha `completedSteps: ReadonlySet<string>`:
- Um step em `completedSteps` é **pulado** com log `resume: step "X" já concluído`
  (efeito preservado no worktree). Isso conserta `create-worktree` (pulado, não
  re-executado → sem "path already exists") e protege `cleanup`/`always` já feitos.
- O primeiro step fora de `completedSteps` é o **ponto de retomada**; ele
  **re-executa do início** (é justamente o step que falhou, no caso pause). Pular
  os concluídos e refazer só o que faltou é o contrato — quem quiser refazer a task
  inteira usa `--clean`. Comandos no ponto de retomada devem tolerar re-execução
  (o `commit` do exemplo: `git add -A` é idempotente; `git commit` após o add roda
  uma vez só) — documentado como contrato, não enforçado.
- Após **cada step ok**, grava o checkpoint (via port) e persiste o `state.json`.

**`runLoop`** ganha uma fase de **reconciliação de resume** (antes do laço):
carrega `state.json`; **poda entradas órfãs** (taskId sem checkbox correspondente
no backlog) com um log de aviso; e para cada task pendente resolve seu
`completedSteps` (respeitando o `pipelineHash` e o `status`). Ao `markDone`,
**limpa o checkpoint** daquela task. Ao **parar**, grava o `status` conforme a
causa (`paused` no escalation pause, `aborted` no `abort_loop`; `skip_task` limpa
o checkpoint).

**Novo port `CheckpointPort`** (espelha `MarkDonePort` — mantém o loop testável sem
disco): `read()`, `recordStep(taskId, stepId, pipelineHash)`,
`setStatus(taskId, status)`, `clearTask(taskId)`, `pruneOrphans(knownTaskIds)`.

### CLI

- **Sem flag: auto-resume** — se há checkpoint com `status` `running`/`paused`,
  retoma; `aborted` e ausência de checkpoint comportam-se como hoje.
- **`--task T-XXX`**: roda a task isolada e **retoma** o checkpoint dela se existir
  (inclusive `aborted`). Recomeçar do zero = `--clean T-XXX` e depois `--task`.
- **`--clean [T-XXX]`** (NOVO): **teardown e sai**. Remove worktree + branch +
  entrada no `state.json` da task alvo (sem argumento: a task com checkpoint
  pausado/em-progresso). **Não roda** o loop — o operador roda `loopy` de novo
  quando quiser, e a task recomeça limpa do `create-worktree`. Worktree órfão só é
  removido por aqui (nunca por inferência na reconciliação).
- **`--restart` removido**: substituído pelo par `--clean` + rodar de novo.

### Config-driven (AD-1)

**Zero-config.** Nenhum bloco novo no `loopy.yml`; o `state.json` mora em
`.loopy/state.json` por convenção (mesmo diretório já gitignored de `.loopy/logs`).
Se surgir demanda real de customizar o caminho, adiciona-se um bloco `resume:`
depois — barato e não-quebrante.

## Project Structure

```
src/resume/state.ts        → NOVO: RunState/TaskCheckpoint, fingerprint (ids +
                             conteúdo), load/save atômico, completedStepsFor
                             (respeita hash + status), record/setStatus/clear/
                             pruneOrphans
src/loop/orchestrator.ts   → MOD: runTaskPipeline pula completedSteps + grava
                             checkpoint por step; runLoop reconcilia no início
                             (poda órfãos), seta status ao parar, limpa ao
                             concluir; CheckpointPort
src/index.ts               → MOD: flags --clean (teardown+sai) e wire do
                             CheckpointPort com .loopy/state.json; --task retoma
src/git/worktree.ts        → MOD (se preciso): teardown de worktree+branch para
                             --clean (reusa removeWorktree + branch -D)
src/types.ts               → MOD: RunState, TaskCheckpoint, CheckpointPort,
                             RunFlags.clean (string | boolean)
src/config/schema.ts       → SEM MUDANÇA (zero-config)
loopy.yml                  → SEM MUDANÇA (nenhum bloco resume:)
todo.ts / backlog          → SEM MUDANÇA (sem marcador → sem filtro de comentário)

tests/resume/state.test.ts       → NOVO: fingerprint estável e sensível a
                                   conteúdo; divergência invalida; load/save
                                   atômico; record/setStatus/clear/pruneOrphans
tests/loop/orchestrator.test.ts  → MOD: pula completedSteps; grava por step;
                                   hash divergente ignora checkpoint; status
                                   paused/running auto-retoma, aborted não
tests/loop/resume.test.ts        → NOVO: E2E — parar num step, retomar,
                                   pular concluídos, retomar do que faltou
tests/cli/resume.test.ts         → NOVO: auto-resume detecta; --task retoma;
                                   --clean derruba worktree+branch+checkpoint e sai
```

## Code Style

Módulo puro + wrapper de I/O, no molde de `backlog/todo.ts` (`parse*`/`*InFile`) e
`config/load.ts` (`parseConfig`/`loadConfig`). Erros como valores nas fronteiras de
step (AD-5). Ports para efeitos externos (AD-4). Exemplo do que se espera:

```ts
/** Fingerprint estável do pipeline: muda se ids, ordem OU conteúdo de qualquer step mudarem. */
export function pipelineFingerprint(pipeline: readonly StepConfig[]): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(pipeline)).digest("hex")}`;
}

/**
 * Steps já concluídos de uma task — vazio se o pipeline mudou (hash diverge) ou se
 * o checkpoint não é auto-retomável (`status: "aborted"` só retoma via `--task`).
 */
export function completedStepsFor(
  state: RunState,
  taskId: string,
  currentHash: string,
  opts: { readonly allowAborted: boolean },
): ReadonlySet<string> {
  const cp = state.tasks[taskId];
  if (cp === undefined || cp.pipelineHash !== currentHash) return new Set();
  if (cp.status === "aborted" && !opts.allowAborted) return new Set();
  return new Set(cp.completedSteps);
}

/** Escrita atômica: nunca deixa um state.json parcial/corrompido. */
export function saveState(path: string, state: RunState): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, path);
}
```

## Testing Strategy

vitest, testes espelhando o layout de `src/`. Unidade nas funções puras
(`state.ts`); orquestração via ports fake (sem disco/git, como os testes atuais de
`runLoop`); um E2E de resume e um de CLI. **Regressão zero** é critério: os 405
testes atuais continuam verdes sem alteração de comportamento quando não há
checkpoint.

## Boundaries

- **Always:** escrita atômica do `state.json` (tmp + rename); checkpoint após cada
  step; `--clean` remove worktree + branch + entrada no state e **sai** (não roda o
  loop); usar `git` via argv (nunca `sh -c`) — o título da T-004 tem `${...}`
  literal (ver `loopy-shell-argv-no-shell`); rodar `typecheck`+`lint`+`test` antes
  de commit.
- **Ask first:** mudar a semântica de `isParentClean`/`require_clean_parent`;
  reintroduzir qualquer escrita no `todo.md` além do `markDone` existente;
  adicionar dependência (fingerprint usa `node:crypto`, não precisa de dep);
  adicionar o bloco `resume:` no schema.
- **Never:** sujar o parent (o `todo.md` **não** é tocado ao parar); escrever
  marcador no `todo.md`; re-executar `cleanup` (ou qualquer `always` já concluído)
  num resume que já passou dele; commitar por step; apagar worktree por inferência
  (só via `--clean` explícito); hardcodar ordem/comportamento do pipeline no motor
  (AD-1).

## Success Criteria

1. **T-004 real (kill):** parada no step `commit`, ao rodar `loopy` de novo os
   steps `create-worktree/implement/simplify/audit` são **pulados** (logados como
   resume-skip), `commit` re-executa e a task conclui. **Nenhum** `git worktree
   add` duplicado; nenhum "path already exists".
2. `.loopy/state.json` é gravado atomicamente após **cada** step; matar o processo
   durante a gravação nunca deixa um arquivo inválido.
3. O `todo.md` **não** é modificado ao parar; o parent permanece limpo e
   `require_clean_parent` não é afetado pela feature.
4. Editar o `pipeline` (add/remove/reordenar step **ou mudar o conteúdo de um
   step**) **invalida** o checkpoint da task (hash diverge) → a task recomeça do
   zero com aviso; nenhum resume no step errado.
5. **Auto-resume seletivo por status:** `paused`/`running` auto-retomam;
   `aborted` só retoma via `--task`; `skip_task`/conclusão apagam a entrada.
6. **`--task T-004`** num checkpoint pausado **retoma** de onde parou (não
   recomeça).
7. **`--clean T-004`** remove worktree + branch + checkpoint e **sai**; rodar
   `loopy` de novo recomeça a T-004 limpa.
8. **Reconciliação:** entrada órfã (task sumiu do backlog) é **podada** do
   `state.json` com aviso; worktree órfão fica até um `--clean` explícito.
9. **Regressão zero:** sem checkpoint, comportamento idêntico ao atual; os 405
   testes existentes continuam verdes.

## Open Questions

- **OQ-R1 (resolvido):** sem bloco `resume:` — **zero-config**. O `state.json` mora
  em `.loopy/state.json` por convenção. Reabrir só se surgir demanda de path
  customizável.
- **OQ-R2 (resolvido):** SIGINT/SIGTERM gracioso (cancelar turno ACP + checkpoint
  no sinal) fica **fora da v1** → abrir como item de v2. O `state.json`-após-cada-
  step já torna o kill seguro; falta só cancelar o turno ACP em voo.
- **OQ-R3 (resolvido):** `--clean` respeita o escopo de seleção — com `T-XXX` opera
  só naquela task; sem argumento, na task com checkpoint pausado/em-progresso.
```
