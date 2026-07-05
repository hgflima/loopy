---
number: 0005
title: "TUI de execução: dashboard Ink, emit seam aditivo, layout dagre e view pura renderer-agnóstica"
status: accepted
date: 2026-07-05
status_date: 2026-07-05
supersedes: []
superseded_by: null
---

# ADR-0005 — TUI de execução: dashboard Ink, emit seam aditivo, layout dagre e view pura renderer-agnóstica

## Context

O motor executa um Run inteiro sem visibilidade ao vivo. O caminho vivo
(`defaultRunLive`) montava `startUi` **sem** `mount`, degradando sempre para o
fallback de linha append-only; o Grafo de tasks do ADR-0004 existia só como dado
em `StoreState.edges`, sem materialização visual; e o Tráfego ACP send/recv era
**dead code** em `TaskLogger.acp`. Para quem opera o `loopy` sobre um backlog
paralelo, não havia como ver *o que* cada Sessão faz agora, *quais* Tasks estão
prontas/bloqueadas, nem *onde* o loop travou — só o log rolante.

Forças em tensão:

1. **AD-1 (config-driven):** o motor interpreta, não decide. Uma UI **não pode**
   introduzir nenhuma decisão de loop. A TUI só **observa**: `RunLoopResult`
   precisa ser **byte-idêntico** com e sem os seams de emissão.
2. **AD-6 (apresentação pura):** o layout e o estilo têm de ser testáveis **sem
   montar JSX**. React/Ink não podem vazar para fora de `mount.tsx`/`components/`.
3. **Paralelismo (ADR-0004):** N Sessões concorrentes. Cada evento precisa
   carregar `taskId` e não corromper o estado sob concorrência (ring global,
   no-op guard por Task).
4. **Native UI futura:** preservar a base visual para um renderer nativo
   (OpenTUI, Bun-only) sem reimplementar a matemática de layout — mas **sem**
   trazer OpenTUI para o escopo agora.

Alternativas consideradas:

- **Instrumentar o loop com callbacks de UI dedicados (não-genéricos).**
  Rejeitada: acopla o motor à TUI e tenta o motor a "decidir" apresentação —
  fere AD-1.
- **Renderizar o grafo com layout manual (sem dagre).** Rejeitada: reimplementar
  ranking topológico + waypoints é caro e frágil; dagre já resolve Sugiyama.
- **Adotar OpenTUI agora.** Rejeitada: Bun-only hoje, fora do runtime Node/ESM
  do projeto. Fica como direção (a `view.ts` pura garante a migração barata).

## Decision

### 1. Emit seam aditivo e opcional (AD-1)

Dois pontos de emissão, ambos `no-op` por omissão:

- **`OrchestratorDeps.emit?(event)`** — as transições de que o orquestrador é
  dono: `edges_set`, `task_registered`/`task_started`/`task_finished`,
  `step_started`/`step_finished`. Espelha transições que já ocorrem; **nenhuma
  nova**.
- **`StepContext.emit?(event)`** — eventos intra-Step: `attempt_started`,
  `check_started`/`check_finished` (via `onCheckStart`/`onCheckEnd` aditivos em
  `ChecksRunnerPort`), `stream_chunk` do Step `shell` (via `onChunk` aditivo).

Síncrono, best-effort (engole exceção), **fora** da Seção crítica do parent.
Ausente ⇒ motor byte-idêntico.

### 2. Boundary ACP observa via `onTraffic` (AD-1)

`OpenAgentOptions.onTraffic?(entry, sessionId)` capta o Tráfego JSON-RPC
**send+recv** e o roteia para **dois** consumidores: o arquivo
(`TaskLogger.acp`, antes dead code) e a store (evento `acp_traffic`, buffer
**bounded ~200**). `onUpdate` mapeia o `agent_message_chunk` para o Stream. Pura
observação — zero mudança no comportamento ACP.

### 3. Layout por dagre, geometria pura (AD-6)

`@dagrejs/dagre` computa o layout (Sugiyama, `rankdir:LR`). `layoutGraph`
devolve `GraphGeometry` **pura e renderer-agnóstica** (posição de cada nó em
célula + segmentos das arestas a partir dos `points[]`, em coordenadas inteiras);
`renderGraph` rasteriza para ASCII estilizado (box-drawing + `▶`, cor por
`TaskStatus`, `pulseFrame` na Task `running`), clipando ao painel. **Toda** a
matemática mora em `view.ts`.

### 4. Dashboard Ink fixo, passivo

`App.tsx` compõe o layout **fixo**: header (`k/N done · M running`) → Painel de
Grafo no topo → split Painel de Tasks | (Painel(s) de Stream + Painel de Logs).
O **Pulso** anima a Task `running` (`pulseFrame` puro + `setInterval` só no
`.tsx`). **Sem `useInput`** além do Gate de Aprovação — nenhuma tecla altera o
Run. Empilha ~3 Streams mais recentes + contador `+K` (bounded).

### 5. Wiring no entrypoint

`defaultRunLive` passa `mount: mountApp` a `startUi` e injeta `emit: ui.dispatch`
em `OrchestratorDeps`. Um mapa `sessionId → taskId` (via `basename(cwd) ===
task.id`) carimba os eventos das callbacks ACP. Em modo TUI o logger é
**arquivo-only** (o tee no stdout corromperia o frame) e o `notify` é
bufferizado, drenado ao stderr **após** `ui.stop()`. Captura de tráfego gated por
`--verbose`/`capture_acp_traffic`.

### 6. OpenTUI é a Native UI futura (fora de escopo)

A `GraphGeometry` + `store` + `view.ts` são o contrato durável que uma Native UI
sobre OpenTUI reaproveita trocando só o renderer. Não entra nesta change.

## Consequences

- **Positivo:** visibilidade ao vivo do Run (grafo topológico, lista de Tasks,
  Stream do que executa, Tráfego ACP); AD-1 preservado (loop byte-idêntico com e
  sem seams); AD-6 preservado (view pura testada via `ink-testing-library`, sem
  montar JSX no núcleo); base pronta para a Native UI sem reimplementar layout.
- **Negativo / custo:** duas deps novas (`@dagrejs/dagre` prod, `ink-testing-library`
  dev); mais superfície (`store`/`view`/`components`/emit seam nas fronteiras de
  Step/ACP).
- **Risco aceito:** OpenTUI/Native UI fica só como direção, não implementada; o
  buffer de Tráfego ACP é bounded (~200) e trunca histórico; a captura de tráfego
  é gated para não pesar no caso comum.
- **Neutro:** o fallback de linha append-only permanece para no-TTY/`--no-tui`/CI;
  o Dashboard é opt-in pelo TTY real + `mount`.
