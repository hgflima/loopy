# Backlog: C-0014 — Editor visual do `loopy.yml`

> Consumido pelo motor (`- [ ]` pendente / `- [x]` concluída; id `T-\d+`; corpo indentado).
> Narrativa, grafo de dependências, checkpoints e riscos: ver `plan.md` (mesma pasta).
> **Validação = zod do motor, sempre** (SC5) — nenhuma regra reimplementada no front.
> Cada linha `Deps:` fica **isolada, ids limpos, sem ponto final** (bug D-0001 do parseDeps).
> Motor (`src/`) só ganha superfície aditiva pura (AD-1 intacto): barrels + `serializeConfig` + template.

## Fase 0 — Superfície pura do motor (T-001 → T-002)

- [x] T-001: `serializeConfig` + `parseConfigSource` + template canônico em `src/config` (puro) — DE-RISCO
    NOVO `src/config/serialize.ts`: (1) função pura `serializeConfig(config: LoopyConfigParsed):
    string` que emite YAML via `yaml.stringify` numa **ordem canônica de seções** = ordem do
    `loopyConfigSchema` (`version, name, workspace, agents, acp, inputs, checks, pipeline,
    stop_conditions, concurrency, policies, logging, metrics`), espelhando `examples/loopy.yml`. NÃO
    preserva comentários (aceito — mitigado por backup). NÃO inclui campos derivados de runtime
    (`resolvedAgents`). (2) função pura **`parseConfigSource(source: string): unknown`** (só
    `yaml.parse`, **sem** validação zod nem `node:fs`) — o read-counterpart browser-safe de
    `serializeConfig`, usado pelo app p/ obter o objeto cru antes da validação (D5, decisão aprovada).
    (3) NOVO `initialConfigTemplate: LoopyConfigParsed` — template **mínimo VÁLIDO** dono do motor
    (R1): 1 agente OU `acp.command`, pipeline com ≥1 step, todos os required preenchidos,
    `stop_conditions`/`policies`/`logging` plausíveis. `serialize.test.ts`: (a)
    `serializeConfig(initialConfigTemplate)` produz YAML que `parseConfig(...)` re-parseia sem lançar
    e o objeto re-parseado bate com o template (round-trip); (b)
    `loopyConfigSchema.safeParse(initialConfigTemplate).success === true`; (c) ordem das chaves
    top-level no YAML = ordem canônica; (d) `parseConfigSource(serializeConfig(template))` devolve um
    objeto (não lança) e `parseConfigSource("chave: [inválido")` também não estoura como schema (é só
    parse de YAML — erro de sintaxe YAML é aceitável lançar; documentar).
    Aceite: `serializeConfig`+`parseConfigSource` puros (sem `node:fs`/I/O); ordem canônica;
    `initialConfigTemplate` VÁLIDO por schema e round-trip; sem campos de runtime no YAML.
    Verificação: `npm run typecheck && npm test`.
    Deps: nenhuma
    Files: src/config/serialize.ts, src/config/serialize.test.ts
    Scope: S

- [x] T-002: Barrels `loopy/config` + `loopy/backlog` (+ exports/tsup) browser-safe
    NOVO `src/config/index.ts` re-exporta **só a superfície pura**: `loopyConfigSchema`,
    `parseConfig`, `ConfigError` (de `./load`), `serializeConfig`, `parseConfigSource`,
    `initialConfigTemplate` (de `./serialize`) e os tipos (`LoopyConfigParsed`). **NUNCA**
    `loadConfig` (usa `node:fs`). NOVO
    `src/backlog/index.ts` re-exporta **só** `parseBacklog`, `backlogOptionsFrom` e os tipos
    (`Task`, `BacklogOptions`) de `./todo`. **NUNCA** `loadBacklog`/`markDoneInFile`. Adicionar em
    `package.json` `exports` os subpaths `"./config"` e `"./backlog"` (padrão `{types,import}` como
    `./tui/*`, apontando `dist/config/index.*`/`dist/backlog/index.*`), e em `tsup.config.ts` os
    entries `"config/index": "src/config/index.ts"` e `"backlog/index": "src/backlog/index.ts"` no
    bloco com `dts:true`. Rodar `npm run build` na raiz. Como o app resolve `loopy/*` para o SOURCE
    (Vite/tsc alias), os barrels já habilitam os imports do app; os exports/tsup são p/ o pacote
    publicado + prova de browser-safety.
    Aceite: `import { loopyConfigSchema, parseConfig, serializeConfig, parseConfigSource,
    initialConfigTemplate } from "loopy/config"` e `{ parseBacklog, backlogOptionsFrom } from
    "loopy/backlog"` resolvem no app;
    o build gera `dist/config/index.js` + `dist/backlog/index.js` **sem** `node:fs` (tree-shaken);
    `npm test`/`typecheck` da raiz seguem verdes.
    Verificação: `npm run build && npm run typecheck && npm test` && `! grep -R "node:fs" dist/config/index.js dist/backlog/index.js`.
    Deps: T-001
    Files: src/config/index.ts, src/backlog/index.ts, package.json, tsup.config.ts
    Scope: S

