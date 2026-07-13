# Spec: C-0015 — Navegação e leitura de fluxo no grafo de deps

> Follow-up direto de **C-0013** (`deps-graph-reactflow`), que trouxe os cards de design-system e
> o canvas ReactFlow. Esta change **não adiciona capacidade de motor** e **não muda geometria**:
> ela (a) faz o grafo contar a *direção* do trabalho — o que alimenta a task viva × o que ela
> destrava — (b) faz o **card carregar o próprio status num anel**, e (c) torna o canvas navegável
> **pela roda do mouse**, que hoje é literalmente inerte.

## Objective

1. **O grafo passa a mostrar a direção do fluxo.** Hoje toda aresta *incidente* a uma task em
   execução (entrando **ou** saindo) fica cyan e marchando — as duas leituras estão coladas na
   mesma cor. Separar:
   - aresta que **entra** numa task `running` (a dep que a alimenta, o **antes**) → **cyan**
     (`--state-running`), marchando — **como já é hoje**;
   - aresta que **sai** de uma task `running` (o que ela destrava, o **depois**) → **âmbar**
     (`--state-blocked`), **estática**;
   - só **vizinhas imediatas** (1 salto). O resto do grafo fica quieto (`--border`).

2. **Todo card ganha um anel na cor do seu status** (`running` cyan pulsando, `done` verde,
   `blocked`/`paused` âmbar, `escalated` vermelho, `pending`/`skipped` **cinza neutro**). O pedido
   original era "circular os `done` de verde"; a entrevista generalizou — ver **D5**, que é a
   decisão de fundo desta change.

3. **O canvas responde à roda do mouse** (paridade com Figma/Miro/VS Code):
   - roda → **pan vertical**; `shift`+roda → **pan horizontal**; `cmd`+roda → **zoom**;
   - **pinch** do trackpad → **zoom**;
   - **espaço + clique + arrastar → pan, exatamente como hoje** (é o
     `panActivationKeyCode="Space"` default do ReactFlow, com `panOnDrag={false}` — não regride);
   - **`minZoom={0.25}`** (era o default 0.5): com o zoom promovido a cidadão de primeira classe,
     o piso de 0.5x é o que hoje impede o `fitView` de enquadrar um backlog grande (D6).

### Invariantes preservadas

- **AD-6 / SC #4 (C-0007/C-0013)** — as posições continuam vindo de **`computeDagreLayout`**
  (`loopy/tui/view`), fonte única de geometria com a TUI Ink. Esta change **não toca escala,
  layout nem `scale.ts`**: só cor de aresta, anel de card e props de interação do `<ReactFlow>`.
- **AD-1 — a view só observa.** Nenhuma interação nova altera o Run. Pan/zoom são viewport.
- **Fronteira de monorepo** — vive em `apps/menubar`; **não edita o motor** (`src/` na raiz).
- **DESIGN.md — nenhum hue novo.** O "amarelo" do pedido **é** o *Blocked/Paused Amber* já no
  vocabulário (`--state-blocked`, hue 75), e é **semanticamente exato**: a task depois de uma
  `running` está literalmente *esperando por ela*. O vocabulário segue com 4 hues + neutro.
- **Fonte única de status→cor:** `TASK_STATUS_META` (`src/ui/StatusIndicator.tsx`) já mapeia os 7
  status para 5 *tones*. O anel **deriva desse mesmo mapa** — não se inventa um segundo mapeamento.

## User

O mesmo dev de C-0009+. Com o Run em andamento, olha o painel **Deps** e quer responder três
perguntas sem clicar em nada: **"o que já foi construído?"** (anel verde), **"o que alimenta o que
está sendo construído agora?"** (aresta cyan) e **"o que destrava quando isso terminar?"** (aresta
âmbar); e quer **navegar o canvas com a roda do mouse** como em qualquer ferramenta de diagrama —
hoje ele depende dos botões do `<Controls/>` ou do espaço+arrastar, porque a roda não faz nada.

## Success (narrativa)

