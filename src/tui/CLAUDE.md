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
- `RunFlags`/`UiPort`: `../types.ts`. Montado por `../index.ts` (`defaultRunLive`), que passa `mount: mountApp` e injeta `emit: ui.dispatch` em `OrchestratorDeps`.
- Componentes Ink em `components/` (`GraphPane`/`TaskListPane`/`StreamPane`/`AcpLogPane`), compostos pelo `App.tsx` (Dashboard fixo); entrada React em `mount.tsx`.
- **Emit seam (ADR-0005):** o progresso chega via `dispatch(event)`. O orquestrador emite as transições de Task/Step (`OrchestratorDeps.emit`) e os Steps os eventos intra-Step (`StepContext.emit`: `attempt_started`, `check_*`, `stream_chunk`); o boundary ACP alimenta `acp_traffic`/Stream via `onTraffic`/`onUpdate`.

## Patterns & Pitfalls
- **Dashboard vivo (ADR-0005):** num TTY real (sem `--no-tui`, com `mount` injetado) o `App.tsx` monta o Dashboard fixo — Grafo (layout dagre) no topo, split Tasks | Stream+Logs abaixo — e o progresso flui pela store. Em modo TUI o logger é **arquivo-only** (o tee no stdout corromperia o frame) e o `notify` (escalação/dirty-parent) é bufferizado e drenado ao stderr **após** `ui.stop()`.
- **AD-6 — apresentação pura:** toda matemática e estilo (layout dagre em `layoutGraph`→`GraphGeometry`, `renderGraph`, `pulseFrame`, `COLORS`) vivem puros em `view.ts`; os `.tsx` são wrappers finos. A **Native UI** (OpenTUI, futura) troca só o renderer, reaproveitando `view.ts` + `store`.
- **AD-1 — só observa:** o Dashboard nunca altera o Run. `emit`/`onTraffic` são aditivos, no-op por omissão, e nenhuma tecla fora do Gate de Aprovação afeta o loop. `RunLoopResult` é byte-idêntico com e sem os seams.