## Fase 1 — Board no idle a partir do `loopy.yml` (T-003 ∥ T-004 → T-005 → T-006)

- [x] T-003: `configToStore` puro (config + backlog → `StoreState` preview)
    NOVO `apps/menubar/src/config/configToStore.ts`: função pura `configToStore(config:
    LoopyConfigParsed, tasks: readonly Task[]): StoreState` (tipos de `loopy/config` e
    `loopy/backlog`; `StoreState`/`TaskState` de `loopy/tui/store`) que replica o efeito de
    `pipeline_declared`+`edges_set`+`task_registered` sem rodar: `pipeline =
    config.pipeline.map(s => ({ id: s.id, type: s.type }))`; `tasks = tasks.map(t => TaskState com
    status "pending" (ou "blocked" se t.deps.length>0, espelhando o orchestrator), description do
    body, deps, sem currentStepId, steps:[], stream vazio)`; `edges = tasks.flatMap(t => t.deps.map(d
    => [d, t.id]))`; `acpLog:[]`, `activeAgents:new Set()`. Sem currentStepId + não-terminal ⇒ todos
    os cards caem no **Backlog** (conferido contra `grouper.ts`). `configToStore.test.ts`: colunas
    derivadas = steps na ordem; N cards no Backlog; edges = arestas das deps; pipeline vazio ⇒ só
    Backlog+Fim; tasks vazias ⇒ zero cards.
    Aceite: função pura; `pipeline` reflete `config.pipeline` (id+type, ordem); cards no Backlog;
    edges das deps; degradação p/ vazio; nenhuma dependência de React/Tauri.
    Verificação: `npm test -w apps/menubar -- configToStore && npm run typecheck -w apps/menubar`.
    Deps: T-002
    Files: apps/menubar/src/config/configToStore.ts, apps/menubar/src/config/configToStore.test.ts
    Scope: S

- [x] T-004: Comandos Rust `read_project_files` / `write_loopy_yml` (+ backup/retenção)
    NOVO `apps/menubar/src-tauri/src/project_fs.rs` espelhando o padrão de `config.rs` (`std::fs`,
    `Result<T, String>` + `map_err(|e| format!(...))`), mas resolvendo o path a partir do `dir` do
    projeto (arg do front), NÃO de `app_config_dir()`. Comandos: `#[tauri::command] pub fn
    read_project_files(dir: String) -> Result<ProjectFiles, String>` retornando `{ loopy_yml:
    Option<String>, todo_md: Option<String> }` (arquivo ausente ⇒ `None`, não erro); `#[tauri::command]
    pub fn write_loopy_yml(dir: String, contents: String) -> Result<(), String>` que **antes** de
    escrever, se existir `loopy.yml`, copia p/ `<dir>/.loopy/backups/loopy.<epoch>.yml`
    (`SystemTime::now().duration_since(UNIX_EPOCH)` — sem chrono; `create_dir_all` no `.loopy/backups`)
    e aplica **retenção de 10** (lista `.loopy/backups/loopy.*.yml`, ordena, remove os mais antigos
    além de 10). Registrar em `main.rs`: `mod project_fs;` + `use project_fs::{read_project_files,
    write_loopy_yml};` + adicionar ambos ao `generate_handler![...]`. `#[cfg(test)] mod tests`
    (estilo `config.rs`, puro): teste da lógica de **retenção** (dado N nomes de backup, mantém os 10
    mais recentes) e da montagem do nome de backup a partir de um epoch fixo; o I/O real fica manual.
    Aceite: os 2 comandos seguem o contrato `Result<_,String>`; `read` tolera arquivos ausentes;
    `write` cria backup + respeita retenção 10; comandos registrados; `cargo test` verde.
    Verificação: `cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml` && validação manual (Tauri) do round-trip.
    Deps: nenhuma
    Files: apps/menubar/src-tauri/src/project_fs.rs, apps/menubar/src-tauri/src/main.rs
    Scope: M