Abrir dashboard → **Deps** com um Run vivo → cada card **circulado na cor do seu estado** (verde =
feito, cyan pulsando = sendo construído, âmbar = esperando, cinza = na fila), legível de longe sem
caçar o dot de 8px → **as arestas que entram na running marcham em cyan** e **as que saem estão em
âmbar, paradas** — o olho lê "vem daqui / vai pra lá" sem legenda. Rodar a roda → a tela **sobe e
desce**; `shift`+roda → **anda para os lados**; `cmd`+roda (ou pinch) → **zoom no ponteiro**;
segurar **espaço e arrastar** → pan, igual a antes. Tudo correto em light e dark, honrando
`prefers-reduced-motion`, **zero cor hardcoded**, **motor intocado**.

## Tech Stack

Herdado — **sem novas dependências**:

- **Webview:** React 18 + Vite + `@tauri-apps/api` v2 (Tauri v2, WKWebView).
- **Grafo:** `@xyflow/react` **v12** (já instalado). Quase toda a navegação sai de **props
  existentes** do `<ReactFlow>` (`panOnScroll`, `panOnScrollMode`, `zoomOnScroll`, `zoomOnPinch`,
  `preventScrolling`, `minZoom`). A **única** exceção é o `shift`+roda, que ganha um listener
  nativo guardado (D10).
- **Geometria:** `computeDagreLayout` de `loopy/tui/view` — **inalterada**, e nem sequer relida.
- **Cor:** tokens de `src/ui/tokens.css` (OKLCH): `--state-running`, `--state-blocked`,
  `--state-done`, `--state-failed`, `--state-neutral`, `--border`, `--accent`.

## Commands

Inalterados:

```
# Qualidade (raiz)
Typecheck:   npm run typecheck
Lint:        npm run lint
Test:        npm test

# App
Dev (nativo):  npm run dev -w apps/menubar        # tauri dev
Dev (webview): npm run dev:web -w apps/menubar     # Vite standalone, NDJSON mockado
Test (app):    npm test -w apps/menubar            # vitest
Build .app:    npm run build -w apps/menubar
```

Sem comandos novos; sem Rust (100% webview).

## Project Structure

Arquivos tocados (todos em `apps/menubar/src/graph/`; **nenhum arquivo novo**):

```
apps/menubar/src/graph/
  DepsFlow.tsx      → (a) `rfEdges`: troca o booleano `incident` por DIREÇÃO —
                          feedsRunning (statusById[e.to] === "running")   → cyan + animated
                          fedByRunning (statusById[e.from] === "running") → âmbar, estático
                          demais → `--border`, quietas.   (empate: cyan vence — D2)
                      (b) props de interação do <ReactFlow>: panOnScroll, panOnScrollMode=Free,
                          zoomOnScroll={false}, zoomOnPinch={true}, preventScrolling={true},
                          minZoom={0.25}. panOnDrag continua {false} → espaço+arrastar segue pelo
                          default panActivationKeyCode="Space" (NÃO passar a prop; ver D8).
                      (c) passa a ser envolvido por um <div className="deps-flow" ref>, que hospeda
                          o listener nativo de shift+wheel (D10). Hoje o componente retorna o
                          <ReactFlow> pelado.
  useShiftWheelPan.ts → NOVO: o hook do D10 (~15 linhas). Isolado para ser testável e para deixar
                      óbvio que é uma compensação de plataforma, não navegação de verdade.
  DepsFlow.css      → nova regra `.deps-edge--next .react-flow__edge-path { stroke: var(--state-blocked) }`,
                      espelhando a de `--running`. A `--next` nunca recebe `animated`.
                      Mais `.deps-flow { width: 100%; height: 100% }` (o wrapper não pode encolher
                      o canvas).
  TaskNode.tsx      → deriva o *tone* do status via TASK_STATUS_META (fonte única, já importada
                      pelo TaskStatusDot) e aplica `deps-node--tone-<tone>`. O `status` JÁ está no
                      `data` — nenhum campo novo, nenhuma prop nova, DepsFlow não muda por causa disso.
  TaskNode.css      → REESCRITA do bloco de anéis: uma var `--_ring` dirigida pela classe de tone
                      substitui as 7 permutações de box-shadow de hoje (ver Code Style).
  DepsFlow.test.tsx → ATUALIZAR: cor/animação de aresta por direção; props de interação.
  TaskNode.test.tsx → ATUALIZAR: classe de tone por status; anel + seleção concêntricos; pulso.
```

