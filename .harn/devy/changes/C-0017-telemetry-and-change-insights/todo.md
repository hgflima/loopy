# Backlog: C-0017 — Telemetria SQLite (coleta insert-only, bugs, veredito humano, aba Insights)

> Consumido pelo motor (`- [ ]` pendente / `- [x]` concluída; id `T-\d+`; corpo indentado).
> Narrativa, grafo de dependências, checkpoints e riscos: ver `plan.md` (mesma pasta); as 27 decisões
> em `spec.md`.
> **A cadeia do motor (T-004→T-007) e a CLI (T-008) compartilham `orchestrator.ts`/`index.ts`** — as
> arestas serializam de propósito para não conflitar no merge. **Não remover.** As cruzadas
> `T-004→T-003` (desmontar antes de instrumentar) e `T-011→T-010` (mesmo motivo no app) idem.
> **Invariantes:** insert-only para step/task (UPDATE só na dimensão `change`); a coleta **nunca lança**
> (best-effort → NULL); gate opt-in por `metrics:` (sem o bloco, nenhum `.db`, `RunLoopResult`
> byte-idêntico — AD-1); jamais serializar `resolvedEnv`/`process.env` no `resolved_json`.
> Cada linha `Deps:` fica **isolada, ids limpos, sem ponto final** (bug D-0001 do `parseDeps`).

## Fase 1 — Fundação & desmonte

- [x] T-001: Adapter SQLite runtime-guarded (`src/telemetry/db.ts`)
    `src/telemetry/db.ts`: `openDb(path): Promise<TelemetryDb>` escolhe o driver por runtime —
    `bun:sqlite` (`typeof Bun !== "undefined"`) ou `node:sqlite` (`DatabaseSync`, Node ≥22.13), ambos
    por `import(...)` dinâmico. Seta os pragmas **1× no bootstrap** (D8):
    `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;`. Devolve um `wrap` com
    shape comum `{ prepare, run, all, close }` (as duas APIs convergem). É a **única** linha que conhece
    o runtime; nenhum outro arquivo importa `node:sqlite`/`bun:sqlite`.
    `tsup.config.ts`: adicionar `external: ["bun:sqlite"]` (esbuild não resolve o módulo Bun; o
    `import("node:sqlite")` morto é tolerado sem tree-shaking).
    `package.json`: `engines.node` `>=20` → `>=22.13` (Node 20 é EOL; `node:sqlite` não existe nele).
    Teste: abre `.db` temporário, WAL persistente (2º open não re-executa o pragma), close idempotente.

- [x] T-002: Schema, views e hashes de identidade (`schema.sql` + `schema.ts`)
    `src/telemetry/schema.sql`: a DDL completa da `spec.md` (tabelas `agent_config`, `price`, `change`,
    `task`, `step`, `task_verdict`, `bug` + índices) e as views (`v_step`, `v_task` por-tentativa,
    `v_change`, `v_change_baseline` com desvio à mão `sqrt(avg(x*x)-avg(x)*avg(x))` D17, `v_task_bugs`,
    `v_step_repriced`). Fonte única aplicada idempotente.
    `src/telemetry/schema.ts`: `bootstrap(db)` via `user_version` + `CREATE TABLE IF NOT EXISTS`;
    helpers de identidade com `node:crypto` (funciona nos dois runtimes): `promptVersion(step)` =
    `sha256` do template `step.prompt`(+`retry_prompt`) **pré-interpolação** (o mesmo que `selectPrompt`
    escolhe, `interp/resolver.ts:192`); `configId({preset,model,mode,effort,promptVersion})` = `sha256`
    dos resolvidos; `pipelineVersion` **reusa** `pipelineFingerprint` (`resume/state.ts:25`);
    `resolvedJson(agentDef)` serializa a **forma declarada** (`AgentDef` com templates `${env.KEY}`, via
    o caminho do `serialize.ts`) — **nunca** `resolvedEnv`.
    Testes: bootstrap idempotente (2×, sem erro); `config_id` estável p/ igual e distinto p/ diferente;
    `resolved_json` **não** contém valores de `process.env`; as 6 views retornam num `.db` semeado à mão
    (fixture com change de ≥2 tasks e um fix-loop `visit_no≥2`).
    Deps: T-001