- [ ] T-005: `useConfigDraft` (load fs/sample, draft em memória, valida zod, dirty/errors, save)
    NOVO `apps/menubar/src/config/useConfigDraft.ts`: hook que, dado `dir`, carrega o `loopy.yml`
    e o `todo.md` (Tauri: `invoke("read_project_files",{dir})`; `dev:web`/`!isTauri()`: **sample
    embutido** — reusar `examples/loopy.yml` inline ou o `initialConfigTemplate` serializado). O
    documento vira **objeto** via **`parseConfigSource(source)`** (T-001) — `parseConfigSource` →
    `loopyConfigSchema.safeParse(obj)` → issues por path (o app **não** importa `yaml`); o draft é
    mantido em memória. Expõe `{ draft, errors, dirty, tasks, load(dir), patch(path,
    value), save() }`. **Validação a cada mudança:** `loopyConfigSchema.safeParse(draft)` → mapear
    `error.issues` por `path` (helper `errorAt(errors, "a.b.c")`). `tasks` = `parseBacklog(todoMd,
    backlogOptionsFrom(draft.inputs.backlog))` — **reparseia** quando `draft.inputs.backlog` muda
    (R9). `save()`: `serializeConfig(draft)` → Tauri `invoke("write_loopy_yml",{dir,contents})` |
    `dev:web` in-memory; marca `dirty=false`; **travado enquanto houver erro** (fail-closed).
    `patch` imutável por path (sem libs novas). `useConfigDraft.test.ts` (renderHook/jsdom): draft
    válido ⇒ `errors` vazio, `dirty` reflete edições; `patch` inválido ⇒ `errors` por path; troca de
    `inputs.backlog` reparseia `tasks`; `save` bloqueado com erro; `dev:web` carrega o sample.
    Aceite: draft em memória validado por zod (path→msg); `dirty` correto; `tasks` derivadas +
    reparse; `save` fail-closed (Tauri e in-memory); dir sem yml não quebra (ver T-015).
    Verificação: `npm test -w apps/menubar -- useConfigDraft && npm run typecheck -w apps/menubar`.
    Deps: T-002, T-004
    Files: apps/menubar/src/config/useConfigDraft.ts, apps/menubar/src/config/useConfigDraft.test.ts
    Scope: M

- [ ] T-006: App shell — idle mostra o board + header (dir picker + Iniciar placeholder) — SC1
    `apps/menubar/src/App.tsx`: no ramo `idle` (`runStatus === "idle"`), **em vez de** `LaunchConfig`,
    montar o board (`ViewSwitcher`) alimentado por `configToStore(draft, tasks)` (T-003) via o
    `useConfigDraft` (T-005). O header ganha um **seletor de diretório** (absorve o `dir picker` do
    `LaunchConfig` — input texto + botão "Escolher…" gated por `isTauri()`) e um botão **Iniciar**
    (placeholder nesta task; fiação real em T-014). O ramo `running`/`finished` fica **intacto**
    (segue com o `store` do bridge). `LaunchConfig` é absorvido: os flags migram p/ o popover do
    Iniciar (T-014) — nesta task, remover/neutralizar o `LaunchConfig` do idle sem perder o load do
    dir persistido. `App.test.tsx`: idle com dir+draft válido monta o board (colunas do pipeline),
    **não** dispara Run; trocar de dir recarrega o draft/board; ramo `running` inalterado (testes
    existentes verdes).
    Aceite: idle renderiza o board a partir do `loopy.yml` (SC1), sem iniciar o loop; header com dir
    picker + Iniciar; caminho `running` preservado; `LaunchConfig` absorvido.
    Verificação: `npm test -w apps/menubar -- App && npm run typecheck -w apps/menubar && npm run lint -w apps/menubar`.
    Deps: T-003, T-005
    Files: apps/menubar/src/App.tsx, apps/menubar/src/App.test.tsx, apps/menubar/src/panes/LaunchConfig.tsx
    Scope: L

## Fase 2 — Aba Config: editar → validar → salvar (T-007 → T-008 → T-009)

