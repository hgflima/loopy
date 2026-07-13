# Backlog: C-0015 — Navegação e leitura de fluxo no grafo de deps

> Consumido pelo motor (`- [ ]` pendente / `- [x]` concluída; id `T-\d+`; corpo indentado).
> Narrativa, grafo de dependências, checkpoints e riscos: ver `plan.md` (mesma pasta).
> **Motor intocado** (`src/` na raiz) e **geometria intocada** (`scale.ts`, `computeDagreLayout`) — AD-6.
> **Zero cor hardcoded**: só tokens de `src/ui/tokens.css`.
> Cada linha `Deps:` fica **isolada, ids limpos, sem ponto final** (bug D-0001 do parseDeps).

## Fase 1 — Os três eixos, em paralelo (T-001 ∥ T-002 ∥ T-003)

- [x] T-001: Arestas contam a direção do fluxo — cyan entra, âmbar sai (D1/D2/D3)
    `apps/menubar/src/graph/DepsFlow.tsx`: no `rfEdges`, **remover o booleano `incident`** e trocá-lo
    por dois predicados nomeados lidos da direção da aresta (a store define `edges: [dep,
    dependente]`, logo `e.from` é a dep e `e.to` é o dependente): `feedsRunning = statusById.get(e.to)
    === "running"` (o que **alimenta** a running — o "antes") e `fedByRunning = statusById.get(e.from)
    === "running"` (o que ela **destrava** — o "depois"). `const flow = feedsRunning ? "running" :
    fedByRunning ? "next" : null` — **cyan vence o empate** `running→running` (D2). Aresta `running`:
    `stroke: "var(--state-running)"` + `animated: true` + `className: "deps-edge--running"`. Aresta
    `next`: `stroke: "var(--state-blocked)"` + `className: "deps-edge--next"` e **nunca** `animated`
    (D3 — só marcha onde há trabalho fluindo). Demais: `stroke: "var(--border)"`, sem classe, sem
    `animated`. Só **1 salto** (vizinhas imediatas — D1); sem fecho transitivo. Comentar no código o
    porquê da direção (é o dado da change). `DepsFlow.css`: nova regra `.deps-edge--next
    .react-flow__edge-path { stroke: var(--state-blocked); }`, espelhando a de `--running`.
    `DepsFlow.test.tsx`: **REESCREVER** o bloco "edge type and running animation" para um DAG
    `A → B → C` com `B` running: `A→B` = `var(--state-running)` + `animated: true` +
    `deps-edge--running`; `B→C` = `var(--state-blocked)` + `animated` **ausente/falsy** +
    `deps-edge--next`; aresta longe de qualquer running = `var(--border)`, sem classe, sem `animated`;
    empate (`A` e `B` ambas running, aresta `A→B`) resolve para **cyan + animated**; sem nenhuma
    running, **nenhuma** aresta colorida.
    Aceite: direção separa as duas leituras (entra=cyan+marcha / sai=âmbar+estática / resto=`--border`
    quieto); empate resolve em cyan; só vizinhas imediatas; zero cor literal; `scale.ts` e o teste de
    não-sobreposição intocados.
    Verificação: `npm test -w apps/menubar -- DepsFlow && npm run typecheck && npm run lint`.
    Deps: nenhuma
    Files: apps/menubar/src/graph/DepsFlow.tsx, apps/menubar/src/graph/DepsFlow.css, apps/menubar/src/graph/DepsFlow.test.tsx
    Scope: S