- [x] T-003: Desmontar `src/metrics/` + remover `RunLoopResult.metrics` + D21 (aterrissar verde, OFF)
    Deleção pura, sistema verde com telemetria desligada — **libera o acumulador `drainUsage`** que a
    Fase 2 vai reusar. Remover o diretório `src/metrics/` inteiro (folds/store/report/change-report/
    format/index/CLAUDE.md). Do `orchestrator.ts`: `stepSamples`/`recordSample` (`:890-899`), o drain em
    `timedExecute` (`:938-942`), o build de `TaskMetrics` (`:1183-1196`), `RunLoopResult.metrics`
    (`:1240`) + o `RunMetrics` de `finish()` (`:1364-1383`), o import `../metrics/folds` (`:40`). Do
    `types.ts`: `Sample`/`StepMetrics`/`TaskMetrics`/`RunMetrics`/`ChangeMetrics`/`MetricsSummary`
    (**manter `TurnUsage`/`StepCost`** — usados pela sessão ACP). Do `index.ts`: o import de métricas
    (`:75-81`) e o bloco "4) Metrics" (`:840-866`).
    D21: `metricsSchema.report` continua `optional()` em `config/schema.ts`, mas o motor o **ignora** e
    emite **warning de deprecação** em `src/config/warnings.ts` (ymls deste repo e `examples/` seguem
    parseando; a shape do `@hgflima/loopy/config` não quebra).
    Testes: deletar `tests/metrics/*`, `tests/cli/metrics.test.ts`, o `describe` de métricas
    (`tests/loop/orchestrator.test.ts:291-690`), e `EMPTY_METRICS`/`mkRunMetrics` em
    `tests/cli/{live,resume}.test.ts`. Aceite: `npm run typecheck && npm run lint && npm test` verdes; um
    run já não escreve `.loopy/metrics.json`, Run report em stderr nem `index.md`.

## Fase 2 — Coleta de fatos (motor)

- [x] T-004: Port de telemetria + gravador por-Visita + linhas não-agente + lifecycle
    `src/telemetry/write.ts`: o INSERT físico (o único escritor de fatos) — `insertStep`,
    `insertAgentConfig` (INSERT OR IGNORE), com `seq` derivado na sentença
    (`COALESCE((SELECT MAX(seq) FROM step WHERE task_id=:tid),0)+1`, D25). Envolto em try/catch estilo
    `safeEmit` — nunca lança.
    `types.ts`: `+telemetry?` em `StepContext` (junto de `emit?`, `:680`) e `OrchestratorDeps` (junto de
    `emit?`, `:784`).
    `orchestrator.ts`: em `buildTaskStepContext` (`:824-849`) ligar o gravador por-Visita fechado sobre
    `{ taskId, changeId, stepName, kind, visitNo=visits[step.id], configId, now=deps.now }`; garantir
    `agent_config` (INSERT OR IGNORE) **antes** da 1ª linha `step` (FK); em `timedExecute` chamar
    `recorder.finalize()` que, **sem** tentativas empurradas (shell/checks/approval), insere **1 linha de
    Visita** (`status` de `result.ok`, `attempt_no=1`, tokens/cost/`config_id` NULL).
    `index.ts`: abrir o DB gated por `config.metrics` no assembly de `defaultRunLive` (`:516-714`, path
    `resolvePath(root,".db/telemetry.db")`), injetar `deps.telemetry`, fechar no `finally` (`:726-733`).
    Aceite: run com `metrics:` cria `.db` com linhas de Visita dos steps não-agente; run sem `metrics:`
    **não** cria `.db`; falha de DB não derruba step.
    Deps: T-002, T-003

- [x] T-005: Dimensão `change` (INSERT OR IGNORE no início + UPDATE `merged` no fim)
    `orchestrator.ts` (início de `runLoop`, `:1348-1401`): INSERT OR IGNORE da `change` —
    `change_id` = prefixo `C-\d+` de `basename(dirname(inputs.todo))` (espelha `deriveChange:116`);
    `name` = slug do dir (fallback `config.name` quando dir=`.`); `repo` = origin/basename;
    `base_sha` = `git rev-parse HEAD` do parent; `pipeline_version` = `pipelineFingerprint(pipeline)`;
    `created_at`, `ended_at`/`status` NULL (em andamento).
    `src/git/*`: `GitPort.revParseHead()` + origin (best-effort → NULL).
    `index.ts` (`runLiveFlow`, `:852-864`): UPDATE `status='merged'`+`ended_at` no **mesmo** gate de
    fim-de-change de hoje (re-parse do `todo.md` → 0 pendentes) — **não** no `runLoop`. Substitui a
    persistência de `metrics.json`/`index.md` que a T-003 removeu.
    Aceite: change aparece desde o início (`status NULL`); vira `merged` ao zerar o backlog; FK
    `task.change_id` resolve.
    Deps: T-004