**Não tocar:** `scale.ts` (e seu teste), `ViewSwitcher.tsx`, `App.tsx`, `StatusIndicator.tsx`,
`src/` na raiz.

## Code Style

TypeScript ESM, componentes puros, **zero cor literal** (só tokens). O diff é cirúrgico — resista
a refatorar o que está ao redor.

### Arestas — a direção é o dado

O booleano `incident` some; entram dois predicados nomeados, lidos da direção da aresta (o store
define `edges: [dep, dependente]`, logo `e.from` é a dep e `e.to` é o dependente):

```tsx
const rfEdges: Edge[] = useMemo(
  () =>
    geometry.edges.map((e) => {
      // `[dep, dependente]`: quem ENTRA numa running a alimenta (o "antes");
      // quem SAI de uma running é o que ela destrava (o "depois").
      const feedsRunning = statusById.get(e.to) === "running";
      const fedByRunning = statusById.get(e.from) === "running";
      const flow = feedsRunning ? "running" : fedByRunning ? "next" : null; // cyan vence o empate (D2)
      return {
        id: `${e.from}->${e.to}`,
        source: e.from,
        target: e.to,
        type: "smoothstep" as const,
        // marcha só onde há trabalho de fato fluindo; o "depois" ainda está na fila.
        ...(flow === "running" && { animated: true }),
        ...(flow && { className: `deps-edge--${flow}` }),
        style: {
          stroke:
            flow === "running" ? "var(--state-running)"
            : flow === "next" ? "var(--state-blocked)"
            : "var(--border)",
        },
      };
    }),
  [geometry.edges, statusById],
);
```

### Card — um anel, dirigido pelo tone

A gramática de C-0013 (D4) se mantém e fica **mais simples**: anel **externo** = `--accent` =
*interação* (seleção/foco), o único anel-accent; anel **interno (inset)** = *estado*, agora **sempre
presente** e com a cor do tone. Em vez de uma classe por status, uma **var** dirigida pelo tone que
o `TASK_STATUS_META` já define (`neutral | running | done | blocked | failed`) — é o mesmo mapa que
pinta o dot, então status→cor continua tendo **uma** fonte:

```css
.deps-node {
  /* Neutro = --border, NÃO --state-neutral (D9): o token do dot foi calibrado para 8px;
     esticado no perímetro do card ele grita. --border é o token de "contorno quieto". */
  --_ring: var(--border);                   /* pending/skipped e default */
  box-shadow: var(--_lift), inset 0 0 0 2px var(--_ring);
}
.deps-node--tone-running { --_ring: var(--state-running); }
.deps-node--tone-done    { --_ring: var(--state-done);    }
.deps-node--tone-blocked { --_ring: var(--state-blocked); }
.deps-node--tone-failed  { --_ring: var(--state-failed);  }
/* tone-neutral não precisa de regra: cai no default. */

/* Seleção/foco: anel accent POR FORA, anel de estado preservado por dentro (concêntricos). */
.deps-node:focus-visible,
.deps-node--selected { box-shadow: var(--_lift), 0 0 0 2px var(--accent), inset 0 0 0 2px var(--_ring); }
.deps-node--selected { background: var(--accent-subtle); }

/* Pulso do running: alterna cyan ↔ cinza de borda. NUNCA para transparent — o anel é
   universal agora, e sumir com ele abriria um buraco no contorno a cada meio segundo (D7). */
.deps-node--tone-running.deps-node--pulse-off { --_ring: var(--border); }

@media (prefers-reduced-motion: reduce) {
  .deps-node--tone-running.deps-node--pulse-off { --_ring: var(--state-running); } /* congela aceso */
}
```

Isso **colapsa as 7 permutações de `box-shadow`** que existem hoje em `TaskNode.css` (running ×
selected × focus × pulse-off) em uma regra base + overrides de var — menos CSS depois da change do
que antes. No **dark**, onde a sombra some (`--_lift: transparent`) e o card usa hairline, o mesmo
`--_ring` dirige o `border-color` (hoje só `--running` faz isso); o default cinza substitui o
`var(--border)` atual. O dot do card **continua lá** — o anel é a leitura de longe (e com o zoom
afastado), o dot é a de perto.