- [x] T-002: Anel de estado em TODO card, dirigido pelo tone do `TASK_STATUS_META` (D5/D7/D9)
    `apps/menubar/src/graph/TaskNode.tsx`: derivar o *tone* do status via `TASK_STATUS_META` (já
    importado — é ele que pinta o dot; **fonte única** de status→cor, não criar um segundo mapa) e
    aplicar a classe `deps-node--tone-${meta.tone}` (`neutral | running | done | blocked | failed`).
    O `status` **já está** no `data` — nenhum campo novo, nenhuma prop nova, `DepsFlow.tsx` **não
    muda**. A classe `deps-node--running` **some** (redundante com `--tone-running`); `isRunning` e
    `deps-node--pulse-off` **permanecem** (são o gatilho do pulso, não do anel).
    `apps/menubar/src/graph/TaskNode.css`: **REESCREVER o bloco de anéis** — uma var `--_ring`
    dirigida pela classe de tone substitui as 7 permutações de `box-shadow` de hoje (running ×
    selected × focus × pulse-off). Base: `--_ring: var(--border)` (default = `pending`/`skipped` —
    **`--border`, NÃO `--state-neutral`**, que foi calibrado para o dot de 8px e grita no perímetro do
    card, pior no dark — D9) + `box-shadow: var(--_lift), inset 0 0 0 2px var(--_ring)`. Overrides:
    `--tone-running` → `--state-running`; `--tone-done` → `--state-done`; `--tone-blocked` →
    `--state-blocked`; `--tone-failed` → `--state-failed` (`--tone-neutral` cai no default, sem
    regra). Seleção/foco (`:focus-visible`, `--selected`): anel **accent por fora** + anel de estado
    **inset por dentro** (concêntricos — D4 de C-0013 preservado; accent = interação, nunca estado).
    Pulso: `.deps-node--tone-running.deps-node--pulse-off { --_ring: var(--border); }` — alterna
    cyan↔cinza e **NUNCA** até `transparent` (o anel é universal agora; sumir abriria um buraco no
    contorno a cada meio segundo — D7). `@media (prefers-reduced-motion: reduce)`: a mesma regra
    volta a `var(--state-running)` (congela **aceso**). No bloco `@media (prefers-color-scheme:
    dark)`, onde `--_lift` é transparente e o card usa hairline, o `border-color` passa a ser dirigido
    pelo mesmo `--_ring` (hoje só o running faz isso; o default cinza substitui o `var(--border)`
    atual). O dot do card **continua lá** (o anel é a leitura de longe; o dot, a de perto).
    `TaskNode.test.tsx`: tabela **exaustiva sobre os 7 status** → `pending`/`skipped` =
    `deps-node--tone-neutral`; `blocked`/`paused` = `--tone-blocked`; `running` = `--tone-running`;
    `done` = `--tone-done`; `escalated` = `--tone-failed`. Mais: `selected` + qualquer tone ⇒ **ambas**
    as classes (anéis concêntricos); `pulse-off` só é aplicado ao `running` (nenhum outro status
    pulsa); `reducedMotion` não aplica `pulse-off`. Atualizar as asserções que hoje esperam
    `deps-node--running`.
    Aceite: todo card circulado na cor do seu status, derivada de `TASK_STATUS_META` (SC3); `selected`
    + estado = anéis concêntricos; pulso cyan↔cinza (nunca `transparent`); neutro = `--border`;
    `TaskNode.css` sai com **menos** CSS de anel do que entrou (SC7); zero cor literal.
    Verificação: `npm test -w apps/menubar -- TaskNode && npm run typecheck && npm run lint`.
    Deps: nenhuma
    Files: apps/menubar/src/graph/TaskNode.tsx, apps/menubar/src/graph/TaskNode.css, apps/menubar/src/graph/TaskNode.test.tsx
    Scope: S

- [x] T-003: `useShiftWheelPan` — o fallback de plataforma do shift+roda, isolado e testado (D10)
    NOVO `apps/menubar/src/graph/useShiftWheelPan.ts` (~15 linhas): hook que recebe um
    `RefObject<HTMLElement>` (o wrapper) e usa `getViewport`/`setViewport` do `useReactFlow()`. Num
    `useEffect`, registra no elemento um listener **NATIVO**: `el.addEventListener("wheel", onWheel,
    { capture: true, passive: false })` — e o cleanup remove com `{ capture: true }`. **NUNCA usar
    `onWheelCapture` do React**: o React 18 registra `wheel` no root como **passivo**, então
    `preventDefault()` ali é um **no-op silencioso** (passa em jsdom, falha no app) — ver Riscos do
    `plan.md`. Handler: `if (!e.shiftKey || e.deltaX !== 0) return;` (a **guarda** que torna o hook
    auto-neutralizante: o RF só troca o eixo do shift+scroll **fora** do macOS; se o WebKit já
    entregar `deltaX`, o hook nunca dispara e o RF cuida) → `e.preventDefault(); e.stopPropagation();`
    (o RF nunca vê este evento — `WheelEvent.deltaX` é read-only, não dá para "corrigir" o evento e
    deixar o RF seguir: se a guarda disparar, **nós assumimos** o pan) → `const vp = getViewport();
    setViewport({ ...vp, x: vp.x - e.deltaY * PAN_SPEED })`. `const PAN_SPEED = 0.5` é **constante
    nomeada com comentário**: é o `panOnScrollSpeed` default do RF (verificado em
    `@xyflow/react` 12.11.2), e casar com ele é o que faz o pan horizontal ter o mesmo peso do
    vertical — não é número mágico. NOVO `useShiftWheelPan.test.tsx` (jsdom, `renderHook` sobre um
    `<div>` real; mockar `@xyflow/react` com `useReactFlow: () => ({ getViewport, setViewport })`):
    (a) `shift` + `deltaY: 100, deltaX: 0` ⇒ `setViewport` chamado com **x deslocado** (`x - 50`), `y`
    intacto, e o evento sai com `defaultPrevented === true`; (b) `shift` + `deltaX: 100` (o WebKit já
    trocou o eixo) ⇒ **não** chama `setViewport` e **não** chama `preventDefault` (no-op; o RF cuida);
    (c) sem `shift` ⇒ no-op; (d) **espiar o `addEventListener` do elemento** e exigir `passive: false`
    (+ `capture: true`) — este teste é o que **impede a regressão para `onWheelCapture`**; (e) o
    unmount remove o listener.
    Aceite: hook isolado e puro de UI; listener **nativo** com `{ capture: true, passive: false }`;
    guarda `shiftKey && deltaX === 0` correta nos dois mundos; `PAN_SPEED` nomeado + comentado; os 5
    testes acima verdes. **Não** fiar no `DepsFlow` nesta task (é o T-004).
    Verificação: `npm test -w apps/menubar -- useShiftWheelPan && npm run typecheck && npm run lint`.
    Deps: nenhuma
    Files: apps/menubar/src/graph/useShiftWheelPan.ts, apps/menubar/src/graph/useShiftWheelPan.test.tsx
    Scope: S

