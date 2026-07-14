# TUI — renderer Ink, fallback de linha e a camada pública de estado/transporte

## Purpose & Scope
Duas responsabilidades hoje:
1. **A UX do run no terminal**: escolhe entre a TUI Ink ao vivo e o fallback append-only de linha, e expõe o `UiPort` (gate humano dos steps `approval`).
2. **A camada de estado/apresentação/transporte que outros processos consomem**: `store.ts`, `view.ts` e `transport.ts` são **API pública** — subpath exports (`@hgflima/loopy/tui/{store,view,transport}`, com `dts`) usados pela **GUI menubar** (`apps/menubar/`). O núcleo é desacoplado de React/Ink (AD-6): estado, layout e frames são puros e testáveis sem montar JSX.

## Entry Points & Contracts
- `startUi({ flags, … })` → `Ui` (`{ ui, tui, dispatch, stop, transport? }`). **Dois eixos ortogonais**, não uma escolha binária:
  - *Renderer*: Ink **só** quando `flags.tui` (sem `--no-tui`) E stdout é TTY real E um `mount` foi injetado; senão, fallback de linha.
  - *`--emit-events`*: faz **fan-out** sobre qualquer um dos dois renderers, emitindo NDJSON no **stdout** e redirecionando todo texto de log para **stderr** (stdout vira canal de dados). É o gate de toda a camada de transporte.
- **`transport.ts` (ADR-0007)** — o contrato com a Native UI. Frames discriminados por `frame`:
  - `event` — wrapper de `StoreEvent` (motor → UI);
  - `control` — `run_started` / `run_finished` / `approval_requested`;
  - `command` — `approval_decision` (UI → motor, por stdin).
  `parseTransportLine` **nunca lança** (erro como valor — AD-5); `createEventTransport(sink)` é best-effort e **engole exceção do sink** (AD-1: consumidor quebrado nunca perturba o Run).
- `UiPort` (aprovação) tem **três** transportes: `--yes` curto-circuita (auto-aprova); sob `--emit-events` a decisão vem por **stdin NDJSON** (`createStdinApproval`, `approval.ts`); senão TUI usa `ApprovalController` e o fallback usa `readline`.
- `store.ts` — `reduce`/`initialState`, **13 variantes de `StoreEvent`** (`pipeline_declared`, `edges_set`, `task_registered`, `task_started`, `step_started`, `attempt_started`, `check_started`, `check_finished`, `stream_chunk`, `acp_traffic`, `usage_sample`, `step_finished`, `task_finished`), selectors (`readyTasks`/`runningTasks`/`blockedTasks`/`skippedTasks`) e `ACP_LOG_CAP`.
- `MountApp` (Ink) é **injetado** por `mount.tsx` — `start.ts`/`store.ts`/`view.ts`/`transport.ts`/`line-reporter.ts` nunca carregam React.

## Usage Patterns
- Estado observável em `store.ts`; a árvore visual é validada via `view.ts` (função pura de estado→linhas) separada do Ink (AD-6).
- Progresso flui por `dispatch(event)` → store (TUI) ou `line-reporter` (fallback) → e, sob `--emit-events`, também para o `EventTransport`.
- **Multi-agente (ADR-0006):** quando >1 Agente está ativo no Run, Stream e Tráfego ACP são prefixados com `[<agent>]` por Sessão. Single-agent = byte-idêntico (sem prefixo).

## Anti-patterns
- **`store.ts`/`view.ts`/`transport.ts` são contrato publicado.** Mudar a shape de `StoreEvent` ou de um frame quebra `apps/menubar/` em tempo de build — trate como irmão do contrato congelado de `../types.ts`, não como detalhe interno.
- Não importar React/Ink fora de `mount.tsx`/`components/` — quebra a testabilidade do resto.
- Não pôr lógica de decisão de render nos componentes; ela mora em `start.ts`.
- Sob `--emit-events`, nunca escrever texto no stdout: ele é o canal NDJSON.

## Dependencies & Edges
- `RunFlags`/`UiPort`: `../types.ts`. Montado por `../index.ts` (`defaultRunLive`), que passa `mount: mountApp`, injeta `emit: ui.dispatch` em `OrchestratorDeps` e usa `ui.transport` para os control frames.
- Componentes Ink em `components/` (`GraphPane`/`TaskListPane`/`StreamPane`), compostos pelo `App.tsx` (Dashboard fixo); entrada React em `mount.tsx`.
- **Consumidor externo**: `apps/menubar/` (ver `apps/menubar/CLAUDE.md`) — a **Native UI** do ADR-0007. Decisão: `docs/adrs/0007-transport-ndjson-duplex-native-ui.md`.
- **Emit seam (ADR-0005):** o progresso chega via `dispatch(event)`. O orquestrador emite as transições de Task/Step (`OrchestratorDeps.emit`) e os Steps os eventos intra-Step (`StepContext.emit`); o boundary ACP alimenta `acp_traffic`/Stream via `onTraffic`/`onUpdate`.

