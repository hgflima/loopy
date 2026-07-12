# Spec: C-0014 — Editor visual do `loopy.yml` (config-driven pela própria UI)

> Follow-up das changes do menubar (C-0009…C-0013). Hoje o app é **somente-leitura sobre um
> Run**: o estado `idle` mostra um formulário (`LaunchConfig`) e o board (Kanban/Deps) só aparece
> depois de rodar, alimentado por eventos NDJSON do sidecar (`pipeline_declared`). A UI **nunca
> lê nem edita o `loopy.yml`** — quem lê é o CLI. Esta change transforma a tela principal num
> **editor visual do `loopy.yml`**: o board fica disponível **antes de rodar**, alimentado pela
> leitura+validação do `loopy.yml`+`todo.md`, com edição de cada step (Kanban), edição de todas
> as configurações gerais (nova aba **Config**), validação contínua pelo **mesmo schema zod do
> motor** e um botão **Iniciar** que dispara o Run com o config já persistido.

## Objective

**O quê:** dar ao usuário a capacidade de **editar o `loopy.yml` visualmente** dentro do app
menubar, sem editar YAML à mão, e só então iniciar o Run.

**Quem:** o dev que opera o loopy pelo app nativo — quer ajustar o pipeline/config de um projeto
(prompt de um step, agente, concurrency, políticas…) antes de disparar, com a garantia de que o
que ele monta é sempre um config **válido**.

**Sucesso (reframe dos 6 requisitos do pedido em critérios testáveis — ver §Success Criteria):**
1. Abrir um diretório **não** inicia o loop (mantém o comportamento atual).
2. Cada coluna do Kanban tem um **"⋯"** que abre a edição daquele step.
3. Nova aba **Config** ao lado de Kanban e Deps.
4. Todas as configurações gerais (top-level do yml) são editáveis visualmente na aba Config.
5. Toda edição é **validada** pelo schema zod do motor; a UI **nunca** oferece opção que o schema
   não permite (enums fecham selects, campos por tipo de step, sem chave livre exceto records).
6. Um botão **Iniciar** dispara o Run.

**Não-objetivos (v1):** editar `spec.md`/`plan.md`; um editor de texto YAML embutido; preservar
comentários do `loopy.yml`; múltiplos Runs; editar o config **durante** um Run (a edição é só no
estado idle); i18n além do pt-BR já usado.

## Decisões tomadas (interview /devy:spec + /devy:refine)

| # | Decisão | Escolha |
|---|---------|---------|
| D1 | **Fluxo de telas** | **Board é a tela principal.** Com um diretório selecionado, a tela mostra as abas Kanban/Deps/Config alimentadas pelo `loopy.yml` (sem rodar). Seletor de diretório e botão **Iniciar** no cabeçalho. O `LaunchConfig` atual é absorvido; os flags de launch migram para um popover do Iniciar. |
| D2 | **Edição de step** | O "⋯" abre um editor com **todos os campos válidos** daquele step (por tipo, validados pelo zod). |
| D3 | **Persistência** | Salva **reescrevendo** o `<dir>/loopy.yml` via `yaml.stringify` (perde comentários — mitigado por backup automático em `.loopy/backups/`, ver C1). |
| D4 | **Escopo da aba Config** | **Todas** as seções top-level editáveis (workspace, agents, acp, inputs, checks, stop_conditions, concurrency, policies, logging, metrics). |
| D5 | **Sem/​inválido yml** | **Montar do zero na UI.** Sem `loopy.yml`: abre com os **defaults do schema** para preencher e salvar um yml novo. Com yml inválido: carrega o que der e **sinaliza os campos inválidos**. |
| D6 | **Estrutura do pipeline** | Reconcilia D2+D5: a UI permite **adicionar, remover e reordenar steps** (pipeline editor completo). Ao mover/remover, revalida refs de `goto`/`on_success`. |

## Tech Stack

