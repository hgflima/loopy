# Spec: TUI de execução — dashboard ao vivo do Run (grafo dagre, lista de Tasks, stream do Agente/Shell e tráfego ACP)

> Feature spec derivada do glossário `CONTEXT.md` e do estado atual do motor.
> **Introduz** o ADR-0005 (a criar): o motor passa a **emitir** o progresso do Run
> como `StoreEvent`s e a **renderizar** um dashboard Ink ao vivo — completando o
> fio `mount.tsx → index.ts` deixado pendente (o "T-017" prometido pela store).
> Invariante mantido (AD-1): a TUI **só observa e desenha** o que o motor emite;
> **não decide** nada do loop. Invariante mantido (AD-6): toda a lógica de
> apresentação (geometria do grafo, símbolos, cores, pulso) vive na **view pura**
> (`src/tui/view.ts`), renderer-agnostic — é a **base visual** que uma futura
> **Native UI** reaproveita sem carregar Ink.
>
> **Depende de** C-0006/ADR-0004 (o DAG de Tasks, `topoLayers`, `StoreState.edges`
> e os status `blocked`/`skipped`/`paused` já existem como **modelo de dados**;
> C-0006 entregou o grafo e **deferiu explicitamente o rendering** — §7/OQ5 daquela
> spec). Esta feature é exatamente esse rendering diferido, mais o emit seam que o
> alimenta.
>
> **Refinada via `/devy:refine`** (2ª rodada de entrevista): seis decisões
> estruturantes tomadas — (1) **OpenTUI é a Native UI futura**, fora de escopo;
> C-0007 fica no Ink; (2) o **layout do grafo usa `@dagrejs/dagre`** (geometria pura,
> reaproveitada pelo OpenTUI); (3) o **Painel de Logs captura tráfego ACP send+recv**
> gated por `--verbose`; (4) **checks acendem ao vivo** via callback aditivo no runner;
> (5) os `.tsx` ganham cobertura com **`ink-testing-library`**; (6) em modo TUI os
> **logs do motor vão só pro arquivo** (+ `notify` diferido). Ver *Decisões resolvidas*.

## Objective

Dar ao operador do `loopy` uma **interface de terminal ao vivo** que torna
observável, em tempo real, tudo que uma Run faz: **qual é o grafo de Tasks e como
ele progride** (verde = concluída, cyan pulsante = executando agora, amarelo =
aguardando), **quais Tasks já rodaram ou falharam**, **o que o Agente/Shell está
produzindo agora** e **o tráfego ACP por baixo do capô**. Hoje isso é invisível: a
store observável (`src/tui/store.ts`), a view pura (`src/tui/view.ts`), os
componentes Ink (`App.tsx`, `TaskRow`, `StreamPane`) e o fallback de linha existem e
são testados, **mas o motor nunca emite um `StoreEvent`** e o **Ink nunca é
montado** — `defaultRunLive` chama `startUi({ flags })` **sem `mount`**
(`src/index.ts:331`), então **todo run vivo cai no fallback de linha**
(`src/tui/CLAUDE.md`). O contrato está pronto; falta ligar o fio e desenhar os
painéis que faltam.

O coração desta feature é, portanto, duplo: (1) **o emit seam** — o orquestrador e
os interpreters de Step passam a empurrar `StoreEvent`s nas transições de estado, e
o entrypoint monta a árvore Ink; (2) **o dashboard** — um layout Ink fixo com quatro
painéis (**Grafo** via dagre, **Tasks**, **Stream**, **Logs/ACP**) que consomem a
store. A TUI é **passiva** (nenhum input altera o loop — AD-1) e **parallel-ready**:
com `concurrency > 1`, várias Tasks aparecem `running` e vários streams empilham (a
store já é keyed por `taskId`, sem singleton — C-0006).

**Usuário-alvo:** quem opera o `loopy` num terminal interativo e quer acompanhar uma
Run (especialmente paralela, sob o DAG do C-0006) sem ficar lendo `.loopy/logs/*.log`
ou o append-only de linha — vendo o grafo colorir, a Task ativa pulsar, os checks
passarem e o Agente "pensar" ao vivo.

**Critérios de aceite (do pedido), reenquadrados como Success Criteria** — ver seção
homônima. Em resumo, os seis painéis do pedido: (1) grafo do dependency graph com
verde = concluída; (2) animação/pulso da Task ativa; (3) amarelo = aguardando deps;
(4) frame de Tasks (verde+check = executada, vermelho = falhou); (5) painel de logs;
(6) stream textual (saída de Step `shell` ou mensagens trocadas com o Agente em Step
`agent`). **Sem TTY / `--no-tui` ⇒ o fallback de linha atual é preservado** (mesmo
padrão de degradação de hoje — regressão zero fora do modo TUI).

## Enquadramento (o que o pedido esconde)

1. **"Gráfico de execução a partir do dependency graph" já é modelo de dados — o que
   falta é *posicionar e desenhar*.** C-0006/ADR-0004 entregou o DAG como **dados**:
   `StoreState.edges: readonly [string, string][]` (`src/tui/store.ts:92`), os status
   `blocked`/`skipped`/`paused` (`store.ts:31-45`) e as **camadas topológicas** puras
   `topoLayers(graph)` (`src/scheduler/graph.ts`). Mas o DAG do loopy **não tem
   coordenadas** — só arestas. `topoLayers` dá a coluna (camada), **não** a linha nem
   os pontos de aresta. **Decisão (OQ12):** o layout é computado por **`@dagrejs/dagre`**
   (Sugiyama em camadas, síncrono), que devolve `x/y` por nó e `points[]` (waypoints)
   por aresta; o `view.ts` rasteriza essa geometria para ASCII. Isso evita rotear
   arestas à mão (a parte frágil) e produz **geometria renderer-agnóstica** que a
   futura Native UI (OpenTUI) reaproveita tal-e-qual. O `App.tsx` atual renderiza
   **uma lista de linhas** (`TaskRow` por Task), **não** um grafo — o Painel de Grafo
   é **novo**.

