# Plan: C-0009 — Native UI (menu bar app, macOS)

> Complementa `spec.md` (contratos, refino 2026-07-08) e `DESIGN.md` (lente
> relationship-centric). Este doc é a **narrativa de execução**: dependency graph,
> fatiamento vertical, checkpoints e riscos. O backlog consumível está em `todo.md`
> (mesma pasta). Invariantes que atravessam toda task: **AD-1** (o app só observa;
> o Transport é aditivo e gated por `--emit-events`; `RunLoopResult` byte-idêntico
> com/sem a flag), **AD-6** (apresentação pura — reusa `reduce`/`computeDagreLayout`,
> nunca forka), e a disciplina do DESIGN (recusar timeline/slider-de-autonomia/
> dashboard-de-métricas/painel-de-logs).

## Overview

Entregar um **app nativo de barra de menus (macOS)** que espelha ao vivo o mesmo
`StoreState` da TUId do `loopy`, com **paridade estrita**: grafo Deps (layout dagre),
Kanban (Steps como colunas), streams por task em `running`, e o Gate de Aprovação
como **única** superfície de mutação. O motor exporta sua fonte de estado pura via
subpath exports; o app (React 18 + React Flow + Tauri v2) a consome sem fork. O
canal motor→app é um **Transport NDJSON duplex** sobre stdout/stdin de um sidecar
(`loopy` compilado via `bun --compile`, embarcado por `externalBin`).

## Architecture Decisions

- **Monorepo npm workspaces** (`apps/*`): motor permanece React 19 (Ink); app usa
  React 18 (React Flow). `node_modules` isolados por workspace. Motor exporta
  `loopy/tui/store` e `loopy/tui/view` via `exports` do `package.json`.
- **Resolução dos subpath exports = `dist/` buildado** (não source): `exports`
  aponta para `./dist/tui/store.js` + `.d.ts`; `tsup` ganha esses entry points.
  O build do app depende do build do motor. Racional: `store.ts`/`view.ts` já são
  puros (zero React), então o app os consome sem arrastar Ink; apontar para `dist`
  evita o Vite ter de transpilar TS do motor e mantém "npm run build → dist/".
- **Transport = NDJSON duplex, aditivo e gated** (`--emit-events`): Events no
  stdout, Commands (`approval_decision`) no stdin, stderr = diagnóstico. Duas
  classes de frame — **control** (`run_started`/`run_finished`/`approval_requested`,
  envelope só-Transport) vs **StoreEvent** (as transições que a store já conhece,
  incl. o novo `pipeline_declared`). `createEventTransport(sink)` faz tee
  best-effort e **nunca lança** (AD-1). ADR-0007 registra o contrato.
- **`computeDagreLayout` puro = fonte única de layout**: extrair de `layoutGraph`
  (que vira wrapper fino). TUI e app compartilham a mesma geometria; **jamais**
  auto-layout do React Flow (divergiria da TUI). Teste dourado byte-idêntico
  protege a extração.
