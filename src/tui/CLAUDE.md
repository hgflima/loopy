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
- **Multi-agente (ADR-0006):** quando >1 Agente está ativo no Run, Stream e Tráfego ACP são prefixados com `[<agent>]` por Sessão. Single-agent = byte-idêntico (sem prefixo).

## Anti-patterns
- Não importar React/Ink fora de `mount.tsx`/`components/` — quebra a testabilidade do resto.
- Não pôr lógica de decisão de render nos componentes; ela mora em `start.ts`.

## Dependencies & Edges
- `RunFlags`/`UiPort`: `../types.ts`. Montado por `../index.ts` (`defaultRunLive`), que passa `mount: mountApp` e injeta `emit: ui.dispatch` em `OrchestratorDeps`.
- Componentes Ink em `components/` (`GraphPane`/`TaskListPane`/`StreamPane`), compostos pelo `App.tsx` (Dashboard fixo); entrada React em `mount.tsx`.
- **Emit seam (ADR-0005):** o progresso chega via `dispatch(event)`. O orquestrador emite as transições de Task/Step (`OrchestratorDeps.emit`) e os Steps os eventos intra-Step (`StepContext.emit`: `attempt_started`, `check_*`, `stream_chunk`); o boundary ACP alimenta `acp_traffic`/Stream via `onTraffic`/`onUpdate`.

## Patterns & Pitfalls
- **Dashboard vivo (ADR-0005):** num TTY real (sem `--no-tui`, com `mount` injetado) o `App.tsx` monta o Dashboard fixo — Grafo (layout dagre, **~60% da altura**) no topo, split Tasks | Streams abaixo — e o progresso flui pela store. Em modo TUI o logger é **arquivo-only** (o tee no stdout corromperia o frame) e o `notify` (escalação/dirty-parent) é bufferizado e drenado ao stderr **após** `ui.stop()`.
- **Geometria fixa (fullscreen):** o `App` fixa o `<Box>` raiz em `cols × rows` (via `useStdout` + listener de `resize`) e dá a **cada região altura/largura explícita + `overflow="hidden"`** — o frame ocupa um retângulo estável e nunca cresce/rola quando Tasks entram/saem. Os panes sempre renderizam seu frame titulado (presença fixa; placeholder quando vazio) e recebem `width`/`height` do `App` — não decidem tamanho sozinhos. O `mount.tsx` troca pro **alternate screen** (guardado por `isTTY`) e restaura no unmount, então o run some do scrollback ao fim. Um **único** timer de pulso mora no `App` e é passado ao `GraphPane` (não replique timers nos filhos).
- **Arestas do grafo (`view.ts`):** a cabeça de aresta é um triângulo pequeno direcional (`▸◂▴▾`), **distinto** do glifo `▶` do nó running (senão lê como seta dupla), e há **1 célula de folga** entre a cabeça e o nó (`adjacentToNode` reserva a célula-gap; a direção sai do passo final rumo ao nó). O nó mantém glifo+id (`nodeLabel`).
- **ACP fora do dashboard:** o painel ACP foi **removido** (não servia como sinal ao vivo — cada chunk de texto virava um `session/update`, duplicando o que o Stream já mostra). O Tráfego JSON-RPC do seam `onTraffic` alimenta só o **log de arquivo** (`capture_acp_traffic`/`--verbose`, via `logTraffic` + `acpTrafficSummary` em `acp/client.ts`, que expõe o sub-tipo do `session/update`) e o **fallback de linha** (verbose). O reducer da store ainda existe (`acp_traffic` → colapsa idênticos consecutivos num `count`/`×N`) — dado mantido para um eventual consumidor (Native UI), **sem view** no Dashboard.
- **AD-6 — apresentação pura:** toda matemática e estilo (layout dagre em `computeDagreLayout`→`GraphGeometry` — `layoutGraph` é só um wrapper —, `renderGraph`, `pulseFrame`, `COLORS`) vivem puros em `view.ts`; os `.tsx` são wrappers finos. Isso já se pagou: a **Native UI** (`apps/menubar/`, a GUI Tauri — **não** OpenTUI, que nunca existiu no código) importa `computeDagreLayout` e o `store` via subpath export e escala célula→pixel para o React Flow. Um layout, dois renderers.
- **AD-1 — só observa:** o Dashboard nunca altera o Run. `emit`/`onTraffic` são aditivos, no-op por omissão, e nenhuma tecla fora do Gate de Aprovação afeta o loop. `RunLoopResult` é byte-idêntico com e sem os seams.