- **Front:** React 18 + TypeScript + Vite (dentro de `apps/menubar/src`). CSS "solto" BEM-like
  sobre os tokens (`ui/tokens.css`), classes `t-*`/`u-*` (`ui/base.css`), primitivas em `ui/`
  (`Button`, `SegmentedControl`, `Pill`, `StatusDot`…). Design regido por `apps/menubar/DESIGN.md`.
- **Validação (fonte única — SC #5):** reusar o **schema zod do motor** (`src/config/schema.ts`)
  no front via **novo subpath export** `loopy/config`. Nenhuma reimplementação de regras.
- **Parse do backlog (cards em idle):** reusar `src/backlog/todo.ts` via **novo subpath**
  `loopy/backlog` (`parseBacklog` + `backlogOptionsFrom`).
- **Serialização YAML:** pacote `yaml` (já dependência do motor) para `stringify` na escrita.
- **Ponte nativa:** novos comandos Tauri (Rust, em `apps/menubar/src-tauri`) para ler/gravar os
  arquivos do projeto-alvo (`loopy.yml`, `todo.md`). `dev:web` usa fallback (mock/estado local).
- **Motor:** `-c, --config <path>` e `parseConfig()` já existem; **nenhuma mudança de
  comportamento do loop** (AD-1). Mudanças no motor: os dois subpath exports **+** (R8) uma
  função pura `serializeConfig(config): string` (ordem canônica) e um **template inicial**
  canônico em `src/config`, ambos exportados por `loopy/config` e cobertos por teste. É a única
  exceção aprovada ao "Ask first" — puro, aditivo, sem tocar o loop.

## Commands

Todos executados a partir de `apps/menubar` (front) e da raiz (motor/exports):

```
# motor (raiz) — necessário porque a UI importa de dist/ via npm link
Build motor:      npm run build
Typecheck motor:  npm run typecheck
Test motor:       npm test

# app menubar
Dev (web):        cd apps/menubar && npm run dev
Dev (tauri):      cd apps/menubar && npm run tauri dev
Typecheck app:    cd apps/menubar && npm run typecheck
Lint app:         cd apps/menubar && npm run lint
Test app:         cd apps/menubar && npm test
Build sidecar:    cd apps/menubar && npm run build:sidecar
```

> Nota (memória do projeto): o `loopy`/subpaths resolvem via **dist local** (npm link). Ao mudar
> os exports/subpaths do motor, rodar `npm run build` na raiz **antes** de typecheckar o app,
> senão o app importa um `dist/` stale.

## Project Structure

**Motor (raiz) — só adiciona superfície de import, sem novo comportamento:**
```
package.json                 → adicionar exports "./config" e "./backlog"
src/config/index.ts (novo)   → barrel re-exportando loopyConfigSchema, parseConfig, defaults
src/backlog/index.ts (novo)  → barrel re-exportando parseBacklog, backlogOptionsFrom, Task…
tsup.config.ts               → incluir os novos entrypoints no build
```

**App menubar — o grosso da change:**
```
apps/menubar/src/config/              (novo diretório — o editor)
  useConfigDraft.ts        → carrega loopy.yml (Tauri fs), mantém o "draft" em memória,
                             valida (zod) a cada mudança, expõe { draft, errors, dirty, ... }
  configToStore.ts         → deriva um StoreState "preview" (pipeline + tasks do todo.md)
                             para alimentar Kanban/Deps em idle (função pura, testável)
  ConfigPane.tsx (+ .css)  → a aba Config: forms por seção top-level (todas editáveis)
  StepEditor.tsx (+ .css)  → painel do "⋯": campos por tipo de step (agent/shell/checks/approval)
  fields/                  → primitivas de campo data-driven (TextField, NumberField,
                             SelectField[enum], ToggleField, RecordEditor, CommandListEditor…)
  pipeline-edit.ts         → add/remove/reorder de steps + revalidação de refs goto/on_success

apps/menubar/src/kanban/KanbanBoard.tsx  → "⋯" no header da coluna (abre StepEditor);
                                           modo idle (add step / drag-reorder colunas)
apps/menubar/src/panes/ViewSwitcher.tsx  → 3º segmento "Config"; ViewId += "config"
apps/menubar/src/App.tsx                 → shell: header (dir picker + Iniciar), board em idle
apps/menubar/src/panes/LaunchConfig.*    → absorvido; flags viram popover do Iniciar
apps/menubar/src-tauri/src/project_fs.rs (novo) → read_project_files / write_loopy_yml (+ backup)
apps/menubar/src-tauri/src/main.rs       → registrar os novos comandos
```

## Code Style

Segue o padrão já estabelecido no app: componente + `.css` par, tokens, primitivas `ui/`,
funções puras testáveis isoladas (AD-6). Campos derivam do schema (enum → `SelectField`):

```tsx
// SelectField — um enum do schema vira um select; a UI nunca oferece valor fora do enum (SC #5).
const ESCALATION_ACTIONS = ["pause", "skip_task", "abort_loop"] as const;

<SelectField
  label="escalation.action"
  value={draft.policies.escalation.action}
  options={ESCALATION_ACTIONS}          // fechado pelo schema — nada de texto livre
  onChange={(v) => patch(["policies", "escalation", "action"], v)}
  error={errorAt(errors, "policies.escalation.action")}   // mensagem do zod, inline
/>
```

- **Validação = zod do motor**, nunca regras duplicadas. Erros do zod são mapeados a campos por
  path (`error.issues[].path`).
- **Machine-Voice Rule** (DESIGN.md §3): ids/paths/comandos em `--font-mono`; rótulos e prosa em
  sans. Nomes de campo do yml (`policies.escalation.action`) contam como voz-de-máquina → mono.
- **Meaning-Only color** (DESIGN.md §2): erro em `--state-failed-*`, ação primária em `--accent`.

## Testing Strategy

Vitest (app) + Vitest (motor), espelhando a suíte existente. Foco no que é **puro** (AD-6):

- `configToStore.test.ts` — config parseado (+ backlog) → StoreState preview correto (colunas =
  steps na ordem; cards no Backlog).
- `pipeline-edit.test.ts` — add/remove/reorder preserva ids únicos; reordenar/remover **revalida**
  e sinaliza refs `goto`/`on_success` órfãs.
- `useConfigDraft` (lógica de validação) — draft inválido → `errors` por path; `dirty` correto.
- Casos de fronteira: **sem loopy.yml** (defaults do schema), **yml inválido** (carrega + marca).
- Cobertura de que a UI **não** oferece valor fora de enum (teste dos `options` dos selects).
- Rust: round-trip `write_loopy_yml` + criação do backup (`project_fs` tests, espelhando
  `config.rs`).
- **Manual (Tauri):** abrir dir → editar step/config → Salvar → conferir o `loopy.yml` no disco →
  Iniciar → o Run usa o config editado.

## Boundaries

**Always:**
- Validar **todo** draft com o schema zod do motor antes de habilitar Salvar/Iniciar (fail-closed).
- Manter `dev:web` funcional (fallbacks quando `!isTauri()`).
- Rodar `npm run build` na raiz após mudar exports antes de typecheckar o app.
- Seguir `DESIGN.md` (chrome neutro, cor só p/ significado, mono só p/ voz-de-máquina).

**Ask first:**
- Qualquer mudança em `src/` que não seja **adicionar** os subpath exports **ou** o par puro
  aprovado no R8 (`serializeConfig` + template inicial). O motor é congelado por AD-1; alterar
  **comportamento do loop** está fora.
- Adicionar dependência nova ao app (preferir `yaml`, já presente).
- Mudar o formato do `launch-config.json` persistido (contrato TS↔Rust).

**Never:**
- Reimplementar as regras de validação no front (a fonte é o zod do motor).
- Escrever no `loopy.yml` sem antes gerar o backup em `.loopy/backups/` (C1).
- Editar o config enquanto um Run está ativo.
- Oferecer na UI um campo/valor que o `.strict()` do schema rejeita.

## Success Criteria

- [ ] **SC1** Abrir um diretório mostra a tela principal e **não** inicia o loop.
- [ ] **SC2** Cada coluna do Kanban tem um "⋯"; clicá-lo abre o editor daquele step com os campos
  válidos do tipo; Salvar reflete no `loopy.yml`.
- [ ] **SC3** Existe uma 3ª aba **Config** ao lado de Kanban e Deps.
- [ ] **SC4** Todas as seções top-level do `loopy.yml` são editáveis na aba Config.
- [ ] **SC5** Toda edição é validada pelo zod; enquanto inválido, Salvar e Iniciar ficam
  desabilitados e o(s) campo(s) inválido(s) são sinalizados; selects só ofertam valores do enum.
- [ ] **SC6** O botão **Iniciar** dispara o Run com o `loopy.yml` já persistido.
- [ ] **SC7** Add/remove/reorder de steps funciona e revalida refs de `goto`/`on_success`.
- [ ] **SC8** Diretório sem `loopy.yml` mostra um **empty-state**; **"Criar a partir do template"**
  semeia um draft válido; **Salvar** materializa o arquivo (R1).
- [ ] **SC9** `npm run typecheck` + `lint` + `test` (app e motor) passam.
- [ ] **SC10** Trocar o `type` de um step **preserva** `id`/campos-base, **descarta** os campos
  incompatíveis (com confirm) e o resultado **revalida** (R4).
- [ ] **SC11** Renomear `step.id`/agente/lista-de-checks **cascateia** para todos os referrers e
  **bloqueia** colisão com nome existente (R6).
- [ ] **SC12** O `StepEditor` abre num **drawer** pelo `⋯`; erros cross-field aparecem no **banner**
  da aba; o motor exporta `serializeConfig` + template (R3/R7/R8).

## Decisões complementares (resolvidas no refine)

| # | Tema | Escolha |
|---|------|---------|
| C1 | **Backup antes de sobrescrever** | Grava `.loopy/backups/loopy.<timestamp>.yml` a cada escrita (`.loopy/` já é gitignored). Aplicar um **teto de retenção** (ex.: manter as N mais recentes, N a definir no plan) para não acumular indefinidamente. |
| C2 | **Momento de salvar no disco** | Edição num **draft em memória** (valida a cada tecla); persiste no disco só via botão **Salvar** (estado `dirty` visível). Ao **Iniciar** com mudanças não salvas, **salva antes automaticamente**. |
| C3 | **Flags de launch** (`--yes`/`--task`/`--verbose`) | Vivem num **popover do botão Iniciar** (não no yml). Mantém o `launch-config.json` (contrato TS↔Rust) como hoje. |
| C4 | **Sinalização de erro** | **Inline por campo** (mensagem do zod mapeada por path) + **contador de erros** no cabeçalho da aba/step. Salvar/Iniciar desabilitados enquanto houver erro (fail-closed). |

## Decisões do refine — rodada 2 (2026-07-12)

Segunda passada do `/devy:refine`, resolvendo os ramos abertos por D1–D6/C1–C4 contra o
código real (`schema.ts`, `App.tsx`, `KanbanBoard.tsx`, `grouper.ts`, `config.rs`, `todo.ts`).

| # | Ramo | Escolha |
|---|------|---------|
| R1 | **Seed do dir vazio** | O `loopy.yml` novo nasce de um **template mínimo VÁLIDO dono do motor** (export canônico de `loopy/config`, coberto por teste que prova que parseia). Reinterpreta o D5: "defaults do schema" sozinho é **inválido** (`pipeline` exige `min(1)` + a maioria dos required não tem `.default()`), por isso o template. **Gatilho:** dir sem yml mostra um **empty-state** com botão **"Criar loopy.yml a partir do template"** (não auto-semeia). Só **Salvar** grava o arquivo. |
| R2 | **Home do pipeline** | Edição **estrutural** (add/remove/reorder) vive **só no Kanban** — coluna = step, com `⋯` (abre o StepEditor), handle de arrastar p/ reordenar e uma coluna final **"+ add step"**. A aba **Config não edita o pipeline**; cuida apenas das outras seções top-level. |
| R3 | **Host do StepEditor** | **Drawer à direita**, reusando o padrão do `CardDetail` (largura `--drawer-w: 400px`, Escape-to-close, corpo rolável, header com `id`/`type` do step + contador de erros). Sem Modal genérico novo. |
| R4 | **Mutabilidade do `type`** | **Editável** no drawer via `select`: trocar o tipo **preserva `id` + campos-base** (`always`/`on_success`/`parallel_safe`/`on_fail`) e **descarta** os campos específicos do tipo antigo, com **confirm de perda de dados**. A migração vive num helper de `pipeline-edit.ts`. |
| R5 | **Layout da aba Config** | **Scroll único**: cada seção é um `fieldset`/card com título + **contador de erros** no header. **Nada colapsado** — o fail-closed exige ver todos os erros de uma vez. |
| R6 | **Refs no rename** | **Auto-cascata.** Renomear um `step.id`/agente/lista-de-checks **reescreve todos os referrers** (`goto`, `on_success.goto`, `acp.default_agent`, `step.agent`, e o `run` de um step `checks`). **Guard de colisão** com nome já existente. Nota: o `run` do step `checks` **não** é validado como referência pelo zod — a cascata cobre o rename, mas órfã de checks-list não vira erro do motor. |
| R7 | **Roteamento de erro** | Por `path` do zod: campo → **inline**; header da seção/coluna → **badge/contador**; e um **banner fino no topo da aba** para os erros **cross-field sem dono** (`agents`×`acp.command` mutuamente exclusivos, "nenhum agente resolvível"). Salvar/Iniciar travam com qualquer erro. |
| R8 | **Serialização YAML** | Nova função **pura `serializeConfig(config): string`** em `src/config` (exportada por `loopy/config`), com **ordem canônica** das seções. O app **não** importa `yaml` direto. **Aprovado** como exceção ao "Ask first" (mudança em `src/` além dos exports). O **template do R1** também é export do motor. |
| R9 | **Papel do todo.md** | **Read-only (preview).** Cards refletem o backlog parseado e **reparseiam** quando `inputs.backlog` muda no Config. Editar tasks fica **fora do v1** (como `spec`/`plan`). Ausente/inválido → 0 cards + dica discreta. |
| R10 | **Guarda de draft sujo** | Trocar de diretório **ou** fechar a janela com mudanças não salvas → **confirm Salvar/Descartar/Cancelar** (espelha o `Cmd+Q` com Run ativo). **Iniciar** continua **auto-salvando** (C2). |
| R11 | **dev:web (sem Tauri)** | O editor funciona sem Tauri: o read carrega um **sample embutido** no draft; **Salvar é in-memory** (sem disco). A fs-bridge (`project_fs`) é **Tauri-gated**. |

**Decorrências (folded no plan, não interviewadas):**
- **Superfície do barrel `loopy/config`:** exporta `loopyConfigSchema`, `parseConfig`, `serializeConfig`,
  o **template inicial** e os tipos — **nunca** `loadConfig` (usa `readFileSync`/node, quebra no browser).
  `parseConfig`/`parseBacklog` são puros e browser-safe (verificado).
- **Retenção de backup (C1):** manter as **10** mais recentes em `.loopy/backups/`.
- **Contrato TS↔Rust net-new:** `project_fs.rs` espelha `config.rs` (`std::fs`, `Result<_, String>`,
  `map_err`), mas resolve o path a partir do `dir` do projeto-alvo (não `app_config_dir()`) e adiciona
  a lógica de **backup** (inexistente no Rust hoje). Comandos: `read_project_files(dir)` →
  `{ loopyYml?: string, todoMd?: string }`; `write_loopy_yml(dir, contents)` → backup + escrita.