### Navegação — props, não handlers

```tsx
panOnScroll                              // roda = pan (o handler do RF usa deltaX/deltaY nativos)
panOnScrollMode={PanOnScrollMode.Free}   // deltaY→vertical, deltaX→horizontal
zoomOnScroll={false}                     // roda pura NUNCA dá zoom
zoomOnPinch={true}                       // pinch do trackpad = zoom
preventScrolling={true}                  // o wheel não vaza para o app (hoje está false)
panOnDrag={false}                        // e espaço+arrastar segue vivo pelo panActivationKeyCode default
minZoom={0.25}                           // piso do RF é 0.5 e trava o fitView num backlog grande
```

`cmd`+roda cai no `zoomActivationKeyCode`, cujo default do RF **já é** `Meta` no macOS (e `Control`
fora dele) — **não passar a prop**: hardcodar `"Meta"` quebraria fora do macOS sem ganhar nada.
Mesma regra para `panActivationKeyCode` (default `"Space"`). Ambos merecem um comentário no código
dizendo *que dependemos do default*: é a única coisa que segura os requisitos de `cmd`+zoom e de
espaço+arrastar, e é invisível no diff.

### `useShiftWheelPan` — a compensação de plataforma (D10)

O único código de navegação que escrevemos. **Duas armadilhas, ambas silenciosas:**

1. **NÃO use `onWheelCapture` do React.** O React 18 registra `wheel` no root como **passivo** —
   `preventDefault()` ali é um **no-op silencioso**, e o RF panaria verticalmente por cima do nosso
   pan horizontal. Tem que ser `addEventListener` **nativo**, com `{ capture: true, passive: false }`,
   num wrapper que seja **ancestral** do pane do RF (a fase de captura nos dá a precedência).
2. **`WheelEvent.deltaX` é read-only** — não dá para "corrigir o evento" e deixar o RF seguir. Se a
   guarda disparar, nós **assumimos** o pan.

```ts
// O RF só troca o eixo do shift+scroll FORA do macOS (createPanOnScrollHandler, @xyflow/system);
// no macOS ele confia no WebKit entregar deltaX. Se o WKWebView não entregar, isto assume.
// A guarda deltaX === 0 torna o hook um no-op no mundo em que o WebKit já faz a coisa certa.
useEffect(() => {
  const el = wrapperRef.current;
  if (!el) return;
  const onWheel = (e: WheelEvent) => {
    if (!e.shiftKey || e.deltaX !== 0) return;   // ← a guarda: nos dois mundos, correto
    e.preventDefault();
    e.stopPropagation();                          // o RF nunca vê este evento
    const vp = getViewport();
    setViewport({ ...vp, x: vp.x - e.deltaY * PAN_SPEED }); // PAN_SPEED = 0.5, o default do RF
  };
  el.addEventListener("wheel", onWheel, { capture: true, passive: false });
  return () => el.removeEventListener("wheel", onWheel, { capture: true });
}, [getViewport, setViewport]);
```

`PAN_SPEED = 0.5` **não é número mágico**: é o `panOnScrollSpeed` default do RF, e casar com ele é o
que faz o pan horizontal ter o mesmo peso do vertical. Constante nomeada, com esse comentário.

Copy em português onde houver texto (aqui não deve haver nenhum).

## Testing Strategy

Padrão AAA. Os testes de `graph/` já mockam `@xyflow/react` inteiro e capturam as props do
`<ReactFlow>` — é exatamente o gancho de que a parte de navegação precisa.

- **`DepsFlow.test.tsx` — arestas por direção** (num DAG `A → B → C` com `B` running):
  - `A→B` (entra na running): `stroke === "var(--state-running)"`, `animated: true`, classe
    `deps-edge--running`.
  - `B→C` (sai da running): `stroke === "var(--state-blocked)"`, **`animated` ausente/falsy**,
    classe `deps-edge--next`.
  - Aresta longe de qualquer running: `var(--border)`, sem classe, sem `animated`.
  - **Empate** (`A` e `B` ambas running, aresta `A→B`): resolve para **cyan + animated** (D2).
  - Sem nenhuma running: **nenhuma** aresta colorida.