- [x] T-007: Primitivas `fields/` data-driven (Text/Number/Select[enum]/Toggle/Record/CommandList)
    NOVO `apps/menubar/src/config/fields/` com primitivas puras + `.css` (padrão de
    `LaunchConfig.css` `.launch__field/label/input`, tokens, DESIGN.md): `TextField` (label+input+
    error+hint; valores de yml em `--font-mono`/`t-data`, labels sans/`t-label`), `NumberField`
    (int/positive conforme schema), `SelectField<T>` (**enum fechado** — recebe `options` readonly e
    **nunca** oferta fora; base `SegmentedControl` ou `<select>`), `ToggleField` (checkbox
    `accent-color`), `RecordEditor` (chave→valor p/ `agents`/`checks`/`env`; add/remove linha, chave
    livre só aqui), `CommandListEditor` (lista de comandos p/ `shell.run`/`approval.run`; add/remove/
    reorder). Todas recebem `error?: string` (mensagem do zod, inline, `--state-failed-*`) e são
    controladas (`value`+`onChange`). **Meaning-Only color** e **Machine-Voice** respeitadas.
    Testes: `SelectField` só renderiza os `options` dados (prova SC5 — nunca valor fora do enum);
    `NumberField` rejeita/normaliza não-número; `RecordEditor`/`CommandListEditor` add/remove/reorder
    preservam ordem; erro renderiza inline.
    Aceite: 6 primitivas controladas + testadas; enum fechado; erro inline por campo; mono só em
    voz-de-máquina; zero literal de cor (tokens).
    Verificação: `npm test -w apps/menubar -- fields && npm run typecheck -w apps/menubar && npm run lint -w apps/menubar`.
    Deps: nenhuma
    Files: apps/menubar/src/config/fields/ (TextField, NumberField, SelectField, ToggleField, RecordEditor, CommandListEditor + .css + index), apps/menubar/src/config/fields/fields.test.tsx
    Scope: M

- [ ] T-008: Aba **Config** + **uma** seção fim-a-fim (editar→valida→dirty→Save) + roteamento de erro
    `apps/menubar/src/panes/ViewSwitcher.tsx`: `ViewId += "config"`, 3º segmento **Config** no
    `SegmentedControl` (SC3). NOVO `apps/menubar/src/config/ConfigPane.tsx` (+ `.css`): **scroll
    único**, cada seção um `fieldset`/card com título + **contador de erros** no header (R5). Nesta
    task, cablar **fim-a-fim** só `workspace` (3 `TextField`) + `concurrency` (`NumberField`):
    `patch` → `useConfigDraft` valida → `dirty` visível → botão **Salvar** chama `save()` (serialize
    + `write_loopy_yml` + backup). **Roteamento de erro (R7):** por `path` do zod — campo→inline;
    header da seção→contador; **banner fino no topo da aba** p/ erros cross-field sem dono
    (`agents`×`acp.command`, "nenhum agente resolvível"). Salvar/Iniciar **desabilitados** com
    qualquer erro (fail-closed, C4). `ViewSwitcher.test.tsx`/`ConfigPane.test.tsx`: 3º segmento
    seleciona a aba; editar `concurrency` inválido (0) ⇒ erro inline + contador + Salvar travado;
    editar válido ⇒ `dirty` ⇒ Salvar chama `save` com o YAML serializado; banner aparece p/ erro
    cross-field simulado.
    Aceite: aba Config existe (SC3); `workspace`+`concurrency` editam→validam→salvam end-to-end
    (grava `loopy.yml`+backup); erro roteado inline/contador/banner; Save fail-closed.
    Verificação: `npm test -w apps/menubar -- ViewSwitcher ConfigPane && npm run typecheck -w apps/menubar && npm run lint -w apps/menubar`.
    Deps: T-006, T-007
    Files: apps/menubar/src/panes/ViewSwitcher.tsx, apps/menubar/src/panes/ViewSwitcher.test.tsx, apps/menubar/src/config/ConfigPane.tsx, apps/menubar/src/config/ConfigPane.css, apps/menubar/src/config/ConfigPane.test.tsx
    Scope: M