2. **O verdadeiro bloqueador é o emit seam morto — antes de qualquer painel, o motor
   precisa falar com a store.** Confirmado por grep: **nenhum `StoreEvent` é produzido
   em `src/` fora de `store.ts`/`line-reporter.ts`** (que os consomem);
   `OrchestratorDeps` (`src/loop/orchestrator.ts`) **não tem porta de progresso**;
   `StepContext` (`src/types.ts`) tem `session`/`checks`/`ui`/`logger`/`resolve` mas
   **não `emit`**; `openAgent` é chamado **sem `onUpdate`** (`src/index.ts:333`), então
   o `session/update` do ACP **nunca** vira um `stream_chunk`. **Decisão:** adicionar
   um **emit seam aditivo** — `OrchestratorDeps.emit(event)` e `StepContext.emit?(event)`
   — e ligar `mount` (de `tui/mount.tsx`) em `startUi` no `defaultRunLive`. O emit é
   **puro efeito de observação**: não muda nenhuma decisão nem resultado do loop
   (AD-1). Um `emit` ausente/no-op deixa o motor **byte-idêntico** ao de hoje.

   **Correção (fonte do stream do Agente):** o texto do Agente **não** pode sair do
   `ctx.emit` do `src/steps/agent.ts` — o step fica **bloqueado** em
   `await ctx.session.prompt()` enquanto os chunks chegam por um handler de
   notificação *posterior*. Então: o **stream do Agente vem do `onUpdate` global**
   (`session/update` → `stream_chunk`, via `agentChunkText`), e o **stream do `shell`
   vem do `ctx.emit`** (o step dirige o `execa` ele mesmo — §6). O `agent.ts` emite via
   `ctx.emit` apenas `attempt_started`.

   **Atribuição `sessionId → taskId`:** o `onUpdate` é um callback **único e global**
   (1 processo ACP por Run, AD-3), keyed por `sessionId`. Como `worktreePathFor` =
   `<dir>/<task.id>`, vale `basename(cwd) === task.id`; registra-se `sessionId → taskId`
   quando a Sessão resolve (no wrapper de `sessionProvider`, em `index.ts`), e o
   `onUpdate`/`onTraffic` lê esse mapa para carimbar o `taskId`. **Zero mudança no
   contrato ACP.**

3. **O vocabulário de cores atual não bate com o pedido — "amarelo = aguardando" exige
   remapear `COLORS.task`.** Hoje (`src/tui/view.ts:39-42`): `pending`/`blocked` =
   `gray`, `skipped`/`paused` = `yellow`. O pedido amarra **amarelo = aguardando
   dependências** (crit. 3) e **vermelho = falhou** (crit. 4). **Decisão:** remapear a
   tabela `COLORS.task`:

   | status      | glyph | cor           | significado no dashboard                 |
   |-------------|:-----:|---------------|-------------------------------------------|
   | `done`      | `✔`  | green         | concluída / merjada (crit. 1)             |
   | `running`   | `▶`  | cyan (pulsa)  | executando agora (crit. 2)                |
   | `pending`   | `•`  | yellow        | aguardando (registrada, não iniciada)     |
   | `blocked`   | `◦`  | yellow        | aguardando deps pendentes (crit. 3)       |
   | `escalated` | `✖`  | red           | falhou (crit. 4)                          |
   | `skipped`   | `⊘`  | gray (dim)    | pulada (ancestral falhou — skip transit.) |
   | `paused`    | `⏸`  | magenta       | pausada (resumível)                       |

   `skipped`/`paused` saem do amarelo para liberá-lo ao conceito "aguardando".
   **Correção (OQ5):** o remap muda **apenas o render Ink**. O `line-reporter` usa só
   `SYMBOLS` (`src/tui/line-reporter.ts:27`), que **não** mudam — logo o fallback de
   linha é **inalterado** (a afirmação original "muda também o fallback" estava
   errada). `SYMBOLS.task` mantém-se; a exaustividade por `TaskStatus`
   (`view.test.ts`, teste de `COLORS.task`) é atualizada para a nova tabela.

4. **"Animação (pulsando)" é re-render temporizado no Ink — e é o único ponto que a
   TUI ganha um relógio.** O dashboard é **passivo** (sem `useInput`; nenhuma tecla
   altera o loop). O pulso da Task `running` é um `setInterval` (~500 ms) num efeito
   Ink que avança um "tick" e re-renderiza, alternando a ênfase do glyph
   (`bold ↔ dimColor`, ou `▶ ↔ ▷`). A **fase** é pura em `view.ts` (`pulseFrame(tick)`),
   testável sem montar Ink. O **fallback de linha não anima** (append-only). O relógio
   vive **só no `.tsx`**; a store/`view.ts` continuam sem tempo.

5. **"Logs" ≠ "Stream": o painel de logs mostra tráfego ACP; o de stream mostra a
   saída legível.** Decisão da entrevista. **Stream** (crit. 6) = texto do
   `agent_message_chunk` (via `agentChunkText` — `src/acp/client.ts:197`) **e** o
   `stdout`/`stderr` de Step `shell`, acumulado em `TaskState.stream` e mostrado por
   `StreamPane`/`streamTail` (já existe). **Logs** (crit. 5) = **tráfego ACP**
   send/recv que `AcpTrafficEntry { direction, method?, payload }` já modela
   (`logger.ts:30`).

   **Correção (feed construído do zero):** hoje a captura ACP é **código morto** —
   grep confirma que **`TaskLogger.acp(...)` nunca é chamado** em `src/`, e
   `defaultRunLive` abre `openAgent` **sem `onUpdate`**. Não existe "hoje grava em
   arquivo": o feed é **novo**. **Decisão (OQ13):** cobertura **send + recv**, gated
   por `--verbose`/`capture_acp_traffic` (um gate só, consistente com o `TaskLogger`).
   Um **callback de observação `onTraffic(entry, sessionId)`** no boundary ACP capta:
   os **recv** (o `onUpdate` das `session/update` + os requests do Agente em `client.ts`:
   permission/fs/terminal) **e** os **send** (os `ctx.request`/`ctx.notify` do motor em
   `session.ts`/`agent.ts`: `session/set_mode`/`prompt`/`cancel`/`initialize`). O
   mesmo `onTraffic` alimenta **dois** consumidores — o `TaskLogger.acp` (arquivo) e o
   `dispatch` da store (evento **novo `acp_traffic`**, buffer **bounded**) — sem a
   store depender do arquivo. É observação pura (AD-1): não altera o loop.