## Patterns & Pitfalls
- **A Native UI é out-of-process.** O acoplamento com a GUI (`apps/menubar/`) é o **Transport NDJSON** (`transport.ts`, ADR-0007) — o motor roda como **sidecar** (`loopy --no-tui --emit-events <dir>`), não como uma árvore de componentes trocada. `store.ts`/`view.ts`/`transport.ts` são **API pública** (subpath exports com `dts`): mudar a shape de um `StoreEvent` ou de um frame quebra a GUI em tempo de build.
- **Dashboard vivo (ADR-0005):** num TTY real (sem `--no-tui`, com `mount` injetado) o `App.tsx` monta o Dashboard fixo — Grafo (layout dagre, **~60% da altura**) no topo, split Tasks | Streams abaixo — e o progresso flui pela store. Em modo TUI o logger é **arquivo-only** (o tee no stdout corromperia o frame) e o `notify` (escalação/dirty-parent) é bufferizado e drenado ao stderr **após** `ui.stop()`.
- **Geometria fixa (fullscreen):** o `App` fixa o `<Box>` raiz em `cols × rows` (via `useStdout` + listener de `resize`) e dá a **cada região altura/largura explícita + `overflow="hidden"`** — o frame ocupa um retângulo estável e nunca cresce/rola quando Tasks entram/saem. Os panes sempre renderizam seu frame titulado (presença fixa; placeholder quando vazio) e recebem `width`/`height` do `App` — não decidem tamanho sozinhos. O `mount.tsx` troca pro **alternate screen** (guardado por `isTTY`) e restaura no unmount, então o run some do scrollback ao fim. Um **único** timer de pulso mora no `App` e é passado ao `GraphPane` (não replique timers nos filhos).
- **Arestas do grafo (`view.ts`):** a cabeça de aresta é um triângulo pequeno direcional (`▸◂▴▾`), **distinto** do glifo `▶` do nó running (senão lê como seta dupla), e há **1 célula de folga** entre a cabeça e o nó (`adjacentToNode` reserva a célula-gap; a direção sai do passo final rumo ao nó). O nó mantém glifo+id (`nodeLabel`).
- **ACP fora do dashboard:** o painel ACP foi **removido** (não servia como sinal ao vivo — cada chunk de texto virava um `session/update`, duplicando o que o Stream já mostra). O Tráfego JSON-RPC do seam `onTraffic` alimenta só o **log de arquivo** (`capture_acp_traffic`/`--verbose`, via `logTraffic` + `acpTrafficSummary` em `acp/client.ts`, que expõe o sub-tipo do `session/update`) e o **fallback de linha** (verbose). O reducer da store ainda existe (`acp_traffic` → colapsa idênticos consecutivos num `count`/`×N`) — dado mantido para um eventual consumidor (Native UI), **sem view** no Dashboard.
- **AD-6 — apresentação pura:** toda matemática e estilo (layout dagre em `computeDagreLayout`→`GraphGeometry` — `layoutGraph` é só um wrapper —, `renderGraph`, `pulseFrame`, `COLORS`) vivem puros em `view.ts`; os `.tsx` são wrappers finos. Isso já se pagou: a **Native UI** (`apps/menubar/`, a GUI Tauri — **não** OpenTUI, que nunca existiu no código) importa `computeDagreLayout` e o `store` via subpath export e escala célula→pixel para o React Flow. Um layout, dois renderers.
- **AD-1 — só observa:** o Dashboard nunca altera o Run. `emit`/`onTraffic` são aditivos, no-op por omissão, e nenhuma tecla fora do Gate de Aprovação afeta o loop. `RunLoopResult` é byte-idêntico com e sem os seams.
- **Débito aberto** (`.harn/devy/debts/`): **D-0005** — `start.ts` emite o control frame `approval_requested` com **`taskId: ""` e `stepId: ""` hardcoded**, embora o frame declare ambos. A GUI casa a decisão pelo `requestId` (então funciona), mas fica sem âncora para associar o gate à Task.