- [ ] T-009: Config — **todas** as seções top-level restantes (SC4)
    `ConfigPane.tsx`: adicionar os `fieldset` restantes reusando as primitivas de T-007, cada campo
    ligado ao schema real: `agents` (`RecordEditor` name→AgentDef: command[list], env[record],
    model/effort/display_name[text]); `acp` (command[list], default_agent[text], request_timeout_
    seconds[number], permissions.default_mode[**text**, não enum], permissions.on_request[**Select**
    `allow|policy`]); `inputs` (spec/plan/todo[text] + backlog: pending_marker/done_marker/
    task_id_pattern/deps_pattern[text], body[**Select** `indented`], mark_done_on_success[toggle]);
    `checks` (`RecordEditor` nome→CheckCommand[]{name,run}); `stop_conditions` (max_iterations/
    max_step_visits[number], stop_signal_file[text]); `policies` (escalation.action[**Select**
    `pause|skip_task|abort_loop`], keep_worktree[toggle], notify[text]; git.require_clean_parent
    [toggle], on_merge_conflict[**Select** `escalate|rebase`]); `logging` (dir[text], per_task/
    capture_acp_traffic[toggle]); `metrics` (opt-in por presença: toggle "habilitar" + report.index
    [text]). **NÃO** editar `pipeline` aqui (fica no Kanban — R2). Cross-field (`agents`×
    `acp.command`) mostra no banner. Testes: cada seção renderiza os campos certos; os selects só
    ofertam os enums acima (SC5); toggle de `metrics` liga/desliga a seção.
    Aceite: todas as seções top-level (menos `pipeline`) editáveis (SC4); tipos/enums/records
    corretos por campo; `mode` é texto (não enum); metrics opt-in; validação por path.
    Verificação: `npm test -w apps/menubar -- ConfigPane && npm run typecheck -w apps/menubar && npm run lint -w apps/menubar`.
    Deps: T-008
    Files: apps/menubar/src/config/ConfigPane.tsx, apps/menubar/src/config/ConfigPane.test.tsx
    Scope: L

## Fase 3 — Editor de step + estrutura do pipeline (T-010 → T-011 → T-012 ∥ T-013)

- [x] T-010: `pipeline-edit.ts` puro (add/remove/reorder + `migrateStepType` + revalida refs)
    NOVO `apps/menubar/src/config/pipeline-edit.ts` — helpers puros sobre `config.pipeline`
    (tipos de `loopy/config`): `addStep(pipeline, type, atIndex?)` (id único gerado, campos-base +
    defaults do tipo: agent→prompt vazio inválido sinalizável; shell→run:[]; checks→run:""; approval
    →prompt), `removeStep(pipeline, id)`, `reorderStep(pipeline, from, to)`, `migrateStepType(step,
    newType)` (**preserva** `id`+base `always`/`on_success`/`parallel_safe`/`on_fail`; **descarta**
    os campos específicos do tipo antigo — R4), e `orphanRefs(pipeline)` que retorna os `goto`/
    `on_success.goto` que não apontam p/ `id` existente (espelha o superRefine do schema, sem
    reimplementar as REGRAS — só coleta as refs p/ a UI destacar). `pipeline-edit.test.ts`:
    add/remove/reorder mantêm ids únicos + ordem; remover um step alvo de `goto` ⇒ `orphanRefs` o
    reporta; `migrateStepType` preserva id+base e zera específicos; migrar p/ o mesmo tipo é no-op.
    Aceite: helpers puros; ids únicos preservados; `migrateStepType` conforme R4; `orphanRefs`
    detecta refs `goto`/`on_success` órfãs após mover/remover; testado isolado.
    Verificação: `npm test -w apps/menubar -- pipeline-edit && npm run typecheck -w apps/menubar`.
    Deps: T-002
    Files: apps/menubar/src/config/pipeline-edit.ts, apps/menubar/src/config/pipeline-edit.test.ts
    Scope: M