- **Um Run por vez** (refino #1): o app spawna/observa UM sidecar; relançar mata o
  antigo. `StoreState` único, um binário embarcado.
- **Rust tolerante**: nunca `unwrap()`/`expect()` em I/O do sidecar; erros viram
  `Result<_, String>` propagado ao webview. Um sidecar morto não derruba o host.
- **Detecção de runtime** sempre via `isTauri()` (`@tauri-apps/api/core`), nunca
  `"__TAURI__" in window` (bug conhecido — esconde a UI).

## Dependency Graph

```
                        T-001 (workspaces + subpath exports)
                          │
   ┌──────────────────────┼───────────── engine seams (puros, ∥) ─────────────┐
   │        T-002          │        T-003            T-004         T-005        │
   │  computeDagreLayout   │  pipeline_declared   transport.ts   approval      │
   │  (view.ts)            │  (store+orch)        (NDJSON)        via stdin     │
   └──────────┬────────────┴──────────┬─────────────┬──────────────┬──────────┘
              │                        └──────┬──────┴──────┬───────┘
              │                               ▼             │
              │                        T-006 wire --emit-events (fan-out)
              │                               │             │
      ┌───────┼───────── app (depende de T-001) ────────────┼──────────┐
      │       │                        T-007 scaffold Tauri  │          │
      │       │                          │                   │          │
      │       │        T-008 store-bridge (reduce)           │          │
      │       │           │      │        │                  │          │
      │  T-010 Deps  T-011/012  T-013   T-009 sidecar Rust ──┤          │
      │  (grafo)     Kanban    Streams    │                  │          │
      │                                   T-014 tray/popover/janela/identity
      │                                     │                │          │
      │                                   T-015 LaunchConfig+persist+spawn
      │                                     │                │          │
      │                                   T-016 ApprovalPrompt ←────────┘
      │                                     │
      │                                   T-017 política de notificação
      │                                   T-018 banners de falha do sidecar
      │                                     │
      └──────────────────── T-019 bun --compile + externalBin + tauri build (.app)
```

Ordem: **fundação bottom-up** (exports → seams do motor → wiring), depois **fatias
verticais do app** onde cada uma entrega uma capacidade visível ponta-a-ponta
(estado vivo → grafo → Kanban → streams → shell nativo → aprovação → empacotamento).

## Vertical Slices & Phases

### Fase 0 — Fundação (T-001)
O seam de exports. Sem ele o app não importa `reduce`/`computeDagreLayout`.

### Fase 1 — Engine seams (T-002 ∥ T-003 ∥ T-004 ∥ T-005 → T-006)
Quatro seams puros no motor, cada um testável isolado e **byte-idêntico** com a
flag off. T-002/003/004/005 tocam arquivos distintos (`view.ts`, `store.ts`+orch,
`transport.ts`, `approval.ts`) → paralelizáveis. T-006 os funde no wiring de
`--emit-events` e prova a invariância de `RunLoopResult` (AD-1). Ao fim, SC #2/#3.

### Fase 2 — Scaffold + estado vivo (T-007 → T-008; T-009)
O app existe, recebe NDJSON de um sidecar real e reduz para `StoreState` — antes
de qualquer render sofisticado. `dev:web` alimenta um feed mockado.

### Fase 3 — Grafo Deps (T-010)
Primeira vista rica: React Flow com posições de `computeDagreLayout` (SC #4).

### Fase 4 — Kanban (T-011 → T-012)
Grouper puro (Backlog → Steps → Fim; `goto` = card volta) + board + ViewSwitcher
(default Kanban). O fix-loop é a estrela do DESIGN (SC #5).

### Fase 5 — Streams + shell nativo (T-013; T-014 → T-015)
Streams por task em `running`; tray + popover-glance + janela + identidade macOS
accessory↔regular; LaunchConfig (picker + flags) + persistência + spawn/relaunch.

### Fase 6 — Aprovação + sinal (T-016 → T-017)
Gate ponta-a-ponta (prompt confiável + `approval_decision` via stdin + notificação
que só alerta + badge ⚠) e a política de notificação (SC #6).

### Fase 7 — Robustez + empacotamento (T-018 → T-019)
Banners de falha do sidecar (nunca derruba o app) e o `.app` self-contained sem
Node (SC #7).

## Checkpoints

- **Checkpoint 1 (após T-006):** `npm run typecheck && npm run lint && npm test`
  verdes na raiz; `loopy --no-tui --emit-events <fixture>` emite
  `run_started`→`pipeline_declared`→…progresso…→`run_finished` em NDJSON no stdout;
  `RunLoopResult` byte-idêntico com/sem a flag. Revisão humana.
- **Checkpoint 2 (após T-009):** o app recebe NDJSON de um sidecar real e reduz
  para `StoreState` (contagem done/total correta); crash do sidecar não derruba o
  app. Revisão humana.
- **Checkpoint 3 (após T-012):** grafo Deps + Kanban renderizam ao vivo sobre um
  Run real; task ativa pulsa; um `goto` volta o card de coluna.
- **Checkpoint 4 (Complete, após T-019):** SC #1–#7 satisfeitos; `.app` lança e
  observa um Run local ponta-a-ponta sem Node.

## Testing Strategy (por camada)

- **Motor (vitest):** `reduce` exaustivo (sem `default`); teste dourado
  `layoutGraph`/`renderGraph` byte-idêntico após extrair `computeDagreLayout`;
  round-trip NDJSON de cada variante Event/Command; `RunLoopResult` byte-idêntico
  com/sem `--emit-events`.
- **Webview (vitest + Testing Library):** paridade do store-bridge
  (serialize→parse→reduce == in-process); grouper do Kanban puro; TaskNode
  renderiza `COLORS[status]` + pulso no `running` (RTL + `ReactFlowProvider`).
- **Rust (cargo test):** framing de linha do stdout; formatação NDJSON do
  `approval_decision`.
- **Manual:** Run real sobre um repo-fixture com grafo/Kanban/streams ao vivo;
  crash do sidecar não derruba o app; gate ponta-a-ponta.

## Risks & Mitigations

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Extração de `computeDagreLayout` altera o layout | Alto | Teste dourado byte-idêntico de `layoutGraph`/`renderGraph` **antes** de refatorar (T-002). |
| `--emit-events` altera `RunLoopResult` (viola AD-1) | Alto | Fan-out best-effort **fora** da seção crítica; teste explícito de byte-identidade com/sem flag (T-006). |
| Subpath export puxa React/Ink pro app | Médio | `store.ts`/`view.ts` são puros; export aponta para `dist` desses módulos, não o barrel do motor; teste de import no Vite (T-001). |
| Toolchain Tauri/Rust/bun pesado e novo no repo | Médio | Isolar em `apps/menubar`; `lint`/`typecheck` da raiz ignora `src-tauri/`/`target/`; validar `cargo`/`bun` cedo (T-007/T-009). |
| Notification action-buttons irregulares no Tauri | Médio | Notificação **só alerta**; decisão vive em superfície confiável (janela/popover) — refino #7 (T-016). |
| Contaminação do harness `.claude/` entre tasks paralelas | Médio | eslint ignora `.claude/`/`.worktrees/`; commit exclui `:!.claude`; declarar `Deps:` p/ serializar tasks no mesmo arquivo. |
| `bun --compile` gera binário só p/ o host arm64 | Baixo | Universal binary fora do v1 (assumption de build do spec); documentar. |

## Open Questions

Nenhuma bloqueante — as três Open Questions originais e o resto fecharam no refino
(2026-07-08, ver `spec.md` §Decisões do refino). Decisão de implementação não
interviewada assumida neste plan: **subpath export aponta para `dist/`** (ver
Architecture Decisions); reverter para source-based é local a T-001 se o Vite
preferir.