- **`DepsFlow.test.tsx` — props de interação** (asserção direta sobre as props capturadas):
  `panOnScroll === true`, `panOnScrollMode === "free"`, `zoomOnScroll === false`,
  `zoomOnPinch === true`, `preventScrolling === true`, `panOnDrag === false`, `minZoom === 0.25`, e
  `panActivationKeyCode`/`zoomActivationKeyCode` **não passados** (`undefined` → default do RF).
  Este último é o que **prova** os requisitos de `cmd`+zoom e espaço+arrastar no nível em que dá
  para provar sem browser real — o resto é a verificação manual abaixo.
- **`useShiftWheelPan` (D10) — os dois mundos, em jsdom** (o mock de `@xyflow/react` ganha
  `getViewport`/`setViewport`):
  - `shift` + `deltaY: 100, deltaX: 0` → chama `setViewport` com **x deslocado** (`x - 50`), `y`
    intacto, e o evento sai com `defaultPrevented === true`;
  - `shift` + `deltaX: 100` (o WebKit já trocou o eixo) → **não** chama `setViewport` e **não**
    chama `preventDefault` — o hook é um no-op e o RF cuida;
  - sem `shift` → no-op (o pan vertical é do RF);
  - o listener é registrado com `passive: false` (espionar `addEventListener`) — **este teste é o
    que impede a regressão para `onWheelCapture`**, que passaria em jsdom e falharia no app.
- **`TaskNode.test.tsx` — anel por tone** (tabela sobre os **7** status, exaustiva):
  `pending`/`skipped` → `deps-node--tone-neutral`; `blocked`/`paused` → `--tone-blocked`;
  `running` → `--tone-running`; `done` → `--tone-done`; `escalated` → `--tone-failed`.
  Mais: `selected` + qualquer tone → **ambas** as classes (anéis concêntricos, D4 preservado);
  `pulse-off` só é aplicado ao `running` (nenhum outro status pulsa).
- **Regressão:** `scale.test.ts`, o teste de não-sobreposição e as asserções de posição
  (`computeDagreLayout` × escala) continuam **intocados e verdes** — a prova de AD-6.
- **Manual/visual (obrigatória — é onde os requisitos de navegação realmente vivem):** no app
  nativo (`npm run dev -w apps/menubar`, WKWebView), com um Run com ao menos uma task running, uma
  done e uma blocked:
  1. roda do mouse → pan **vertical**;
  2. `shift`+roda → pan **horizontal** (⚠️ ver **Riscos**);
  3. `cmd`+roda → **zoom** centrado no ponteiro;
  4. pinch no trackpad → zoom;
  5. **espaço + clique + arrastar → pan** (não regrediu);
  6. arestas: entra-na-running marchando em cyan, sai-da-running parada em âmbar, resto quieto;
  7. anéis: cada card na cor do seu estado, **em light e dark**; o cinza `--border` do `pending`
     (a maioria dos cards no início do Run) tem que ler como **moldura**, não como sinal — não pode
     competir com o anel accent da seleção nem clarear o grafo no dark (D9);
  8. `prefers-reduced-motion` → nada marcha e o anel do running fica **aceso e parado**;
  9. o wheel **não** vaza para o app; o botão de fit enquadra um DAG grande;
  10. trocar Kanban↔Deps **preserva** pan/zoom (D6 da C-0013 não regride).

## Boundaries

- **Always:**
  - Só tokens de `tokens.css` — **zero** hex/cor hardcoded (varre o diff).
  - Light **e** dark completos; `prefers-reduced-motion` desliga toda marcha.
  - **Status→cor sai de `TASK_STATUS_META`.** Nada de um segundo mapa de status→cor no `graph/`.
  - **Anel externo = accent = interação; anel interno = estado.** A regra de C-0013 (D4) vale para
    todos os tones — nunca conflatar interação com estado.
  - **Movimento só onde há trabalho fluindo:** cyan marcha, âmbar **não**.
  - Navegação por **props do ReactFlow**; handler de wheel próprio só pelo fallback documentado em
    **Riscos**, e nunca sem verificação no app real.
  - Preservar `panOnDrag={false}` + o default `panActivationKeyCode="Space"`.