- [ ] T-011: `StepEditor` drawer pelo `⋯` (campos por tipo) + troca de `type` com confirm (SC2/SC10/SC12)
    `apps/menubar/src/kanban/KanbanBoard.tsx`: adicionar um botão **`⋯`** no `.kanban-column-title`
    (só idle; `margin-left:auto`) que abre o `StepEditor` do step daquela coluna (col.id = step.id).
    NOVO `apps/menubar/src/config/StepEditor.tsx` (+ `.css`): **drawer à direita** replicando o
    shell de `CardDetail` (irmão do board, `--drawer-w`, Escape-to-close, corpo rolável, header com
    `id`+`type` + contador de erros — R3). Campos **por tipo** (via as primitivas de T-007), todos
    validados pelo zod do draft: base (`id`[text], `parallel_safe`[toggle], `always`[toggle],
    `on_success.goto`[Select dos ids], `on_fail`[Select `escalate`|goto→id]); `agent` (prompt,
    retry_prompt, mode[text], clear_context[toggle], verify{run,max_attempts}, expect, agent[text/
    Select do registry], model, effort); `shell` (run[CommandList]); `checks` (run[text — nome da
    lista]); `approval` (prompt, run[CommandList]). **Troca de `type`** via `SelectField`
    (`agent|shell|checks|approval`) → `migrateStepType` (T-010) com **confirm de perda de dados**
    (R4/SC10). Salvar reflete no draft (→ `loopy.yml` via Save da aba/global). Guard: `on_fail` em
    step `agent` exige `verify` OU `expect` (erro do schema aparece inline). `StepEditor.test.tsx`:
    `⋯` abre o drawer com os campos do tipo; editar prompt ⇒ draft/dirty; trocar `type` pede confirm,
    preserva id+base, descarta específicos, revalida; Escape fecha; contador de erros no header.
    Aceite: `⋯` por coluna abre o drawer (SC2/SC12); campos válidos por tipo; troca de `type` com
    confirm preserva id+base e descarta específicos + revalida (SC10); Save reflete no `loopy.yml`.
    Verificação: `npm test -w apps/menubar -- StepEditor KanbanBoard && npm run typecheck -w apps/menubar && npm run lint -w apps/menubar`.
    Deps: T-007, T-008, T-010
    Files: apps/menubar/src/kanban/KanbanBoard.tsx, apps/menubar/src/config/StepEditor.tsx, apps/menubar/src/config/StepEditor.css, apps/menubar/src/config/StepEditor.test.tsx
    Scope: M

- [ ] T-012: Kanban idle — add step / drag-reorder / remove coluna (SC7)
    `apps/menubar/src/kanban/KanbanBoard.tsx` (só idle): coluna final **"+ add step"** (usa
    `addStep` de T-010 → abre o `StepEditor` no novo step); **handle de arrastar** no header p/
    reordenar colunas (`reorderStep`); ação **remover** no `⋯`/StepEditor (`removeStep`). Após
    qualquer mutação estrutural, **revalidar** via o draft (zod) e destacar refs `goto`/`on_success`
    órfãs (`orphanRefs` de T-010 → badge no header da coluna + banner). Reordenar/remover atualiza
    `configToStore`/colunas (as colunas saem de `pipeline`). Cobrir o `grouper` (hoje sem teste
    dedicado) para a mudança de `pipeline`. Testes: add cria coluna + step no draft; reorder muda a
    ordem do `pipeline` (e das colunas); remover um step referenciado por `goto` sinaliza a órfã;
    ids permanecem únicos.
    Aceite: add/remove/reorder de steps no Kanban idle (SC7); revalida e sinaliza refs `goto`/
    `on_success` órfãs; colunas refletem a nova ordem; `grouper` coberto.
    Verificação: `npm test -w apps/menubar -- KanbanBoard grouper && npm run typecheck -w apps/menubar && npm run lint -w apps/menubar`.
    Deps: T-010, T-011
    Files: apps/menubar/src/kanban/KanbanBoard.tsx, apps/menubar/src/kanban/KanbanBoard.test.tsx, apps/menubar/src/kanban/grouper.test.ts
    Scope: L