6. **O Step `shell` hoje NÃO streama — captura no fim.** `runShellCommandWithExeca`
   (`src/steps/shell.ts`) roda via `execa` e devolve `stdout`/`stderr` inteiros no
   `StepResult` (`shell.ts:100-125`); nada sai ao vivo. Para o crit. 6 ("saída do
   shell" ao vivo), o Step `shell` passa a **emitir `stream_chunk`** via `ctx.emit`
   conforme o `execa` produz linhas (um `onChunk` aditivo no `RunShellCommand`;
   streaming aditivo; o `StepResult` agregado permanece igual). Isso não muda a
   semântica do Step — só espelha a saída para a store enquanto ela chega.

7. **A Native UI é o OpenTUI — e fica FORA de escopo, mas a base visual é preservada
   renderer-agnostic para ela.** OpenTUI (`github.com/anomalyco/opentui`) é um
   **framework de TUI completo** (core nativo em Zig, reconciler React/Solid próprio,
   framebuffer truecolor `drawText`/`fillRect`, renderer WebGPU) — o candidato natural
   à Native UI. **Não entra nesta change** por três motivos: (a) é **Bun-only** hoje
   (suporte a Node "in progress"), e o loopy é Node ≥20 ESM publicado no npm;
   (b) **substitui o Ink por inteiro** (reconciler próprio), não encaixa dentro dele —
   adotá-lo = reescrever toda a TUI; (c) **desenha, mas não faz layout de DAG** — ainda
   dependeria de dagre. **Decisão (OQ17):** OpenTUI vira uma **change futura dedicada**
   que troca só o renderer, reaproveitando `view.ts` (a `GraphGeometry` do dagre + as
   tabelas de cor/símbolo + `pulseFrame`) e a `store` intactos. Por isso o invariante a
   proteger é rígido: **toda** decisão de apresentação mora em `src/tui/view.ts`
   (**puro**, sem React/Ink — AD-6); os `.tsx` são wrappers finos. O Painel de Grafo,
   por ser novo, **deve** nascer com sua geometria e rasterização em `view.ts`, não
   dentro do `.tsx` — senão a Native UI teria de reimplementá-lo.

8. **Passiva por design — a TUI não pode virar um decisor (AD-1).** O dashboard não
   tem navegação, seleção nem scroll (isso seria pós-MVP e exigiria `useInput`). A
   única interação de teclado que já existe e **permanece** é o **Gate de Aprovação**
   (`ApprovalPrompt`/`ApprovalController` — `y`/`s`/`n`), que é do domínio (Step
   `approval`), não da observabilidade. Nenhum outro input.

9. **Em modo TUI, o Ink é dono do stdout — os logs do motor precisam sair de lá.**
   Hoje o `defaultRunLive` usa `teeLogger`, que **ecoa `info`/`debug` no stdout** e
   `notify` (escalação/dirty-parent) no stderr. Com o Dashboard montado (`patchConsole:
   false`), esses writes **corromperiam o frame** — "não dá problema hoje" só porque a
   TUI nunca monta. **Decisão (OQ16):** em modo TUI (`ui.tui === true`), `info`/`debug`
   vão **só pro arquivo** (o Dashboard substitui o log rolante), e o `notify` de
   escalação/dirty-parent é **bufferizado e impresso no stderr após o unmount** — o
   mesmo padrão que o Relatório de execução de métricas já segue (impresso após
   `ui.stop()`). Nada se perde em tempo real: escalações **já aparecem** no Painel de
   Tasks (vermelho `✖` + `reason` via `TaskRow`).

## Linguagem ubíqua (adições/precisões — a promover em `CONTEXT.md` + ADR-0005)

- **Dashboard** = o layout **fixo** da TUI de execução: quatro Painéis simultâneos
  (Grafo, Tasks, Stream, Logs), todos vivos, sem foco/navegação. Distinto do
  **fallback de linha** (append-only, no-TTY/`--no-tui`).
- **Painel** (*pane*) = uma região do Dashboard com um recorte do estado do Run.
  Quatro: **Painel de Grafo**, **Painel de Tasks**, **Painel de Stream**, **Painel de
  Logs**.
- **Painel de Grafo** = renderização do **Grafo de tasks** (C-0006) com layout
  computado por **dagre** (camadas Sugiyama, `rankdir:LR`): Tasks na mesma camada =
  candidatas a rodar em paralelo; arestas de dependência desenhadas via os waypoints
  do dagre; cada nó colorido por `TaskStatus`. É a materialização visual do que era só
  dado em `StoreState.edges`.
- **GraphGeometry** = a saída **pura e renderer-agnóstica** de `layoutGraph`: posição
  de cada nó (célula) + os segmentos das arestas (a partir dos `points[]` do dagre),
  em coordenadas de célula. É o **artefato durável** que o `view.ts` rasteriza para
  ASCII hoje e que a Native UI (OpenTUI) reaproveita para desenhar no framebuffer.
- **Native UI** = a TUI futura sobre **OpenTUI** (fora do escopo desta change) que
  troca o renderer Ink por um framebuffer nativo, reaproveitando `view.ts` + `store`.
- **Pulso** (*pulse*) = a animação da Task `running`: alternância temporizada da
  ênfase do glyph no Painel de Grafo/Tasks. Puro em `view.ts` (`pulseFrame`); relógio
  só no `.tsx`. **Só o Dashboard pulsa** (o fallback de linha não).
- **Stream** (precisão) = o texto **legível** do que executa agora: `agent_message_chunk`
  do Agente (via `onUpdate`) **ou** `stdout`/`stderr` do Step `shell` (via `ctx.emit`),
  acumulado em `TaskState.stream` (evento `stream_chunk`). É o "o quê" produzido.
- **Tráfego ACP** (*ACP traffic*) = as mensagens JSON-RPC **send/recv** entre motor e
  Agente (`AcpTrafficEntry { direction, method?, payload }` — `logger.ts:30`),
  exibidas no **Painel de Logs**. É o "por baixo do capô" do protocolo, distinto do
  Stream. Novo evento de store **`acp_traffic`**; buffer **bounded**; gated `--verbose`.
- **Emit seam** (*porta de progresso*) = o ponto onde o motor **emite** `StoreEvent`s.
  Materializado em **`OrchestratorDeps.emit(event)`** (transições de Task/Step de que o
  orquestrador é dono) e **`StepContext.emit?(event)`** (eventos intra-Step:
  `attempt_started`, `check_*`, `stream_chunk` do `shell`). **Aditivo**, no-op por
  omissão, **puro efeito de observação** (não altera o loop — AD-1).
- **onTraffic** = o callback de observação no boundary ACP que capta o tráfego
  send/recv e o roteia para **dois** consumidores (arquivo `TaskLogger.acp` + store
  `acp_traffic`). Carimba `taskId` via o mapa `sessionId → taskId`.

## Design

### Fluxo (motor → emit seam → store → dashboard)

```
                    ┌──────────────── Run (motor) ────────────────┐
 buildGraph ──► edges_set                                          │
 backlog    ──► task_registered × N (blocked se tem deps)          │
     │                                                             │
 scheduler pool (C-0006) ──► por Task: task_started               │  emit(event)
     PC navega o Pipeline ──► step_started / step_finished        ├──────────────►  Ui.dispatch
        Step agent  ──► attempt_started, check_* (ctx.emit)        │                    │
        Step shell  ──► stream_chunk (stdout/stderr ao vivo)       │          ┌─────────┴──────────┐
     Task conclui  ──► task_finished(status)                       │      TUI store          line-reporter
                    │                                              │      (dashboard Ink)    (fallback no-TTY)
 boundary ACP (index.ts):                                          │           ▲
   onUpdate  ──► stream_chunk (Agente) + acp_traffic (recv)  ──────┼───────────┘  (via ui.dispatch,
   onTraffic ──► acp_traffic (send)                          ──────┘               taskId=sessionId→taskId)
                    └──────────────────────────────────────────────┘
```

`startUi` já roteia `dispatch` para a store (TUI) **ou** para o `line-reporter`
(fallback), transparente ao motor (`src/tui/start.ts:107,121`). Esta feature liga o
**produtor** (o motor, por dois caminhos: o emit seam síncrono e as callbacks ACP
assíncronas) e monta o **renderer** (Ink).

### O wiring (emit seam) — `src/loop/orchestrator.ts`, `src/steps/*`, `src/index.ts`

- **`OrchestratorDeps`** ganha `emit(event: StoreEvent): void` (aditivo, opcional). O
  orquestrador emite, **espelhando as transições que já faz** no `status` Map:
  `edges_set` (de `graph.edges`) + `task_registered` (status `blocked` se a Task tem
  deps, senão `pending`) no início; `task_started` no `launchTask`; `task_finished`
  em done/escalate/pause/skip; e `step_started`/`step_finished` ao navegar o PC.
  **Nenhuma transição nova** — só um espelho. `buildTaskStepContext` propaga
  `emit: deps.emit` para o `StepContext`.
- **`StepContext`** ganha `emit?: (event: StoreEvent) => void` (aditivo). Os
  interpreters emitem o que só eles sabem: Step `agent` → `attempt_started` (no loop de
  Verify); Step `shell` → `stream_chunk` (streaming do `execa`, via `onChunk`); e os
  `check_started`/`check_finished` via o **callback do runner de checks** (abaixo).
- **Runner de checks** (`src/checks/runner.ts`): `RunChecksOptions` e a assinatura de
  `ChecksRunnerPort.run` ganham `onCheckStart?(name)`/`onCheckEnd?(name, ok)`
  (aditivos, opcionais). `runChecks` os dispara no loop sequencial. O Step `agent`
  (verify) e o Step `checks` passam esses callbacks encaminhando para
  `ctx.emit(check_started/finished)` com `taskId`+`stepId` — cada check acende
  `running → ✓/✗` **ao vivo** (honra os dois eventos da store).
- **`src/index.ts` `defaultRunLive`**:
  - passa `mount: mountApp` a `startUi` (liga o Ink) e injeta `emit: ui.dispatch` em `deps`;
  - abre `openAgent({ onUpdate, onTraffic })`: `onUpdate` mapeia `session/update` →
    `stream_chunk` (via `agentChunkText`, texto do Agente) **e** → `acp_traffic` (recv);
    `onTraffic` capta os send/recv restantes (requests do Agente + sends do motor);
  - mantém um `Map<sessionId, taskId>` populado no wrapper de `sessionProvider`
    (`basename(cwd) === task.id`); as callbacks ACP lêem esse mapa para carimbar `taskId`;
  - em modo TUI (`ui.tui`), constrói o logger **sem** o tee no stdout (arquivo-only) e
    **bufferiza** o `notify`, drenando-o para o stderr **após** `ui.stop()` (OQ16).
- **Ordem/segurança:** `emit`/`onTraffic` são síncronos, best-effort e **nunca**
  bloqueiam nem lançam para o loop (um dispatch que falhe é engolido — a
  observabilidade não derruba a Run). O emit acontece **fora** de qualquer seção
  crítica do parent (não segura o mutex).

### Store — `src/tui/store.ts` (novo evento + buffer bounded)

```ts
// NOVO evento (aditivo ao union StoreEvent)
| { readonly type: "acp_traffic";
    readonly taskId: string;
    readonly direction: "send" | "recv";
    readonly method?: string;
    readonly summary: string; }   // linha pronta p/ exibir (payload já resumido)

// StoreState ganha, aditivamente, um log ACP global bounded (ring):
interface StoreState {
  readonly tasks: readonly TaskState[];
  readonly edges: readonly [string, string][];
  readonly acpLog: readonly AcpLogLine[];   // NOVO — bounded (~200 últimas)
}
interface AcpLogLine { readonly taskId: string; readonly direction: "send" | "recv";
                       readonly method?: string; readonly summary: string; }
```

O `reduce` para `acp_traffic` **empurra e trunca** (mantém as últimas ~200 — bounded,
não vaza memória num Run longo). Continua **puro** e **parallel-ready** (linhas
carregam `taskId`, então o painel prefixa/filtra por Task). Eventos para Task
desconhecida seguem no-op, como o resto (`store.ts:183`) — mas note que `acp_traffic`
é **global** (vai no `acpLog`, não numa Task), então não passa pelo guard de
`updateTask`: é sempre aplicado, truncando o ring.

### View pura (a base reaproveitável) — `src/tui/view.ts` (AD-6)

- **Remapear `COLORS.task`** conforme a tabela do Enquadramento §3 (amarelo =
  aguardando; skipped→gray, paused→magenta). `SYMBOLS.task` mantém-se.
- **`layoutGraph(edges, statusById, order): GraphGeometry`** (NOVO, puro): monta um
  grafo **dagre** (`rankdir:"LR"`, `nodesep`/`ranksep` pequenos; cada nó com
  `width = len("<glyph> <id>")`, `height = 1`; uma aresta por par `[dep, dependente]`),
  roda `layout(g)` (síncrono), e converte `node.x/.y` + `edge.points` em uma
  `GraphGeometry` de células (posição dos nós + segmentos H/V das arestas), snapada a
  inteiros. **Toda** a matemática fica aqui — a Native UI reaproveita a `GraphGeometry`.
- **`renderGraph(geometry, statusById, tick): StyledRow[]`** (NOVO, puro): rasteriza a
  `GraphGeometry` para um grid de células estilizadas (glyph+id do nó colorido por
  `COLORS.task[status]`, arestas em box-drawing `─│┌┐└┘├┤┬┴` + `▶` na ponta, dim),
  aplicando `pulseFrame(tick)` nas Task(s) `running`. **Clipa** ao tamanho do painel
  (passivo, sem scroll). O `GraphPane.tsx` só imprime as `StyledRow[]` como spans
  `<Text>`.
- **`pulseFrame(tick): "on" | "off"`** (NOVO, puro): a fase do pulso; o `renderGraph`/
  `.tsx` mapeia para `bold`/`dimColor`.
- Reusa `streamTail`, `attemptLabel`, `checkText`.

### Componentes Ink — `src/tui/` (só aqui carrega React/Ink)

- **`components/GraphPane.tsx`** (NOVO): wrapper fino de `renderGraph(...)`; imprime as
  `StyledRow[]` como spans coloridos.
- **`components/TaskListPane.tsx`** (NOVO): o "frame de Tasks" (crit. 4) — uma linha por
  Task em ordem de backlog, glyph+cor por status (verde+`✔` executada; vermelho+`✖`
  falhou), com o step atual/`try k/max`/checks quando `running` (reusa `TaskRow`).
- **`components/StreamPane.tsx`** (EXISTE): um por Task `running` (empilha sob
  concorrência); tail de `TaskState.stream`.
- **`components/AcpLogPane.tsx`** (NOVO): tail de `StoreState.acpLog` (send/recv,
  method, summary), prefixado por `taskId` quando há mais de uma Task ativa.
- **`App.tsx`** (REESCRITO para o Dashboard fixo): compõe o layout —
  header (`loopy · run · k/N done · M running`) → **GraphPane** no topo → abaixo, split
  **TaskListPane** (esq.) | **StreamPane(s)** + **AcpLogPane** (dir.). Usa `useStore`;
  um efeito de `pulse` (`setInterval` + `useState(tick)`) só para animar. Sem `useInput`
  além do `ApprovalPrompt` já existente.
- **`mount.tsx`** (EXISTE): continua o **único** `render` do Ink; passa `store`+`approval`.

Layout-alvo (referência; o dagre pode rotear as arestas de outra forma):

```
┌ loopy · run · 2/6 done · 2 running ───────────────────────────┐
│ N0            N1              N2                                │
│ ✔ T-001 ──┬─▶  ▶ T-003 ──────▶  • T-005                        │
│ ✔ T-002 ──┘    • T-004 ──┐                                     │
│                          └────▶  • T-006                       │
├──────────────────┬────────────────────────────────────────────┤
│ TASKS            │ STREAM · T-003                              │
│ ✔ T-001  done    │ │ implementando o parser combinator…        │
│ ✔ T-002  done    │ │ rodando checks…                           │
│ ▶ T-003  build   │ STREAM · T-004                              │
│   try 2/3 ✓lint  │ │ escrevendo teste de aceite…               │
│ • T-004  wait    ├────────────────────────────────────────────┤
│ • T-005  wait    │ LOGS · acp                                  │
│ • T-006  wait    │ → session/prompt   {turn:4}                 │
│                  │ ← session/update   agent_message_chunk      │
└──────────────────┴────────────────────────────────────────────┘
```

### Fallback de linha — `src/tui/line-reporter.ts`

Continua consumindo os **mesmos** `StoreEvent`s via o mesmo `reduce`, e continua
usando só `SYMBOLS` (o remap de `COLORS` **não** o toca). O novo evento `acp_traffic`
emite uma linha `→/← <method> <summary>` **só** sob `--verbose` (mesmo gate da
captura); sem `--verbose` é no-op no fallback, preservando o append-only.
No-TTY/`--no-tui` → comportamento **preservado**.

### Concorrência (reaproveita C-0006)

O Dashboard já é parallel-ready: `runningTasks(state)` retorna **array**
(`store.ts:363-365`), o `App.tsx` empilha um `StreamPane` por Task `running`, e o
Painel de Grafo colore **todas** as `running` (cada uma pulsa). Nenhum singleton
"Task atual". Com muitas `running`, o painel de Stream limita quantas mostra (as **~3
mais recentes**) + contador "+K" — bounded na altura, sem quebrar o layout.

## Tech Stack

**Duas dependências novas** (Ask-first satisfeito na entrevista):
- **`@dagrejs/dagre`** (dep): layout Sugiyama síncrono, ESM/Node, com tipos TS
  inclusos — computa `x/y` dos nós + `points[]` das arestas para a `GraphGeometry`.
- **`ink-testing-library`** (dev-dep): `render()` + `lastFrame()` para testar os
  `.tsx` compostos (escopo pequeno — ver Testing Strategy).

Sem outras dependências: `ink`+`react` já estão no projeto; a animação usa
`setInterval`/`useState` (Ink); o streaming de `shell` usa o `execa` já presente. Stack
atual: TypeScript/Node ≥20 ESM, `@agentclientprotocol/sdk`, `commander`, `execa`,
`ink`+`react`, `yaml`, `zod`, `vitest`, `tsup`. **OpenTUI é fora de escopo** (Native UI
futura — §7).

## Commands

```
Dev:        npm run dev -- [dir]         # num TTY real → dashboard; ex.: npm run dev -- ../alvo --concurrency 4
Sem TUI:    npm run dev -- [dir] --no-tui   # força o fallback de linha
Verbose:    npm run dev -- [dir] --verbose  # captura tráfego ACP (arquivo + Painel de Logs)
Typecheck:  npm run typecheck
Lint:       npm run lint
Test:       npm test
Build:      npm run build
```

## Project Structure

```
src/tui/view.ts          → remapeia COLORS.task (amarelo=aguardando; skipped→gray,
                           paused→magenta); + layoutGraph(edges,status,order): GraphGeometry
                           PURO (via @dagrejs/dagre); + renderGraph(geometry,status,tick):
                           StyledRow[] (rasteriza + colore + pulso); + pulseFrame(tick)
src/tui/store.ts         → + evento acp_traffic (aditivo ao StoreEvent); + StoreState.acpLog
                           (ring bounded ~200); reduce trunca; puro/parallel-ready mantidos
src/tui/App.tsx          → REESCRITO p/ Dashboard fixo (header + GraphPane + split
                           TaskListPane | StreamPane(s)+AcpLogPane); efeito de pulso
src/tui/components/GraphPane.tsx     → NOVO (wrapper fino de renderGraph → spans coloridos)
src/tui/components/TaskListPane.tsx  → NOVO (frame de Tasks; reusa TaskRow)
src/tui/components/AcpLogPane.tsx     → NOVO (tail de StoreState.acpLog)
src/tui/components/StreamPane.tsx     → inalterado (tail de TaskState.stream)
src/tui/line-reporter.ts → trata acp_traffic só sob --verbose; usa SYMBOLS (inalterado)
src/loop/orchestrator.ts → OrchestratorDeps.emit(event) (aditivo); emite edges_set,
                           task_registered/started/finished, step_started/finished
                           espelhando as transições existentes (nenhuma nova);
                           buildTaskStepContext propaga emit ao StepContext
src/steps/agent.ts       → emite attempt_started via ctx.emit; passa onCheckStart/End
                           (do verify) → ctx.emit(check_*)
src/steps/shell.ts       → onChunk aditivo no RunShellCommand → stream_chunk (StepResult
                           inalterado)
src/steps/checks.ts      → passa onCheckStart/End → ctx.emit(check_*)
src/checks/runner.ts     → RunChecksOptions + ChecksRunnerPort.run ganham
                           onCheckStart?/onCheckEnd? (aditivos); runChecks os dispara
src/acp/agent.ts,client.ts → onUpdate mapeia session/update → stream_chunk + acp_traffic(recv);
                           + onTraffic (send+recv) no boundary; observação pura (AD-1)
src/acp/session.ts       → sends (set_mode/prompt/cancel) chamam onTraffic("send", …)
src/types.ts             → aditivo: OrchestratorDeps.emit; StepContext.emit?;
                           ChecksRunnerPort.run += onCheckStart?/onCheckEnd?;
                           StoreEvent += acp_traffic; StoreState.acpLog
src/index.ts             → defaultRunLive: mount=mountApp; emit=ui.dispatch; openAgent
                           ({onUpdate,onTraffic}); Map<sessionId,taskId>; em modo TUI
                           logger arquivo-only + notify diferido pós-unmount
docs/adrs/0005-*.md      → ADR (emit seam + Dashboard Ink + dagre + view pura +
                           OpenTUI como Native UI futura + AD-1/AD-6)
package.json             → + @dagrejs/dagre (dep) + ink-testing-library (dev-dep)
```

## Code Style

Contrato **aditivo**, provado por `tsc`; apresentação **pura** em `view.ts` (AD-6);
observação **não** altera o loop (AD-1). Ex.:

```ts
// aditivo ao StepContext (src/types.ts) — campos existentes INALTERADOS
export interface StepContext {
  // …session, checks, ui, logger, resolve… (inalterados)
  /** Emite um StoreEvent de progresso (observação). No-op por omissão; nunca lança. */
  readonly emit?: (event: StoreEvent) => void;
}

// aditivo ao ChecksRunnerPort (src/types.ts) — callbacks opcionais p/ check ao vivo
export interface ChecksRunnerPort {
  run(
    checks: readonly CheckCommand[],
    opts: {
      readonly cwd: string;
      readonly onCheckStart?: (name: string) => void;
      readonly onCheckEnd?: (name: string, ok: boolean) => void;
    },
  ): Promise<ChecksReport>;
}

// aditivo ao union StoreEvent (src/tui/store.ts)
export type StoreEvent =
  // …variantes existentes…
  | { readonly type: "acp_traffic"; readonly taskId: string;
      readonly direction: "send" | "recv"; readonly method?: string;
      readonly summary: string };

// PURO em view.ts — a Native UI (OpenTUI) reaproveita a geometria sem carregar Ink
export function layoutGraph(
  edges: readonly [string, string][],
  statusById: ReadonlyMap<string, TaskStatus>,
  order: readonly string[],
): GraphGeometry { /* @dagrejs/dagre layout(); zero React/Ink/I-O */ }
```

## Testing Strategy

`vitest`, testes junto ao código; os `.tsx` ganham cobertura pequena com
`ink-testing-library` (OQ15). Cobertura por camada:

- **Puro (view — o coração visual):** `layoutGraph` (dagre coloca cada nó numa camada
  correta; arestas ligam camadas via waypoints; ordem de backlog no desempate;
  diamante A→{B,C}→D); `renderGraph` (nós coloridos por status; pulso alterna por tick;
  clip ao painel); `COLORS.task` **exaustivo** batendo a nova tabela (amarelo=aguardando,
  vermelho=falhou); `pulseFrame` alterna por tick; `streamTail`/`attemptLabel` intactos.
- **Store:** `acp_traffic` empurra e **trunca** no teto (~200, bounded); linha carrega
  `taskId`; `stream_chunk` acumula em `TaskState.stream` (agente **e** shell);
  `edges_set`/status inalterados; concorrência (eventos interleaved de Tasks paralelas)
  não corrompe.
- **Emit seam (orquestrador, com fakes):** dado um DAG A→C, B, o motor emite a
  **sequência** esperada — `edges_set`, `task_registered×3` (A/B `blocked` se têm deps),
  `task_started`, `step_started/finished`, `task_finished(A, done)`, `task_started(C)`…
  — e o `emit` **não** altera resultado do loop (`RunLoopResult` idêntico com e sem `emit`).
- **Steps:** `agent` emite `attempt_started` e encaminha `onCheckStart/End` →
  `check_*`; `shell` emite `stream_chunk` conforme o `execa` produz (via `onChunk`), e o
  `StepResult` agregado **permanece** igual; runner de checks dispara
  `onCheckStart/End` no loop sequencial (por-check, ao vivo).
- **ACP → store:** `onUpdate` de um `session/update` vira `stream_chunk`
  (via `agentChunkText`) **e** `acp_traffic(recv)`; `onTraffic` capta os **send**
  (`session/prompt` etc.) e os requests do Agente; o `taskId` correto (via
  `sessionId→taskId`) é anexado; captura gated por `--verbose`.
- **Wiring (`index.ts`/`start.ts`):** com `mount` injetado + TTY, o Dashboard monta e o
  `dispatch` vai à store (não imprime linhas); sem TTY/`--no-tui`, cai no fallback e as
  linhas saem; matriz de seleção de `startUi` **inalterada** (`start.test.ts`); em modo
  TUI, o logger é **arquivo-only** e o `notify` sai só **após** `ui.stop()`.
- **`.tsx` (ink-testing-library, escopo pequeno):** snapshot do frame do Dashboard
  composto; o efeito de pulso avança o tick sob **fake timers**; o bound de empilhamento
  (N streams `running` + "+K").
- **Fallback (`line-reporter`):** `acp_traffic` emite linha só sob `--verbose`, sem
  quebrar o append-only; lifecycle/stream por-linha preservados; `SYMBOLS` inalterados.
- **Regressão zero (fora do modo TUI):** `--no-tui`/no-TTY → saída de linha **idêntica**
  à de hoje; `emit` ausente ⇒ motor byte-idêntico.

## Boundaries

- **Always:** mudanças de contrato **aditivas** (tsc prova) — `OrchestratorDeps.emit`,
  `StepContext.emit?`, `ChecksRunnerPort.run` += `onCheckStart?/onCheckEnd?`,
  `StoreEvent.acp_traffic`, `StoreState.acpLog`; **toda** lógica de apresentação **pura**
  em `view.ts` (geometria do grafo via dagre, cores, símbolos, pulso, rasterização) —
  renderer-agnostic, reaproveitável pela Native UI/OpenTUI (AD-6); React/Ink **só** em
  `mount.tsx`/`components/*`; **buffers bounded** (stream tail, `acpLog` ring ~200) —
  nunca vazar memória num Run longo; o **emit/onTraffic são best-effort e não
  bloqueiam/derrubam** o loop; emit **fora** de seção crítica (não segura o mutex);
  captura ACP **gated por `--verbose`**; em modo TUI, logs do motor **arquivo-only** +
  `notify` diferido; Dashboard **parallel-ready** (N `running`, N streams, todas pulsam);
  preservar o **fallback de linha** e a matriz de `startUi`; a Task ativa **pulsa** só no
  Dashboard.
- **Ask first:** **OpenTUI / Native UI** — fica para uma change futura dedicada (não
  bundlar o re-platform aqui); tornar a TUI **interativa** (navegação/seleção/scroll,
  `useInput`) — pós-MVP; painel/coluna de **Métricas** na TUI (métricas seguem em
  stderr, ADR-0003) — fora do MVP; mudar contratos congelados **além** dos aditivos
  listados.
- **Never:** a TUI **decidir** comportamento de loop (AD-1) — ela só observa/renderiza
  `StoreEvent`s; o **emit/onTraffic alterarem** a lógica/ordem/resultado do loop, ou
  lançarem para o motor; **bloquear** o loop esperando render/dispatch; segurar o
  mutex/parent no emit; importar React/Ink fora de `mount.tsx`/`components/`; pôr
  geometria/layout do grafo **dentro** do `.tsx` (tem de ficar em `view.ts` — senão a
  Native UI o reimplementa); escrever logs do motor no **stdout** com o Dashboard
  montado (corrompe o frame); adicionar input que altere o Run (além do Gate de
  Aprovação já existente); Artefato de runtime fora do `.loopy/` gitignored.

## Success Criteria

1. **Grafo ao vivo (crit. 1+3):** o Painel de Grafo desenha o DAG do `todo.md` com
   layout **dagre** (`rankdir:LR`, uma coluna por camada), arestas via waypoints;
   `done` = **verde** `✔`; aguardando (`pending`/`blocked`) = **amarelo**; colore em
   tempo real conforme as Tasks progridem. A geometria (`GraphGeometry`) é pura e
   testada.
2. **Animação (crit. 2):** a(s) Task(s) `running` **pulsam** (cyan, ênfase alternando
   ~500 ms) no Grafo e na lista; `pulseFrame` é puro e testado.
3. **Frame de Tasks (crit. 4):** o Painel de Tasks lista todas as Tasks em ordem de
   backlog; executada = **verde+`✔`**, falhou (`escalated`) = **vermelho+`✖`**; mostra
   step atual/`try k/max`/checks (que acendem `running→✓/✗` ao vivo) quando `running`.
4. **Stream (crit. 6):** o Painel de Stream mostra ao vivo o texto do Agente
   (`agent_message_chunk`, via `onUpdate`) em Step `agent` **e** o `stdout`/`stderr` de
   Step `shell` (via `ctx.emit`); um StreamPane por Task `running` (empilha até ~3 + "+K").
5. **Logs/ACP (crit. 5):** o Painel de Logs mostra o **tráfego ACP send+recv** (method +
   summary) por Task, alimentado por `onTraffic`/`onUpdate` → `acp_traffic`, buffer
   bounded, gated por `--verbose`.
6. **Emit seam ligado:** o motor emite `StoreEvent`s nas transições (via
   `OrchestratorDeps.emit`/`StepContext.emit`) e nas callbacks ACP (`onUpdate`/`onTraffic`
   com `taskId` via `sessionId→taskId`); `defaultRunLive` **monta o Ink** (`mount`
   passado a `startUi`) e injeta `emit=ui.dispatch`; num TTY real, o Dashboard aparece
   (não mais o fallback).
7. **Base visual preservada (Native UI/OpenTUI):** geometria do grafo (dagre), cores,
   símbolos e pulso são **puros** em `view.ts` (sem Ink); os `.tsx` são wrappers finos —
   a Native UI futura (OpenTUI) reaproveita `view.ts` + a store sem tocar em React.
8. **Passiva (AD-1):** nenhuma tecla (fora do Gate de Aprovação) altera o Run; o
   `emit`/`onTraffic` não mudam o resultado do loop — `RunLoopResult` idêntico com e sem
   observação.
9. **Logs limpos em modo TUI (OQ16):** com o Dashboard montado, os logs do motor vão
   **só pro arquivo** e o `notify` sai no stderr **após** o unmount; o frame Ink nunca é
   corrompido por writes do motor.
10. **Regressão zero fora do modo TUI:** `--no-tui`/no-TTY → fallback de linha
    **preservado**; a matriz de `startUi` inalterada; `SYMBOLS` inalterados.
11. `npm run typecheck`, `npm run lint`, `npm test` verdes.

## Decisões resolvidas (ex-Open Questions + entrevistas)

- **OQ1 — Render do grafo:** **camadas topológicas** como eixo; layout computado por
  **dagre** (ver OQ12). Evidencia o paralelismo. (Alternativas árvore-indentada e
  grafo-ASCII-com-caixas descartadas.)
- **OQ2 — Layout da tela:** **Dashboard fixo passivo** — Grafo no topo; split
  Tasks (esq.) | Stream(s)+Logs (dir.). Sem navegação/foco/scroll (pós-MVP). Único
  input mantido: o Gate de Aprovação.
- **OQ3 — Conteúdo do Painel de Logs:** **tráfego ACP** send/recv (distinto do Stream,
  que é a saída legível). Novo evento `acp_traffic` + `StoreState.acpLog` bounded.
- **OQ4 — Escopo do wiring:** a feature **inclui** ligar o emit seam (o "T-017"
  prometido pela store nunca foi ligado: grep confirma zero `StoreEvent` produzido).
  Sem isso nada é ao vivo.
- **OQ5 — Cores:** remapear `COLORS.task` (amarelo=aguardando, vermelho=falhou);
  `skipped`→gray, `paused`→magenta liberam o amarelo. **Correção:** afeta **só o render
  Ink**; o `line-reporter` usa `SYMBOLS` (inalterados) — o fallback de linha **não**
  muda.
- **OQ6 — Stream de `shell`:** o Step `shell` passa a **streamar** `stdout`/`stderr`
  (via `execa`/`onChunk`) como `stream_chunk`; o `StepResult` agregado permanece igual.
- **OQ7 — Animação:** `setInterval`/`useState` só no `.tsx`; a fase é pura (`pulseFrame`).
  O fallback de linha **não** anima.
- **OQ8 — Native UI:** **fora de escopo**; o invariante é manter `view.ts` puro e
  renderer-agnostic (AD-6) para ela reaproveitar. A geometria do grafo nasce em
  `view.ts`, não no `.tsx`. (Concretizada como OpenTUI — ver OQ17.)
- **OQ9 — Métricas na TUI:** **fora do MVP** (seguem em stderr — ADR-0003). O header
  do Dashboard mostra só contadores derivados (`k/N done`, `M running`).
- **OQ10 — Interatividade:** **passiva** no MVP; navegação/scroll/seleção (`useInput`)
  ficam para pós-MVP (Ask first).
- **OQ11 — Local da spec:** `.harn/devy/changes/C-0007-execution-tui/` (padrão
  dogfooded C-0001…C-0006, AD-7). Não usa `SPEC.md` na raiz. Introduz `docs/adrs/0005-*`.

### Decisões da entrevista `/devy:refine` (2ª rodada)

- **OQ12 — Lib de layout do grafo:** **`@dagrejs/dagre`** (síncrono, ESM/Node).
  `layoutGraph` → `GraphGeometry` pura no `view.ts` (coords + waypoints); `renderGraph`
  rasteriza pro Ink. O loopy **precisa** de layout (não tem coordenadas, ao contrário
  do JSON Canvas do jcv). A geometria é **reaproveitada** pelo OpenTUI. (Layout in-house
  descartado — volta a rotear arestas à mão.)
- **OQ13 — Cobertura do tráfego ACP:** **send + recv** ("por baixo do capô" completo),
  via callback de observação `onTraffic` no boundary ACP; **gated por `--verbose`**;
  alimenta arquivo (`TaskLogger.acp`) **e** store (`acp_traffic`). **Correção:** a
  captura ACP é **código morto** hoje (`logger.acp` nunca chamado; `openAgent` sem
  `onUpdate`) — o feed é construído do zero.
- **OQ14 — Checks ao vivo:** callback **aditivo** `onCheckStart/onCheckEnd` no
  `ChecksRunnerPort`/`runChecks`; cada check acende `running→✓/✗` ao vivo (honra os dois
  eventos `check_started`/`check_finished` da store). (Sintetizar do agregado descartado
  — perderia o "running" por-check.)
- **OQ15 — Teste dos `.tsx`:** adicionar **`ink-testing-library`** (dev-dep, escopo
  pequeno: snapshot do dashboard, pulso sob fake timers, stacking "+K"). A lógica dura
  segue pura em `view.ts`/`store.ts`.
- **OQ16 — Logs em modo TUI:** **arquivo-only** para `info`/`debug` + `notify`
  **diferido** pós-unmount (o `teeLogger` no stdout corromperia o frame). Escalações já
  aparecem no Painel de Tasks.
- **OQ17 — OpenTUI:** é a **Native UI futura**, **fora de escopo** desta change
  (Bun-only hoje; substitui o Ink; não faz layout de DAG). C-0007 fica no Ink; uma
  change futura troca só o renderer, reaproveitando `view.ts`/`store`.
