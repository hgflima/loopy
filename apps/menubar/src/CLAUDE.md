# src (React) — estado do Run, editor do `loopy.yml` e as views

## Purpose & Scope
O frontend do app: roteia as 3 janelas, transforma linhas NDJSON do sidecar em estado React (`BridgeState`), renderiza Kanban/grafo/streams/gate — e, desde o C-0014, **edita o `loopy.yml`** do projeto-alvo. **Não redefine o domínio**: `StoreState`/`StoreEvent` e o reducer vêm de `loopy/tui/store`; o **schema zod** vem de `loopy/config`; o parser do backlog, de `loopy/backlog`. Este módulo só adiciona estado *de UI*.

Não decide nada **do loop** (AD-1), mas **não é read-only sobre o projeto**: escreve `loopy.yml` (via comando Rust, com backup) e devolve decisões de aprovação e flags de launch.

## Entry Points & Contracts
- `main.tsx` — bootstrap. Uma única `index.html` serve as 3 janelas; discriminação por `getCurrentWindow().label`. **`about` ramifica ACIMA do `Root`**, de propósito: sob o `Root` os effects (badge do tray, listeners do sidecar) rodariam duplicados. Escuta `sidecar://line|stderr|exit`.
- `state/store-bridge.ts` — o coração, **puro**. `applyLine(state, line)`: frame `event` → `reduce()` do motor; `control` → `applyControl` (UI: `runStatus`, fila de aprovações, falhas); `command`/malformado → **mesma referência** (structural sharing).
- `state/stream-history.ts` — transcript **append-only** por task, taggeado pelo `currentStepId` (o `task.stream` do store **reseta a cada step**). `overlayStepUsage` corrige um bug real: o `usage_sample` chega **depois** dos chunks, então o snapshot do transcript tem `usedTokens: undefined` — a telemetria viva do step é a autoritativa.
- `state/notify.ts` — `shouldNotify`: exatamente **4 gatilhos** (`approval_requested`, `run_finished`, `task_finished`+`escalated`, `task_finished`+`paused`). **Nunca** em `done`/`skipped` — disciplina de sinal.
- `config/useConfigDraft.ts` — **a fonte única do draft do yml** (uma instância, no `App`, descida para `ViewSwitcher` e `StepEditor`). Ver Pitfalls: `patch`/`save`/dirty têm regras que não se adivinha.
- Aprovação: fila FIFO em `ui.pendingApprovals`; o gate abre o drawer **forçadamente** na task do head; decisão vira NDJSON via `send_command`, removida **otimisticamente** (o motor não dá ack).

## Usage Patterns
- **O board é a tela principal, inclusive em idle.** Não existe tela de "start" separada: `configToStore(draft, tasks)` é uma **projeção pura** que sintetiza um `StoreState` (pipeline + edges + tasks) **sem rodar o motor**, e o App usa esse store sintético enquanto está idle. Empty state só quando não há `loopy.yml`; "criar a partir do template" **semeia o draft sem escrever em disco** (disco só no Save).
- **O status em idle sai do `todo.md`, não das deps.** `configToStore` marca `- [x]` como `done` (o grouper a manda para "Fim") e, para as demais, aplica a regra do `readySet` do motor: `ready` só quando *toda* dep já está `done`; senão `blocked` (dep pendente **ou** id desconhecido — fail-closed, como a Dep órfã que o motor rejeita). Derivar o status só de `deps.length > 0` era o bug que mostrava task concluída como "Ready" no Backlog — e, de quebra, apagava a frente de onda do grafo.
- **Editar o pipeline = editar as colunas do Kanban.** O `⋯` no header da coluna abre o `StepEditor` (drawer); add/remove/reorder são funções **puras** em `config/pipeline-edit.ts`, e o handler patcha `"pipeline"` inteiro. `orphanRefs` (goto/`on_success` para step inexistente) são recomputados a cada mudança e viram badge/banner no board.
- **Campos**: use as primitivas de `config/fields/` (`TextField`/`NumberField`/`SelectField`/`ToggleField`/`RecordEditor`/`CommandListEditor` + `makeFieldId`). Não escreva `<input>` solto.
- **Kanban** (`kanban/`): `groupByStep` → `Backlog → um por Step → Fim`. `detectGotoCards` compara índices de coluna entre snapshots: índice que **diminui** = Desvio (goto), destacado ~2,2 s. É a peça visual do fix-loop.
- **Grafo** (`graph/`): ReactFlow renderiza, mas as **posições vêm de `computeDagreLayout`** (`loopy/tui/view`), escaladas por `graph/scale.ts`. **Auto-layout do ReactFlow é proibido.** Pan/zoom **estão ligados** (`panOnScroll`, `zoomOnPinch`, shift+wheel para pan horizontal, `Background`+`Controls`); o que fica desligado é `nodesDraggable`, `panOnDrag`, `zoomOnScroll` e `nodesFocusable`.
- **Pulso**: um **único** `setInterval` no `App.tsx` alimenta todos os nós (`pulseFrame(tick)`). Não crie timer por componente. Toda animação respeita `usePrefersReducedMotion`.
- `npm run dev:web` roda sem Tauri: `isTauri()` é false, o `MOCK_FEED` injeta linhas NDJSON a cada 300 ms e o save é **em memória**. Caminho rápido para mexer em UI sem subir o Rust.