- **Ask first:**
  - Qualquer mudança em `scale.ts`, na geometria ou nas dimensões do card.
  - Adicionar um hue novo ao vocabulário (o pedido **não** exige — âmbar e verde já existem).
- **Never:**
  - **Editar o motor** (`src/` na raiz) — inclusive `view.ts`/`store.ts`.
  - Adicionar dependência.
  - Auto-layout do ReactFlow; `MiniMap`.
  - Fazer a roda pura dar zoom (`zoomOnScroll` fica `false`).
  - Deixar o anel do running pulsar até `transparent` (some o contorno — D7).
  - Mutar estado ou hardcodar valor mágico.

## Success Criteria

1. `npm run typecheck && npm run lint && npm test` verdes na raiz.
2. **Aresta que entra numa `running` → cyan + marchando; que sai → âmbar + estática; o resto,
   quieto.** Só 1 salto (vizinhas imediatas), nos dois temas.
3. **Todo card circulado na cor do seu status**, derivada de `TASK_STATUS_META`; `done` verde,
   `running` cyan pulsando (cyan↔cinza, nunca sumindo), `blocked`/`paused` âmbar, `escalated`
   vermelho, `pending`/`skipped` cinza `--border`. `selected` + estado = anéis concêntricos.
4. **Roda → pan vertical. `shift`+roda → pan horizontal. `cmd`+roda → zoom. Pinch → zoom.**
   Verificados **no app nativo**, não só em teste unitário.
5. **Espaço + clique + arrastar continua panando** (não regrediu).
6. Wheel não vaza para fora do painel; troca de view preserva pan/zoom; **o botão de fit enquadra o
   DAG inteiro** num backlog grande (≥15 tasks) — hoje trava em 0.5x.
7. **Zero cor hardcoded** no diff; **motor intocado**; **geometria/escala intocadas** (AD-6);
   `TaskNode.css` sai da change com **menos** CSS de anel do que entrou.

## Decisões da entrevista (/devy:refine, 2026-07-13)

- **D1 — Escopo do realce de aresta: só vizinhas imediatas (1 salto).** Sem fecho transitivo — o
  grafo segue silencioso, acendendo só a **fronteira** do trabalho vivo.
- **D2 — Empate `running → running`: cyan vence.** Uma aresta entre duas tasks vivas é ao mesmo
  tempo "depois de A" e "antes de B". Alimentar o que está vivo tem precedência, e mantém a marcha
  — que já é o comportamento de hoje, então o caso raro não regride.
- **D3 — Movimento: âmbar estática, cyan marcha.** O `animated` do RF reporta trabalho de fato
  fluindo; o "depois" ainda está na fila. Bônus de a11y: cyan e âmbar diferem em **hue *e*
  movimento**, então a distinção **não é color-only** e sobrevive a daltonismo.
- **D4 — Pinch = zoom** (`zoomOnPinch={true}`). É o gesto nativo do macOS e resolve um efeito
  colateral real: com `panOnScroll` ligado e `zoomOnPinch={false}`, o pinch (que o macOS entrega
  como `ctrl`+wheel) cairia no handler de pan e **arrastaria** a tela.
- **D5 — Anel de estado em TODOS os cards, não só nos `done`** (o pedido pedia só o verde; a
  entrevista generalizou, contra a minha recomendação inicial — e o usuário estava certo). Duas
  razões, ambas do próprio `DESIGN.md`:
  1. O `DESIGN.md` legitima o dot de 8px dizendo *"nunca color-only — sempre pareado com um rótulo
     ou uma **posição fixa** (a coluna do Kanban)"*. **No grafo não existe coluna**: a posição é
     topologia (dagre), não status. O dot fica sendo o único portador do estado, sozinho e minúsculo.
     **O anel é o substituto da coluna que o grafo não tem.**
  2. A "colisão" que eu temia — anel âmbar (`blocked`) × aresta âmbar ("depois") — **não existe**:
     `orchestrator.ts:1395` (`status: t.deps.length > 0 ? "blocked" : "pending"`) garante que toda
     task com deps nasce `blocked`, logo o alvo de uma aresta âmbar é **sempre** um card âmbar. A
     aresta aterrissa num card da mesma cor contando a mesma história ("esperando a dep"): é
     **coerência**, não colisão. O hue significa uma coisa só, em toda parte.
