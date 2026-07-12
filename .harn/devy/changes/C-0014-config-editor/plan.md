# Plano de implementação: C-0014 — Editor visual do `loopy.yml`

> Companheiro do `spec.md` (mesma pasta). Narrativa, grafo de dependências, fases,
> checkpoints e riscos. A lista executável pelo motor está em `todo.md`.

## Overview

Transformar a tela principal do app menubar num **editor visual do `loopy.yml`**. Hoje o
`idle` mostra o `LaunchConfig` e **esconde** o board; o board só nasce de eventos NDJSON do
sidecar depois de rodar. Esta change faz o board (Kanban/Deps/**Config**) aparecer **no idle**,
alimentado pela leitura+validação do `loopy.yml`+`todo.md`, com edição de cada step (drawer pelo
`⋯`), edição de todas as seções top-level (aba Config), validação contínua pelo **mesmo schema
zod do motor** e um botão **Iniciar** que dispara o Run com o config já persistido.

O trabalho tem duas frentes: uma fina **superfície de import do motor** (barrels + `serializeConfig`
+ template, tudo puro/aditivo — AD-1 intacto) e o **grosso no app** (`apps/menubar/src`).

## Descobertas do código que moldam o plano (verificadas nesta sessão)

1. **O app resolve `loopy/*` para o SOURCE do motor, não `dist`.** Tanto o Vite
   (`apps/menubar/vite.config.ts:15-20`) quanto o `tsc` (`apps/menubar/tsconfig.json` →
   `paths: { "loopy/*": ["../../src/*"] }`) e o vitest apontam `loopy/*` → `../../src/*`.
   Portanto, para expor `loopy/config` e `loopy/backlog` ao app **basta criar os barrels**
   `src/config/index.ts` e `src/backlog/index.ts`. Os `package.json` `exports` + `tsup`
   entrypoints são só para o **pacote publicado** (`@hgflima/loopy`) ficar honesto — **não**
   bloqueiam o app, e o app **não** precisa de `npm run build` na raiz para typecheckar (a nota
   do spec vinha da crença "dist"; corrigida aqui). Ainda assim rodamos o build p/ provar que a
   superfície publicada compila e é browser-safe.

2. **`node:fs` no topo de `load.ts` e `todo.ts`.** Como o app bundla o *source*, os barrels
   devem re-exportar **só a superfície pura** (schema, `parseConfig`, `serializeConfig`, template;
   `parseBacklog`, `backlogOptionsFrom`, `Task`) — **nunca** `loadConfig`/`loadBacklog`/
   `markDoneInFile`. Com isso o tree-shaking do esbuild dropa o `import "node:fs"`. É um risco
   verificável (build do Vite + grep no bundle).

3. **`parseConfig(source: string)` é puro/browser-safe** (usa `yaml.parse` + zod), mas **lança**
   `ConfigError` em yml inválido. Para o D5 ("carrega o que der e sinaliza os campos") precisamos
   do **objeto cru** antes da validação: `yaml.parse(string)` → objeto → `loopyConfigSchema.safeParse`
   → issues por path. **Decisão tomada** (aprovada — extensão ao par R8): o barrel `loopy/config`
   expõe uma função nova, pura e aditiva **`parseConfigSource(source: string): unknown`** (só
   `yaml.parse`, sem validação), read-counterpart de `serializeConfig`. O app nunca importa `yaml`;
   a autoridade do parse fica no motor.

4. **`serializeConfig` e um template canônico NÃO existem** — criar do zero (R8), puros, com
   round-trip provado por teste. O único "template" hoje é `examples/loopy.yml`/`loopy.yml` (texto).

5. **Ponto de articulação do idle:** `App.tsx:47` — `runStatus === "idle"` força o `LaunchConfig`
   e esconde o board. O editor renderiza o board no idle a partir de um `StoreState` **sintético**
   produzido por `configToStore(config, tasks)` (popula `pipeline` de `config.pipeline[].{id,type}`,
   `tasks` do backlog parseado e `edges` das `task.deps`), replicando o efeito de
   `pipeline_declared`+`edges_set`+`task_registered` (`src/tui/store.ts`). `ui.runStatus` segue
   `"idle"`.

6. **Colunas do Kanban saem 100% de `state.pipeline`** (`src/kanban/grouper.ts` — título da coluna
   = `step.id`). Popular `pipeline` já renderiza as colunas certas com os cards no **Backlog**.

7. **`enum` reais (fecham `SelectField`):** `acp.permissions.on_request` `["allow","policy"]`;
   `inputs.backlog.body` `["indented"]`; `policies.escalation.action` `["pause","skip_task",
   "abort_loop"]`; `policies.git.on_merge_conflict` `["escalate","rebase"]`; `step.type`
   `["agent","shell","checks","approval"]`; `on_fail` = `"escalate" | {goto}`. **`mode`/`model`/
   `effort` NÃO são enum** (string livre) → `TextField` com dica, não select. `agents`, `checks`,
   `agentDef.env` são **records** (chaves livres) → `RecordEditor`.

8. **Nenhuma primitiva de campo existe** em `src/ui/` (só Button, StatusIndicator/StatusDot/Pill,
   SegmentedControl, Menu, MarkdownStream). O markup de campo vive inline no `LaunchConfig`
   (`.launch__field/.launch__label/.launch__input`). O `fields/` é net-new. `SegmentedControl`
   serve para toggles/enum curtos; `CardDetail` (`src/kanban/CardDetail.tsx` + `.css`) é o padrão
   de **drawer** a replicar (irmão do board, `--drawer-w:400px`, Escape-to-close).

9. **`parseDeps` descarta a dep se houver texto/ponto após o id** (bug D-0001 confirmado em
   `src/backlog/todo.ts:154-169`, `idValidationRegex = ^T-\d+$`). Por isso **toda linha `Deps:`
   no `todo.md` fica isolada, com ids limpos separados por vírgula e SEM ponto final**.

## Decisões arquiteturais deste plano

- **Fundação primeiro, depois fatias verticais.** As tasks T-001/T-002 (motor) e T-004 (ponte fs
  Rust) são infra compartilhada; a partir daí cada fatia entrega um caminho completo e testável:
  *abrir dir → ver board* (Fase 1), *editar campo → validar → salvar* (Fase 2), *`⋯` → editar step*
  (Fase 3), *Iniciar/empty-state* (Fase 4).
- **Validação = zod do motor, sempre** (SC5). O hook usa `loopyConfigSchema.safeParse(draft)` e
  mapeia `error.issues[].path` para campos. Zero regra reimplementada no front.
- **Funções puras isoladas** (AD-6): `configToStore`, `pipeline-edit`, o mapeamento de erros e o
  `serializeConfig` são puros e testados sem React/Tauri (modelo: `failed-step.test.ts`).
- **`dev:web` funcional em toda fatia**: o `useConfigDraft` (T-005) já carrega um sample embutido e
  faz Save in-memory quando `!isTauri()`, então cada task seguinte é testável sem Tauri.
- **Persistência fail-closed**: Save/Iniciar desabilitados enquanto houver erro; backup
  (`.loopy/backups/loopy.<ts>.yml`, retenção 10 — C1) antes de toda escrita.

## Grafo de dependências

```
Fase 0 (motor)         Fase 1 (board no idle)          Fase 2 (aba Config)
  T-001 serialize+tmpl    T-004 Rust project_fs           T-007 fields/ (puro)
     │                       │                               │
  T-002 barrels+exports ─────┤                               │
     │        │              │                               │
     │     T-003 configToStore                               │
     │        │              │                               │
     │        └── T-006 App shell (idle board) ── T-008 Config tab (1 seção e2e+Save)
     │              ▲   ▲        (T-005) ▲              │            │
     └── T-005 useConfigDraft ──────────┘              │         T-009 todas as seções
                                                       │
Fase 3 (step editor + pipeline)          Fase 4 (launch)
  T-010 pipeline-edit.ts (puro) ◄─ T-002    T-014 Iniciar+popover+auto-save+guard ◄─ T-008
     │                                       T-015 empty-state + dev:web ◄─ T-006
  T-011 StepEditor (⋯) ◄─ T-007,T-008,T-010
  T-012 Kanban idle add/reorder/remove ◄─ T-010,T-011
  T-013 rename cascade + colisão ◄─ T-010,T-011
```

## Task List

### Fase 0 — Superfície pura do motor (foundation, de-risco)
- [ ] T-001: `serializeConfig` + template canônico em `src/config` (puro, round-trip)
- [ ] T-002: Barrels `loopy/config` + `loopy/backlog` (+ exports/tsup) browser-safe

### Checkpoint A — Fundação do motor
- [ ] `npm run build && npm run typecheck && npm test` (raiz) verdes.
- [ ] `dist/config/index.js` e `dist/backlog/index.js` **sem** `node:fs` (grep).
- [ ] `import { loopyConfigSchema, parseConfig, serializeConfig, initialConfigTemplate } from "loopy/config"` e `{ parseBacklog, backlogOptionsFrom } from "loopy/backlog"` resolvem no typecheck do app.

### Fase 1 — Board no idle a partir do `loopy.yml` (a virada; SC1)
- [ ] T-003: `configToStore` puro (config + backlog → `StoreState` preview)
- [ ] T-004: Comandos Rust `read_project_files` / `write_loopy_yml` (+ backup/retenção)
- [ ] T-005: `useConfigDraft` (load fs/sample, draft em memória, valida zod, dirty/errors, save)
- [ ] T-006: App shell — idle mostra o board + header (dir picker + Iniciar placeholder)

### Checkpoint B — Idle vira editor
- [ ] Abrir um dir com `loopy.yml` válido mostra Kanban/Deps **sem** iniciar o loop (SC1).
- [ ] As colunas do Kanban = steps do pipeline, na ordem; cards do `todo.md` no Backlog.
- [ ] `dev:web`: sample embutido renderiza o board; `npm test`/`typecheck`/`lint` (app) verdes.

### Fase 2 — Aba Config: editar → validar → salvar (SC3/SC4/SC5)
- [ ] T-007: Primitivas `fields/` data-driven (Text/Number/Select[enum]/Toggle/Record/CommandList)
- [ ] T-008: Aba **Config** + **uma** seção fim-a-fim (editar→valida→dirty→Save) + roteamento de erro
- [ ] T-009: Config — **todas** as seções top-level restantes

### Checkpoint C — Config completa e persistente
- [ ] 3ª aba Config existe (SC3); todas as seções top-level editáveis (SC4).
- [ ] Editar → Salvar → `loopy.yml` no disco reflete; backup criado em `.loopy/backups/`.
- [ ] Draft inválido: campo sinalizado inline + contador + banner cross-field; Save/Iniciar travados (SC5).
- [ ] Selects só ofertam valores do enum (teste dos `options`).

### Fase 3 — Editor de step + estrutura do pipeline (SC2/SC7/SC10/SC11/SC12)
- [ ] T-010: `pipeline-edit.ts` puro (add/remove/reorder + `migrateStepType` + revalida refs)
- [ ] T-011: `StepEditor` drawer pelo `⋯` (campos por tipo) + troca de `type` com confirm (SC2/SC10/SC12)
- [ ] T-012: Kanban idle — add step / drag-reorder / remove coluna (SC7)
- [ ] T-013: Rename cascade (`step.id`/agente/lista-de-checks) + guard de colisão (SC11)

### Checkpoint D — Pipeline totalmente editável
- [ ] `⋯` abre o drawer com os campos válidos do tipo; Save reflete no `loopy.yml` (SC2).
- [ ] Trocar o `type` preserva `id`+base, descarta específicos (com confirm) e revalida (SC10).
- [ ] Add/remove/reorder revalida refs `goto`/`on_success` órfãs (SC7).
- [ ] Renomear cascateia p/ todos os referrers e bloqueia colisão (SC11).

### Fase 4 — Iniciar + empty-state + guardas (SC6/SC8/R10/R11)
- [ ] T-014: Botão **Iniciar** (popover de flags) + auto-save antes + guarda de draft sujo (SC6/R10)
- [ ] T-015: Empty-state (sem `loopy.yml`) + "Criar a partir do template" + dev:web completo (SC8/R11)

### Checkpoint E — Completo (SC9)
- [ ] `npm run typecheck` + `lint` + `test` (app **e** motor) verdes (SC9).
- [ ] Manual (Tauri): abrir dir → editar step/config → Salvar → conferir `loopy.yml` no disco →
      Iniciar → o Run usa o config editado (SC6).
- [ ] Todos os SC1–SC12 do spec marcados.

## Comandos / CI

Como a change toca **motor** (`src/config`, `package.json`, `tsup`) **e** app (`apps/menubar`), a
lista `ci` do `loopy.yml` desta change deve cobrir os dois lados. Sugestão para o `checks.ci` do
`loopy.yml` do Run (o usuário configura ao rodar):

```
- { name: build-engine, run: "npm run build" }          # produz dist p/ o pacote publicado
- { name: typecheck-engine, run: "npm run typecheck" }
- { name: test-engine, run: "npm test" }
- { name: typecheck-app, run: "npm run typecheck -w apps/menubar" }
- { name: lint-app, run: "npm run lint -w apps/menubar" }
- { name: test-app, run: "npm test -w apps/menubar" }
```

(As "Verificação:" por task no `todo.md` são o subconjunto mínimo relevante a cada task.)

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| `node:fs` vazar do source (`load.ts`/`todo.ts`) para o bundle do browser | Alto (app quebra) | Barrel re-exporta só a superfície pura; verificar com build do Vite + grep no bundle (Checkpoint A/B). Fallback documentado: split das puras num módulo sem `node:fs`. |
| Reestruturação do `App.tsx` (T-006) quebrar o fluxo de Run existente | Alto | T-006 preserva o caminho `running` intacto; só adiciona o ramo idle→board. Testes de integração do `App` continuam verdes; o Run só muda de gatilho (Iniciar no header). |
| Ler `loopy.yml` **inválido** sem importar `yaml` no app (D5) | Médio | Resolvido: barrel expõe `parseConfigSource` puro (`yaml.parse`, sem validação); app faz `parseConfigSource` → `safeParse`. |
| `T-009`/`T-012` grandes (muitas seções / drag-reorder) | Médio | Padrão estabelecido em T-008/T-011; T-009 é wiring mecânico com as primitivas de T-007; se T-012 crescer, separar reorder(drag) de add/remove. |
| `parseDeps` achatar o DAG do `todo.md` (D-0001) | Baixo | `Deps:` em linha isolada, ids limpos, sem ponto final (aplicado neste `todo.md`). |
| Backup acumular indefinidamente (C1) | Baixo | Retenção de 10 no `write_loopy_yml` (T-004), coberta por teste Rust. |

## Decisões tomadas (pós-aprovação)

- **Leitura de `loopy.yml` possivelmente inválido, sem `yaml` no app (D5).** ✅ **Aprovado:** o
  barrel `loopy/config` re-exporta uma função nova, pura e aditiva **`parseConfigSource(source):
  unknown`** (só `yaml.parse`, sem validação). O `useConfigDraft` faz `parseConfigSource(source)` →
  `loopyConfigSchema.safeParse(obj)` → issues por path. Mantém a autoridade do parse no motor
  (simétrico a `serializeConfig`) e o app nunca importa `yaml`. É a **terceira** adição pura ao
  `src/config` (junto de `serializeConfig` + `initialConfigTemplate`), extensão explícita ao par R8.

## Open Questions

- Nome canônico do template exportado: `initialConfigTemplate` (objeto) e/ou
  `initialConfigYaml` (string via `serializeConfig`)? (Assumido `initialConfigTemplate` objeto +
  derivar o texto por `serializeConfig`.)
- Ordem canônica das seções em `serializeConfig` — assume-se a ordem do `loopyConfigSchema`
  (version, name, workspace, agents, acp, inputs, checks, pipeline, stop_conditions, concurrency,
  policies, logging, metrics), espelhando o `examples/loopy.yml`.