## Fase 2 — Integração: o canvas responde à roda (T-004)

- [x] T-004: Props de navegação do `<ReactFlow>` + wrapper `.deps-flow` que monta o hook (D4/D6/D8)
    `apps/menubar/src/graph/DepsFlow.tsx`: (a) o componente passa a retornar o `<ReactFlow>` **dentro
    de** um `<div className="deps-flow" ref={wrapperRef}>` e chama `useShiftWheelPan(wrapperRef)`
    (T-003) — o wrapper precisa ser **ancestral** do pane do RF (a fase de captura é o que nos dá
    precedência). (b) Props de interação no `<ReactFlow>`: `panOnScroll` (roda = pan),
    `panOnScrollMode={PanOnScrollMode.Free}` (deltaY→vertical, deltaX→horizontal; importar
    `PanOnScrollMode` de `@xyflow/react` — é exportado como **valor**), `zoomOnScroll={false}` (roda
    pura **nunca** dá zoom), `zoomOnPinch={true}` (pinch do trackpad = zoom; com `panOnScroll` ligado
    e `zoomOnPinch={false}` o pinch — que o macOS entrega como `ctrl`+wheel — cairia no handler de pan
    e **arrastaria** a tela — D4), `preventScrolling={true}` (hoje `false`: com a roda inerte era
    inofensivo; com `panOnScroll` ligado, o wheel vazaria para o app), `minZoom={0.25}` (o piso
    default do RF é 0.5 e o `fitView` **respeita** o `minZoom` — num backlog grande o botão de fit
    trava em 0.5x e corta o DAG — D6; `maxZoom` fica no default 2). `panOnDrag` **continua `{false}`**
    e `zoomOnDoubleClick` **continua `{false}`**. (c) **NÃO passar `panActivationKeyCode` nem
    `zoomActivationKeyCode`** — os defaults do RF já são `"Space"` e (no macOS) `"Meta"`; hardcodar
    quebraria fora do macOS sem ganho (D8). Deixar um **comentário no código** dizendo que
    espaço+arrastar e `cmd`+zoom **dependem desses defaults**: é a única coisa que segura dois
    requisitos e é invisível no diff — o próximo leitor apaga sem querer.
    `apps/menubar/src/graph/DepsFlow.css`: `.deps-flow { width: 100%; height: 100%; }` (o wrapper não
    pode encolher o canvas).
    `apps/menubar/src/graph/DepsFlow.test.tsx`: estender o mock de `@xyflow/react` com
    `PanOnScrollMode: { Free: "free", Vertical: "vertical", Horizontal: "horizontal" }` e
    `useReactFlow: () => ({ fitView, getViewport, setViewport })`; capturar as novas props. Asserções
    diretas: `panOnScroll === true`, `panOnScrollMode === "free"`, `zoomOnScroll === false`,
    `zoomOnPinch === true`, `preventScrolling === true`, `panOnDrag === false`, `minZoom === 0.25`, e
    `panActivationKeyCode`/`zoomActivationKeyCode` **`undefined`** (não passadas → default do RF) —
    esta última é o que **prova** os requisitos de `cmd`+zoom e espaço+arrastar no nível em que dá
    para provar sem browser real. Mais uma asserção de integração: o wrapper `.deps-flow` existe e um
    `shift`+wheel nativo despachado nele chama o `setViewport` mockado (o hook está de fato montado
    onde importa).
    Aceite: roda → pan; `shift`+roda → pan horizontal; `cmd`+roda e pinch → zoom; roda pura **nunca**
    dá zoom; espaço+arrastar **não regride**; wheel não vaza; `minZoom` 0.25 libera o `fitView`; as
    duas `*ActivationKeyCode` **não** são passadas; `.deps-flow` não encolhe o canvas.
    Verificação: `npm test -w apps/menubar -- DepsFlow useShiftWheelPan && npm run typecheck && npm run lint && npm test`.
    Deps: T-001, T-003
    Files: apps/menubar/src/graph/DepsFlow.tsx, apps/menubar/src/graph/DepsFlow.css, apps/menubar/src/graph/DepsFlow.test.tsx
    Scope: M
