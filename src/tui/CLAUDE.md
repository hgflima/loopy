# TUI — renderer ao vivo (Ink) + fallback de linha

## Purpose & Scope
A UX do run: escolhe entre a TUI Ink ao vivo e o fallback append-only de linha, expõe o `UiPort` (gate humano dos steps `approval`) e recebe `StoreEvent`s de progresso. O núcleo de estado/lógica é **desacoplado do React/Ink** (AD-6) para ser testável sem montar JSX.

## Entry Points & Contracts
- `startUi({ flags, … })` → `Ui` (`{ ui, tui, dispatch, stop }`). Decide o renderer **uma vez**: monta Ink **só** quando `flags.tui` (sem `--no-tui`) E stdout é TTY real E um `mount` foi injetado; senão degrada para linha.
- `UiPort` (aprovação): `--yes` curto-circuita para auto-aprovar em qualquer modo; senão TUI usa `ApprovalController`, fallback usa `readline`.
- `MountApp` (Ink) é **injetado** por `mount.tsx` — este módulo (`start.ts`, `store.ts`, `view.ts`, `line-reporter.ts`) nunca carrega React.

## Usage Patterns
- Estado observável em `store.ts`; a árvore visual é validada via `view.ts` (função pura de estado→linhas) separada do Ink (AD-6).
- Progresso flui por `dispatch(event)` → store (TUI) ou `line-reporter` (fallback).

## Anti-patterns
- Não importar React/Ink fora de `mount.tsx`/`components/` — quebra a testabilidade do resto.
- Não pôr lógica de decisão de render nos componentes; ela mora em `start.ts`.

## Dependencies & Edges
- `RunFlags`/`UiPort`: `../types.ts`. Montado por `../index.ts` (`defaultRunLive`).
- Componentes Ink em `components/`; entrada React em `mount.tsx`.

## Patterns & Pitfalls
- **`defaultRunLive` chama `startUi({ flags })` sem `mount`** → hoje o caminho vivo cai no fallback de linha e não empurra `StoreEvent`s de progresso. A TUI Ink existe e é testada via store, mas o fio `mount.tsx → index.ts` ainda não está ligado. Verifique isso antes de assumir que a TUI aparece num run real.