- [x] T-006: Linha `task` + `size_*` via `git diff --numstat`
    `src/git/*`: `GitPort.diffNumstat(base, head) → {files,added,removed}|null` (best-effort).
    `orchestrator.ts`: capturar o numstat `base_sha .. task.branch` **antes** do loop de teardown
    (`runTaskPipeline:1138`, com o branch/worktree ainda vivos — o `cleanup` do yml os apaga ali) e
    guardar no `PipelineRunResult` interno (`:858-861`, tipo interno, pode ganhar `sizeChurn?`);
    inserir a linha `task` em `launchTask` **após** `markDoneWithMutex` (`:1525`): `status='merged'`
    (sucesso) ou `'failed'` (escalação); **paused/skipped/cancelled → sem linha**; `size_*` NULL p/
    `failed`.
    Aceite: cada task terminal grava 1 linha com `size_*` correto; teardown não zera o churn;
    `SUM(step.cost_usd)` da task bate (D-0008).
    Deps: T-005

- [x] T-007: Instrumentação por-Tentativa (`agent.ts`) + `human_seconds` (`approval.ts`)
    ⚠️ fatia de maior risco — construída por último sobre pipeline validado.
    `agent.ts` (loop `:232-282`): acumular por tentativa `{ attemptNo, startedAt, endedAt, status,
    failReason, failDetail, usage, costDelta }`. `usage = ctx.session.drainUsage()` **uma vez por
    tentativa**, logo após `prompt()` (`:250`). `costDelta` (D10): `before=readCost()` no início da
    tentativa (após `clear()` `:241`), `after=readCost()` após `prompt()`; delta só com ambos non-null,
    senão NULL. **Flush** para `ctx.telemetry` nos 3 pontos de saída: não-`end_turn` (`:255`), verify
    esgotado (`:290`), e **após `applyVerdictGate` (`:298`)** — o expect-fail só é conhecido pós-loop.
    `finalize` insere N linhas e **nunca** re-drena (sem linha-fantasma de 0 tokens).
    `fail_reason` (heurístico, D5): nome do check reprovado (`test|spec`→`test-fail`, `type|tsc`→
    `type-error`, `lint|eslint`→`lint-fail`, `build`→`build-fail`; 1º reprovado vence), verdict gate →
    `expect-fail`, stopReason não-`end_turn` → `infra`; sem match → NULL + `fail_detail`. `status` enum
    (`pass/fail/error/timeout/cancelled/crashed`) via `result.ok`+`classifyStopReason`.
    `approval.ts`: `human_seconds` (D12) = bracket no `await ctx.ui.requestApproval` (`:102`), usando o
    `now` do gravador (determinismo); NULL sob `--yes` (`:98`); `fail_reason='human-rejected'` na
    rejeição (`:105`). Entregue pelo mesmo gravador (`ctx.telemetry?.setHumanSeconds/setFailReason`).
    Aceite: step de agente com fix-loop grava 1 linha **por tentativa** com tokens/custo/duração
    próprios; delta de custo correto **através de `clear_context`**; `human_seconds` só no approval e
    NULL sob `--yes`.
    Deps: T-006

## Fase 3 — CLI de anotações

- [ ] T-008: `annotate.ts` + `query.ts` + subcomandos CLI (verdict/bug/change)
    `src/telemetry/annotate.ts`: upsert `task_verdict` (muda `by`/`at`), insert `bug`, UPDATE de
    `change.status`. `src/telemetry/query.ts`: SELECTs tipados internos p/ reuso pelo `annotate` — **não**
    é superfície de leitura CLI (D19; a GUI lê pelo Rust).
    `index.ts` (subcomandos, padrão `probe-agent`): `verdict set --task <id> --pass|--fail [--note]
    [--by]` (upsert; `--by` default `git config user.name` → `$USER`); `verdict clear --task <id>`
    (DELETE → tri-estado NULL, D20); `bug add --task <id> --severity <s> --title <t> [--detail]
    [--found-in]` (FK `bug.task_id`, sem restrição de change — bug de change anterior é o caso normal);
    `change --abandoned|--failed [--change <id>]` (o único UPDATE fora do INSERT OR IGNORE inicial).
    Aceite: `verdict set` faz upsert; `verdict clear` remove a linha; `bug add` de change anterior liga à
    task; `change --abandoned` fecha a dimensão.
    Deps: T-007