- [ ] T-013: Rename cascade (`step.id`/agente/lista-de-checks) + guard de colisão (SC11)
    NOVO `apps/menubar/src/config/rename.ts` — helpers puros: `renameStepId(config, old, new)`,
    `renameAgent(config, old, new)`, `renameChecksList(config, old, new)` que **reescrevem todos os
    referrers** (R6): step.id → `on_success.goto`/`on_fail.goto` de todos os steps; agente → chave
    do record `agents`, `acp.default_agent`, `step.agent`; lista-de-checks → chave do record
    `checks`, `verify.run` e `run` de steps `checks`. **Guard de colisão**: renomear p/ um nome já
    existente é rejeitado (retorna erro, não aplica). Nota (R6): o `run` do step `checks` **não** é
    validado como ref pelo zod — a cascata cobre o rename, mas órfã de checks-list não vira erro do
    motor (documentar). Ligar nos pontos de rename (StepEditor `id`/`agent`/`run`; ConfigPane chaves
    de `agents`/`checks`). `rename.test.ts`: renomear `step.id` reescreve os `goto`; renomear agente
    reescreve `default_agent`+`step.agent`+chave; renomear checks-list reescreve `verify.run`+`run`+
    chave; colisão é bloqueada.
    Aceite: rename de `step.id`/agente/checks-list cascateia p/ todos os referrers (SC11); colisão
    com nome existente bloqueada; helpers puros + testados; ligados na UI de edição.
    Verificação: `npm test -w apps/menubar -- rename && npm run typecheck -w apps/menubar && npm run lint -w apps/menubar`.
    Deps: T-010, T-011
    Files: apps/menubar/src/config/rename.ts, apps/menubar/src/config/rename.test.ts, apps/menubar/src/config/StepEditor.tsx, apps/menubar/src/config/ConfigPane.tsx
    Scope: M

## Fase 4 — Iniciar + empty-state + guardas (T-014 ∥ T-015)

- [ ] T-014: Botão **Iniciar** (popover de flags) + auto-save antes + guarda de draft sujo (SC6/R10)
    `apps/menubar/src/App.tsx`: fiar o botão **Iniciar** do header. Um **popover** (padrão `Menu`/
    popover existente) hospeda os flags de launch (`--yes`/`--task <id>`/`--verbose`) — mantêm o
    contrato `launch-config.json` (C3), **fora** do yml. Ao Iniciar: se `dirty`, **auto-salva**
    (`save()`) antes (C2); então dispara o Run como hoje (`save_launch_config` + `start_sidecar`
    com `dir` + flags + `--no-tui --emit-events`). **Guarda de draft sujo (R10):** trocar de
    diretório **ou** fechar a janela com `dirty` ⇒ confirm **Salvar/Descartar/Cancelar** (espelha o
    `Cmd+Q` com Run ativo). `App.test.tsx`/popover test: Iniciar com `dirty` chama `save` antes de
    `start_sidecar`; flags do popover chegam ao `start_sidecar`; trocar de dir com `dirty` dispara o
    confirm; erro no draft trava o Iniciar (fail-closed).
    Aceite: Iniciar dispara o Run com o `loopy.yml` persistido (SC6); flags no popover (não no yml);
    auto-save antes do Run; guarda de draft sujo ao trocar dir/fechar (R10); Iniciar travado com erro.
    Verificação: `npm test -w apps/menubar -- App && npm run typecheck -w apps/menubar && npm run lint -w apps/menubar`.
    Deps: T-008
    Files: apps/menubar/src/App.tsx, apps/menubar/src/App.test.tsx, apps/menubar/src/panes/LaunchConfig.tsx
    Scope: M

- [ ] T-015: Empty-state (sem `loopy.yml`) + "Criar a partir do template" + dev:web completo (SC8/R11)
    `apps/menubar/src/config/`: quando `read_project_files` retorna `loopy_yml: None` (dir sem yml),
    o board mostra um **empty-state** com botão **"Criar loopy.yml a partir do template"** que semeia
    o draft com `initialConfigTemplate` (R1) — **não** auto-grava; só o **Salvar** materializa o
    arquivo (SC8). `dev:web` (R11): read carrega o sample embutido; **Salvar é in-memory** (sem
    disco); a fs-bridge (`project_fs`) é Tauri-gated (já em T-004/T-005). `todo.md` ausente/inválido
    ⇒ 0 cards + dica discreta (R9). Testes: dir sem yml ⇒ empty-state; "Criar do template" semeia
    draft válido (colunas do template) sem gravar; Salvar (mock) grava; `dev:web` sem Tauri renderiza
    e Save não invoca Tauri.
    Aceite: empty-state + "Criar do template" semeia draft válido, só Salvar materializa (SC8);
    `dev:web` funciona (sample + Save in-memory) (R11); todo.md ausente ⇒ 0 cards + dica.
    Verificação: `npm test -w apps/menubar && npm run typecheck -w apps/menubar && npm run lint -w apps/menubar`.
    Deps: T-006
    Files: apps/menubar/src/config/EmptyState.tsx, apps/menubar/src/config/EmptyState.css, apps/menubar/src/config/useConfigDraft.ts, apps/menubar/src/App.tsx, apps/menubar/src/config/EmptyState.test.tsx
    Scope: M