- **D6 — Range de zoom: `minZoom={0.25}`, `maxZoom` fica no default 2.** O piso default do RF é 0.5
  e o `fitView` **respeita o `minZoom`** — num backlog grande o botão de fit simplesmente não
  enquadra o DAG (trava em 0.5x e corta). Não subir o `maxZoom`: o card não tem detalhe extra a
  revelar quando ampliado.
- **D7 — `pending`/`skipped` ganham anel **neutro cinza** (não ficam sem anel).** O anel passa a ser
  universal: todo card tem contorno, e o que muda é a cor. **Consequência forçada:** o pulso do
  `running`, que hoje alterna o anel cyan ↔ `transparent`, passa a alternar **cyan ↔ cinza** — se
  pulsasse até `transparent`, abriria um buraco no contorno a cada meio segundo.
- **D9 — O cinza do neutro é `--border`, não `--state-neutral`; 2px como todos.** A geometria fica
  uniforme (todo card, 2px; só a cor muda — é o que D7 pediu), mas o token muda: `--state-neutral`
  foi calibrado para um **dot de 8px** e, esticado no perímetro do card, lê muito mais alto do que
  deveria — pior no dark, onde ele (L 0.52) é bem mais claro que o `--border` (L 0.32) que os cards
  usam hoje, e o grafo inteiro clarearia. `--border` é o token que **existe** para "contorno quieto".
  Como quase todo card começa `pending`, é o neutro que define se o grafo respira. O hue é que faz o
  sinal; o neutro é a moldura.
- **D10 — O fallback do `shift`+roda entra na change, sempre ligado** (não é mais contingência). A
  guarda `shiftKey && deltaX === 0` o torna **auto-neutralizante**: se o WebKit já troca o eixo, o
  hook nunca dispara e o RF faz tudo; se não troca, ele assume o pan horizontal. **Correto nos dois
  mundos**, então não há aposta a fazer nem verificação humana a esperar — e o requisito deixa de
  pender de um comportamento de plataforma que não controlamos e não conseguimos testar em unit test.
  Custo: ~15 linhas + 1 teste, metade possivelmente morta nesta plataforma. Vale.

### Defaults de implementação (decididos por inspeção — vetáveis)

- **D8 — Não passar `panActivationKeyCode` nem `zoomActivationKeyCode`.** Os defaults do RF já são
  `"Space"` e (no macOS) `"Meta"`. Hardcodar quebraria fora do macOS sem ganho. Fica um comentário
  no código, porque "o requisito depende de uma prop que não escrevemos" é exatamente o tipo de
  coisa que o próximo leitor apaga sem querer.
- **`preventScrolling` volta ao default `true`.** Hoje está `false` — inofensivo enquanto a roda era
  inerte, mas com `panOnScroll` ligado deixaria o wheel vazar para o app.
- **`zoomOnDoubleClick` continua `false`** (não foi pedido; duplo-clique fica livre).

## Riscos

**Nenhuma decisão em aberto.** O que restou são duas coisas que o build precisa saber, não escolher:

- **A armadilha do `onWheelCapture`** (D10, detalhada em Code Style): o React registra `wheel` como
  **passivo**, então `preventDefault()` num handler React é um **no-op silencioso** — o hook
  *pareceria* funcionar (o teste em jsdom passa!) e o app panaria vertical em cima do horizontal.
  Só `addEventListener` nativo com `{ passive: false }`. O teste que espiona o `addEventListener`
  existe **exatamente** para travar essa regressão.
- **Colisão preexistente `Space`.** `TaskNode` já intercepta `Space` para selecionar o card focado, e
  `Space` é também o `panActivationKeyCode` do RF. Com um card focado, apertar espaço faz as duas
  coisas. Isso **já é assim hoje** e o requisito diz "continua como está" — **não** mexer, só saber.
- **O anel muda o visual base do card** (hoje o card em light não tem contorno nenhum, só
  `shadow-sm`). É a consequência aceita de D7/D9; o item 7 da verificação visual existe para
  confirmá-la **no app**, não no teste.