## Fase 4 — Ponte GUI (Rust)

- [ ] T-009: `telemetry.rs` — `rusqlite` leitura SELECT-only + escrita por subprocesso
    `apps/menubar/src-tauri/Cargo.toml`: adicionar `rusqlite` (feature `bundled`) em `[dependencies]`.
    `apps/menubar/src-tauri/src/telemetry.rs`: comandos `#[tauri::command]` SELECT-only nas views lendo
    `<dir>/.db/telemetry.db` (`read_change_insights`, `read_task_insights`, `read_change_list`,
    `read_baseline`) — **degrada graciosamente** (resposta vazia, sem crash) quando o `.db` não existe
    (OQ3); comandos de escrita (`insights_set_verdict`, `insights_add_bug`, `insights_set_change_status`)
    que spawnam `loopy verdict|bug|change` one-shot (padrão `probe_agent` `project_fs.rs:94-147`, com
    `resolve_sidecar_path`+`login_shell_path`). Registrar todos no `generate_handler!` (`main.rs:285-305`)
    + os imports.
    Aceite: comandos devolvem linhas de um `.db` semeado; escrita invoca o CLI e retorna ok; `.db`
    ausente → vazio sem crash. Verificar com `cargo build` no `src-tauri`.
    Deps: T-008

## Fase 5 — Aba Insights (React)

- [x] T-010: View-model puro + testes (`apps/menubar/src/insights/*.ts`)
    Módulos `.ts` puros (sem montar Tauri, padrão `configToStore.test.ts`): mapeamento de linhas das
    views → view-model — Δ% da 3ª coluna, toggle absoluto↔normalizado por churn
    (`size_added+size_removed`), tri-estado do veredito (`pass`/`fail`/`null`), marca `estimated`
    (`cost_confidence`), contador `unrated`, e o **badge/filtro de defeito escapado** (D23):
    `status='merged' && human_verdict='fail'` (bônus: com bug aberto). Testes de unidade cobrindo
    delta%, normalização, tri-estado e o filtro.
    Aceite: `npm test -w apps/menubar -- insights` verde.
    Deps: T-002

- [ ] T-011: `InsightsPane` + hook + 4º segmento do `ViewSwitcher`
    `apps/menubar/src/insights/InsightsPane.tsx`+`.css` e `useInsights.ts` (invoke Rust, molde
    `useAgentCapabilities.ts`). `ViewSwitcher.tsx`: 4º segmento `insights` (`ViewId` `:24`, `SEGMENTS`
    `:26-30`, pane `display:none` `:111`). Cabeçalho de 3 colunas (esta change · média±desvio das merged
    · comparada com Δ%; 3ª col default = change merged anterior por `created_at` + dropdown, D22); toggle
    absoluto↔normalizado (nasce **absoluto**); marca `estimated`; contador `unrated`; lista de tasks com
    controle tri-estado que **expande nos passos** ao selecionar; badge + filtro de defeito escapado
    (D23). Write-back (verdict/`verdict clear`/bug) via os comandos Rust da T-009 (invoke). Funciona **em
    idle** (revisão fria) e durante o run. Testes de componente com `@tauri-apps/api/core` mockado.
    Aceite: os 4 Success Criteria da `spec.md` passam manualmente (`npm run dev -w apps/menubar`); aba
    degrada p/ "sem telemetria" sem `.db`.
    Deps: T-009, T-010

## Fase 6 — Documentação

- [ ] T-012: ADR-0011 + fecho do D-0008 + gitignore + docs
    ADR-0011 (via skill `adrs:create`): persistência SQLite + granularidade por-tentativa, **estendendo**
    a ADR-0003 (não revoga; o gate opt-in sobrevive). Marcar o **D-0008** como pago (o custo por
    Run/Change vira `SUM()`). `.gitignore` (deste repo e do alvo) ignora `.db/`. Atualizar `CLAUDE.md` +
    `docs/reference/*` (bump `engines`, aba Insights, aposentadoria de `metrics.json`/Relatório de
    execução/Relatório de change).
    Aceite: ADR-0011 `Accepted`; D-0008 fechado; `.db/` gitignored; docs coerentes; `npm run typecheck`
    verde.
    Deps: T-011