## Anti-patterns
- **Nunca reimplementar o schema do yml.** A validação é `loopyConfigSchema.safeParse` do motor (via `loopy/config`); erros viram `ConfigError[]` com **dot-path**, consultados por `errorAt`. Idem reducer (`loopy/tui/store`), tipos de step (`loopy/types`) e backlog (`loopy/backlog`) — duplicar é como app e motor divergem em silêncio.
- **Não capturar `isTauri()` no escopo do módulo.** Já são três no caminho vivo (`main.tsx`, `App.tsx`, `config/useConfigDraft.ts`) — e isso torna load/save **não-mockável** em teste. O padrão-alvo é o do `popover/Glance.tsx`: chamar no ponto de uso. (E nunca testar `"__TAURI__" in window`.)
- **Não pôr o botão Save dentro da `ConfigPane`.** A save bar é **global**, na barra de abas do `ViewSwitcher`, porque também se edita pelo board (steps via `⋯`, colunas via add/remove/reorder).
- Não usar cores literais: tudo vem de `ui/tokens.css`.
- Não pôr lógica em componente: redutores/projeções (`applyLine`, `segmentsFor`, `groupByStep`, `detectGotoCards`, `configToStore`, `pipeline-edit`, `flow-state`) são **puros e testados isolados** (AD-6).
- `MarkdownStream` é seguro por construção (sem `rehype-raw` → HTML embutido vira texto). Não adicione `rehype-raw`: o conteúdo vem do output de um agente.
- **`panes/LaunchConfig.tsx` + `LaunchConfig.css` são código MORTO** (ninguém importa). A superfície idle é o header dir-picker + popover de flags no `App.tsx`. Não use como referência, nem positiva nem negativa.

## Dependencies & Edges
- Pai: `../CLAUDE.md` (build, aliases, as 3 pontes). Shell nativo: `../src-tauri/CLAUDE.md`.
- Motor (via alias `loopy/*` → `../../../src/*`): `loopy/tui/{store,view,transport}`, **`loopy/config`** (`loopyConfigSchema`, `parseConfigSource`, `serializeConfig`, `initialConfigTemplate`), **`loopy/backlog`** (`parseBacklog`, `backlogOptionsFrom`), **`loopy/types`**.

## Patterns & Pitfalls
- **Draft/dirty/save — o modelo mental inteiro:**
  - **`patch()` opera sobre o objeto CRU (pré-defaults), nunca sobre o `draft` validado.** Patchar a partir do `draft` gravaria os defaults do zod de volta no yml do usuário.
  - **`save()` é fail-closed**: bloqueado enquanto houver `errors` (a UI espelha com o botão disabled).
  - **Dirty guard** ao trocar de diretório (dialog Salvar/Descartar/Cancelar) e **auto-save antes do launch** (aborta o launch se o save falhar).
  - Roteamento de erro: campo → inline; header de seção → contador; cross-field (do `superRefine`) → banner.
- **`graph/flow-state.ts` — a armadilha semântica mais cara do grafo**: `blocked` no motor significa "**tem `Deps:`**", não "é a próxima". Pintar o anel pelo status cru acenderia o backlog inteiro. O que se pinta é a **frente de onda**, derivada de arestas+status e **cortada por `concurrency`**.
- **`graph/scale.ts`**: `CELL_PX_X`/`CELL_PX_Y` são **derivados** do tamanho do card e do gap mínimo do dagre — não são literais. Mudou o card? Mexa em `CARD_W`/`CARD_H` aqui; nunca em posições, nunca ligando auto-layout.
- **`measuredRef` é obrigatório, não otimização**: sem devolver `measured` em cada nó a cada rebuild, o `adoptUserNodes` do ReactFlow zera `measured`/`handleBounds` e **o grafo pisca para vazio a cada troca de Step**.
- **Viewport "persistente" = as 3 views ficam montadas** (`display:none`) e o `fitView()` roda **uma única vez**. Não há persistência em localStorage do viewport (o único localStorage é a altura do stream).
- `panActivationKeyCode`/`zoomActivationKeyCode` são **omitidos de propósito**: os defaults do ReactFlow (Space/Meta) já dão space+drag e cmd+wheel, e hardcodar quebraria fora do macOS.
- **Rename cascade** (`config/rename.ts`): `renameStepId`/`renameAgent`/`renameChecksList` reescrevem todos os referrers, com guard de colisão. Ressalva: o `run` de um step `checks` **não** é validado como referência pelo zod do motor — nome órfão de checks-list não gera erro.
- `applySidecarExit` classifica o exit **pelo `runStatus`**: `idle` → `start-fail`, `running` → `death-mid-run`, `finished` → ignora. Sem isso, o encerramento normal viraria erro na cara do usuário.
- **`DESIGN.md` do app é TARGET, não o código atual** (ele diz isso no header). O vigente é `ui/tokens.css` + `base.css`. > TODO(intent): é a direção de um refactor, ou referência morta?
- **Ordem dos eventos**: Kanban e grafo assumem `pipeline_declared` e `edges_set` antes dos `task_registered`. > TODO(intent): é contrato do motor ou coincidência do emissor?
- `ui/context-window.ts` **não** é re-exportado pelo barril de propósito, e carrega um `WINDOW_FALLBACK` hardcoded por modelo — envelhece a cada modelo novo.
- Erros do webview não deixam rastro: `ErrorBoundary` + `window.onerror` + `unhandledrejection` funilam tudo para o comando `log_error` (stderr do Rust). Não remova esse funil.
