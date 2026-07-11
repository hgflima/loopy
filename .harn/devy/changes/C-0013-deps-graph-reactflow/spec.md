# Spec: C-0013 — Diagrama de dependências ReactFlow (cards + painel)

> Follow-up de C-0007 (dashboard/grafo na TUI) e C-0009/C-0010/C-0011 (Native UI menubar).
> A view **Deps** (`apps/menubar/src/graph/DepsFlow.tsx`) já usa ReactFlow (`@xyflow/react`),
> mas renderiza cada task como **texto monoespaçado** (glifo + id) — mímica de terminal que o
> `DESIGN.md` explicitamente rejeita — e é **totalmente estática** (sem pan/zoom, nós não
> selecionáveis, sem clique). Esta change **não adiciona capacidade de motor** — reveste a view
> Deps com **cards de design-system**, torna o canvas **navegável**, **destaca sempre as tasks em
> execução**, e liga o **clique no nó ao mesmo painel `CardDetail` do Kanban**.

## Objective

Dois objetivos, direto do pedido:

1. **Diagrama melhor, visual e on-doctrine, com ReactFlow** — inspirado em
   `Azim-Ahmed/Automation-workflow` (nós como cards com ícone/estado, canvas navegável com
   Background/Controls, arestas suaves). Concretamente:
   - Substituir o `TaskNode` monoespaçado por um **card completo**, com **paridade visual com o
     card do Kanban**: dot de status + ID (mono) + título (clamp 3 linhas) + step falho (`@id`).
   - Tornar o canvas **navegável e enxuto**: habilitar **pan/zoom**, um **`Background` de pontos**
     sutil e **`Controls`** (zoom in/out/fit). **Sem `MiniMap`** (evita a cara de "Grafana
     sobrecarregado" que o DESIGN.md rejeita).
   - **Destacar sempre as task(s) em execução** — o sinal "vivo" do produto. A ênfase padrão do
     grafo é o *running set* (não hover nem seleção): nó running com dot `state-running` + pulso
     (`pulseFrame(tick)`) e suas **arestas incidentes acesas**; o resto fica quieto.

2. **Clique no nó abre o mesmo painel do Kanban** — clicar num card do grafo abre o **mesmo
   `CardDetail`** (descrição, deps, log, gate de aprovação) que o clique num card do Kanban.
   A **seleção é compartilhada** entre as duas views (já é: `selectedTaskId` mora no `App`).

### Invariantes preservadas

- **AD-6 / SC #4 (C-0007)** — as posições dos nós continuam vindo de **`computeDagreLayout`**
  (`loopy/tui/view`), a **fonte única de geometria** compartilhada com a TUI Ink. **Nunca** do
  auto-layout do ReactFlow. Como o pedido escolheu cards maiores, a adaptação de escala é feita
  **100% no app** (fator cell→px + dimensões fixas de card), **sem tocar** a função de layout.
- **AD-1 — a view só observa.** Nenhuma interação nova altera o Run; o único efeito colateral
  continua sendo o gate de aprovação que já vive dentro do `CardDetail`.
- **Fronteira de monorepo** — esta change vive em `apps/menubar` e **não edita o motor** (`src/`
  na raiz), incluindo `src/tui/view.ts`/`store.ts`.

## User

O mesmo dev de C-0009+: roda `@hgflima/loopy` sobre um repo-alvo e acompanha o Run pela tray.
Abre o dashboard e alterna **Kanban ↔ Deps** (segmented control). No grafo quer (a) ler a forma
do DAG e **o que está rodando** de relance, e (b) clicar numa task e obter **o mesmo detalhe**
que já tem no Kanban — sem aprender uma segunda superfície.

## Success (narrativa)

Abrir dashboard → **Deps** → cards de design-system (não texto mono) posicionados pelo dagre,
arestas suaves ligando deps → dependentes → **pan/zoom + `Background` de pontos + `Controls`**
disponíveis → **task(s) em execução sempre em destaque** (dot running-cyan + pulso + arestas
incidentes acesas) → clicar num card → **mesmo `CardDetail`** do Kanban abre no drawer à direita,
e a seleção reflete nas duas views → tudo correto em **light e dark**, honrando
`prefers-reduced-motion`, **zero cor hardcoded** no diff, **motor intocado**.

## Tech Stack

Herdado de C-0009/C-0010 — **sem novas dependências**:

- **Webview:** React 18 + Vite + `@tauri-apps/api` v2.
- **Grafo:** `@xyflow/react` **v12** (já instalado e já em uso). `ReactFlowProvider` já envolve a
  pane no `ViewSwitcher`. Componentes usados: `ReactFlow`, `Handle`/`Position`, **`Background`**,
  **`Controls`** (todos de `@xyflow/react`; `Controls` requer `@xyflow/react/dist/style.css`, já
  importado).
- **Geometria:** `computeDagreLayout` de `loopy/tui/view` — **inalterada** (dep transitiva do
  pacote `@hgflima/loopy`, não editável nesta change).
- **Reuso de UI:** `CardDetail`, `TaskStatusDot`, `MarkdownStream` e os tokens de `tokens.css`.
- **Estado de estilo:** OKLCH via `tokens.css` (WebKit nativo).

## Commands

Inalterados (raiz + workspace `apps/menubar`):

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

Sem novos comandos Tauri (Rust) — esta change é 100% webview.

## Project Structure

Arquivos tocados (em `apps/menubar/`; `NOVO` salvo indicação):

```
apps/menubar/
  src/graph/
    TaskNode.tsx      → REESCRITA: card de design-system em vez de texto mono. Dot de status
                        (TaskStatusDot, pulse-off) + ID (data/mono) + título (body/sans, clamp 3
                        linhas, paridade Kanban) + step falho (@id, state-failed-ink). Estados:
                        default/hover/focus-visible/selected/running (borda interna pulsando via
                        pulseFrame). Handles Left(target)/Right(source), hidden (rankdir LR).
    TaskNode.css      → NOVO: estilos do card com tokens.css; reusa a linguagem de `.kanban-card`
                        (surface-elevated, shadow-sm em light / hairline em dark, ring --accent
                        na seleção). Ênfase running (state-running) separada da seleção (accent).
    TaskNode.test.tsx → ATUALIZAR: novo card (dot+ID+título+falho), aria de selected, pulso running.
    DepsFlow.tsx      → habilita pan/zoom, `elementsSelectable`, `onNodeClick → onSelectTask`;
                        recebe `selectedTaskId` + deriva o *running set*; injeta `selected`/
                        `isRunning` no `data` do nó; monta `<Background variant=Dots/>` +
                        `<Controls/>` (ambos tematizados por tokens); arestas `type: "smoothstep"`,
                        `animated` nas incidentes a running; CELL_PX **derivado** de CARD_W/CARD_H
                        (D2); fit no primeiro reveal + preserva viewport (D6); pan-to-focus (D5).
    DepsFlow.test.tsx → ATUALIZAR: nova escala; clique → onSelectTask; selected/running no data;
                        arestas smoothstep; empty → vazio (mantém a asserção AD-6 SC #4).
  src/panes/
    ViewSwitcher.tsx  → propaga `selectedTaskId` + `onSelectTask` ao `DepsFlow` (hoje só o Kanban
                        recebe). Nada mais muda (ambas as views seguem montadas, estado preservado).
  src/App.tsx         → INALTERADO esperado: já renderiza `CardDetail` a partir de `effectiveTaskId`
                        (seleção OU aprovação). A seleção via grafo entra pelo mesmo caminho.

.harn/devy/changes/C-0013-deps-graph-reactflow/ → este spec, plan, todo
```

## Code Style

TypeScript ESM; componentes puros + estado de UI no `App` (já existe). **Toda cor, raio, spacing e
tipografia vêm de `tokens.css`** (nunca literais) — varre o diff.

- **Card do nó** reusa a gramática do `.kanban-card`: fundo `surface-elevated`, `shadow-sm` em
  light e hairline `--border` em dark, radius `--r-md`, dot de status via `TaskStatusDot`, título
  em `body` sans com clamp, ID em `data` mono. **Machine-Voice Rule**: mono só no ID/step, nunca no
  título.
- **Duas ênfases distintas, nunca conflatadas** (DESIGN.md §2):
  - **Seleção/interação** = ring `--accent` (magenta) + `accent-subtle`, como `.kanban-card--selected`.
  - **Running (estado)** = borda/realce **interno** em `state-running` + pulso via `pulseFrame(tick)`
    (o mesmo tick único do `App`, jamais um timer por nó). O **dot fica estático** aqui (pulse-off):
    um único pulso sincronizado por card, na borda (D7). Accent nunca vira cor de estado. Quando o
    card está **selecionado E running**, os dois anéis coexistem **concêntricos** — running interno
    (pulsando) dentro do accent externo (estático) (D4).
- **Arestas** suaves (`smoothstep`), quietas por padrão; as **incidentes a um nó running acendem**
  (hue `state-running`) **com fluxo animado** (prop `animated` do RF — CSS browser-driven, sem timer
  JS; `prefers-reduced-motion` → recolor estático). As demais ficam **neutras/quietas** (`--border`),
  sem esmaecimento ativo extra. Motion só onde reporta estado real ("vivo") — nada decorativo.
- Imutabilidade em todo update; `nodeTypes`/`edgeTypes` estáveis fora do componente (evitar
  re-registro do ReactFlow).

```tsx
// TaskNode — card, não texto mono. Cor/estado por classe + tokens (sem hex).
<div
  className={cx("deps-node", isRunning && "deps-node--running", selected && "deps-node--selected")}
  role="button" tabIndex={0} aria-pressed={selected}
  onKeyDown={onEnterOrSpace(() => onSelect(id))}
>
  <Handle type="target" position={Position.Left} style={{ visibility: "hidden" }} />
  <TaskStatusDot status={status} />
  <span className="deps-node__id t-data">{id}</span>
  <span className="deps-node__title t-body">{title}</span>
  {failedAtStepId && <span className="deps-node__failed t-data">@{failedAtStepId}</span>}
  <Handle type="source" position={Position.Right} style={{ visibility: "hidden" }} />
</div>
```

Copy em português onde houver texto (não deve haver muito — o card é dado).

## Testing Strategy

Padrão AAA; ≥80% de cobertura no código novo. Mock de `@xyflow/react` no estilo já usado em
`DepsFlow.test.tsx` (captura de props).

- **TaskNode** (vitest + Testing Library): renderiza dot + ID + título; `aria-pressed` reflete
  `selected`; running aplica a classe/estilo de pulso **na borda** conforme `pulseFrame(tick)` e o
  **dot fica estático** (pulse-off); step falho aparece quando presente; **sem** texto monoespaçado
  no título.
- **DepsFlow:**
  - Posições dos nós = `computeDagreLayout` × escala **derivada** (mantém a prova AD-6 / SC #4, com as
    novas constantes CELL_PX de CARD_W/CARD_H).
  - **Não-sobreposição:** nenhuma caixa de dois cards (CARD_W × CARD_H em coords de flow) se
    intersecta num DAG representativo (empilhamento + ranks adjacentes).
  - `onNodeClick` chama `onSelectTask(id)`; `onPaneClick` **não** desseleciona.
  - `data` de cada nó carrega `selected` (== `selectedTaskId`) e `isRunning` (status running).
  - Arestas = arestas da geometry, `type: "smoothstep"`; incidentes a running → `animated: true` +
    classe de recolor `state-running`; demais quietas.
  - `tasks: []` → nós e arestas vazios.
- **ViewSwitcher:** o `DepsFlow` recebe `selectedTaskId` + `onSelectTask` (props propagadas);
  clicar num nó (mock) chama o handler; alternar de view preserva estado.
- **Integração (`App.test.tsx`):** selecionar uma task no grafo abre o `CardDetail` com a task
  correta — o **mesmo** painel que o Kanban abre; re-clicar fecha (toggle já existente); uma
  aprovação pendente ainda força o drawer (D6, C-0011).
- **Manual/visual:** pan/zoom, `Background` e `Controls` (tematizados) operam; cards legíveis em
  **light e dark**; running em destaque (borda pulsando + **fluxo animado** nas arestas incidentes);
  **selected+running** mostra os dois anéis concêntricos sem competir; `prefers-reduced-motion` → sem
  pulso nem marcha (recolor estático); trocar Kanban↔Deps **preserva** pan/zoom; foco por teclado
  **paneia** o card focado à vista; canvas grande sem sobreposição de cards.
- **Regressão:** demais suites verdes; `npm run typecheck` e `npm run lint` limpos.

## Boundaries

- **Always:**
  - Só tokens de `tokens.css` — zero hex/cor/spacing/tipografia hardcoded (varre o diff).
  - Temas claro **e** escuro completos; honrar `prefers-reduced-motion` (pulso/anim desligam).
  - Set de estados completo no card (default/hover/focus-visible/selected/running).
  - **Posições sempre de `computeDagreLayout`** com **CELL_PX derivado** de CARD_W/CARD_H (D2) —
    jamais o auto-layout do ReactFlow; teste de **não-sobreposição** cobre a escala.
  - **Task(s) em execução sempre em destaque** (borda interna pulsando via `pulseFrame` + dot running
    **estático** + arestas incidentes acesas **e animadas**; reduced-motion → recolor estático).
  - Seleção × running **concêntricos** (accent externo estático + running interno pulsando), nunca
    conflatados nem um suprimindo o outro (D4).
  - Clique no nó abre o **mesmo `CardDetail`** do Kanban; **seleção compartilhada** Kanban ↔ Deps.
    Clique no canvas vazio **não** desseleciona.
  - a11y: nó **focável** e **ativável por teclado** (Enter/Space), `aria-pressed`/`aria-label`;
    **um tab stop por card** (foco de nó nativo do RF desabilitado) + **pan-to-focus**.
  - **Viewport:** `fitView` no **primeiro reveal** da pane Deps, depois **preserva** pan/zoom (nunca
    reseta na troca de view nem em update de status).
  - **Um único timer de pulso** (o do `App`, via `tick`) — nunca um `setInterval` por nó (o fluxo das
    arestas é animação **CSS** do RF, não timer JS).
- **Never:**
  - **Editar o motor** (`src/` na raiz) — inclusive `view.ts`/`computeDagreLayout`/`store.ts`.
  - Adicionar dependência nova (usar só `@xyflow/react` já instalado).
  - Auto-layout do ReactFlow para posicionar nós.
  - Mono fora de ID/step (título/label são sans — Machine-Voice Rule).
  - `MiniMap` (fora de escopo, decisão do usuário).
  - Side-stripe colorido no card (anti-ref DESIGN.md) ou animação decorativa sem função.
  - Conflatar accent (interação/seleção) com hue de estado (running).
  - Mutar estado (padrões imutáveis) ou hardcodar cor/valor mágico.

## Success Criteria

1. `npm run typecheck && npm run lint && npm test` verdes na raiz (com os testes novos/atualizados).
2. **Nós = cards de design-system** (dot + ID + título + step falho), **não** texto monoespaçado.
   Correto em light **e** dark.
3. **Posições vêm de `computeDagreLayout`** (AD-6) com a nova escala — **sem** auto-layout e **sem**
   sobreposição de cards num DAG típico.
4. **Canvas navegável e enxuto:** pan/zoom + `Background` de pontos + `Controls` (zoom/fit). **Sem**
   `MiniMap`.
5. **Task(s) em execução sempre destacadas** — dot `state-running` + pulso (`pulseFrame`) + arestas
   incidentes acesas; o resto fica quieto.
6. **Clique no nó → mesmo `CardDetail`** do Kanban (descrição/deps/log/gate); a **seleção reflete
   nas duas views**.
7. **Zero cor hardcoded** no diff; **motor intocado** (nenhum arquivo em `src/` na raiz alterado).
8. a11y: o card do nó é **focável** e **ativável por teclado**.

## Assumptions

Decisões **pré-spec** confirmadas com o usuário (via `AskUserQuestion`, 2026-07-11):

1. **Nó = card completo (paridade Kanban)** — dot + ID + título + step falho; **não** chip/mínimo.
   Consequência aceita: **reescalar** o fator cell→px do dagre p/ cards maiores não sobreporem.
2. **Canvas navegável + enxuto** — pan/zoom + `Background` + `Controls`; **sem** `MiniMap`.
3. **Ênfase padrão = task(s) em execução** (não hover nem seleção-subgrafo). O grafo destaca
   sempre o *running set*; a seleção apenas abre o painel e marca o ring de interação.
4. **Sem novas deps**; **motor intocado**; **geometria compartilhada preservada** (AD-6).
5. Este spec **vive na pasta da change** (`.harn/devy/changes/C-0013-…`), não na raiz — coerente
   com C-0012. Slot `C-0013` livre após C-0012.

## Decisões da entrevista (/devy:refine, 2026-07-11)

Cada questão aberta do spec foi resolvida na entrevista; estas decisões substituem a seção
"Questões" original.

- **D1 — Dimensões do card:** largura fixa **220px**, título **clamp 3 linhas** (paridade visual
  total com `.kanban-card`). Altura resultante ≈ **88px**. O título completo vive no `CardDetail`
  ao clicar.
- **D2 — Escala CELL_PX: derivada das dimensões do card** (não multiplicador mágico). `CARD_W`/
  `CARD_H`/gutter viram constantes TS nomeadas — **fonte única** que alimenta a matemática de layout
  e o CSS do card (via var). `CELL_PX_Y = (CARD_H + gutter) / MIN_ROW_GAP` (o constraint que aperta é
  **vertical**: nós empilhados na mesma rank ficam ~2 rows à parte — nó + 1 row vazia preservada
  pela compactação `MAX_EMPTY_ROWS`). `CELL_PX_X` proporcional para uma rank-step folgar `CARD_W`
  (horizontal nunca aperta: dagre já espaça ranks por char-width + `ranksep:4`). **Novo teste de
  regressão:** nenhuma caixa de dois cards se sobrepõe num DAG representativo — asserção mais forte
  que "posição = col×escala", ainda ancorada em `computeDagreLayout` (AD-6 / SC #4).
- **D3 — Arestas incidentes a running: recolor `state-running` + fluxo animado** (marching-ants via
  a prop `animated` do RF — animação **CSS browser-driven**, sem timer JS, não fere a regra de timer
  único). As demais arestas ficam no **neutro quieto** (`--border`), sem esmaecimento ativo extra.
  **`prefers-reduced-motion` → cai para recolor estático** (sem marcha).
- **D4 — Empate seleção × running: anéis concêntricos.** Seleção = anel `--accent` (box-shadow
  externo) + `accent-subtle` — o **único** anel-accent e o **único** fundo tingido. Running = borda/
  realce **interno** `state-running` (pulsando) + dot + arestas incidentes acesas. Card em ambos:
  anel running interno dentro do anel accent externo — hues distintos em raios distintos; o
  movimento no anel interno separa **estado** (running) de **interação** (seleção). Nenhum é
  suprimido.
- **D5 — a11y do canvas: paridade Kanban + pan-to-focused-node.** O card div é o **único** alvo de
  foco (`tabIndex=0`, `role=button`, `aria-pressed`, `aria-label`); Enter/Space abre o `CardDetail`.
  Tab segue a ordem dagre. Ao focar, **paneia o viewport** para o card ficar sempre visível (pan/zoom
  do RF é `transform`, não scroll — foco fora da tela não auto-rola). **Desabilitar o foco de nó
  nativo do RF** (um tab stop por card, não dois). **Sem** navegação por setas (YAGNI; sem precedente
  no app).
- **D6 — Persistência de viewport: fit uma vez no primeiro reveal da pane Deps, preservar depois.**
  Preserva pan/zoom em todo toggle Kanban↔Deps e em updates de status ao vivo — nunca reseta. O botão
  "fit" dos `Controls` re-enquadra sob demanda. Como o set de nós é **estável** no Run (backlog
  parseado inteiro como pending), nada fica órfão; se uma task for realmente adicionada, mantém o
  viewport. Tratar o gotcha do RF: pane inicia com size 0 enquanto `display:none` → o `fitView`
  inicial roda **no primeiro reveal**, não no mount.
- **D7 — Pulso do nó running: só a borda/realce interno pulsa via `pulseFrame(tick)`** (sincronizado
  ao tick único do App, testável, **um** lugar para gatear reduced-motion). O **dot renderiza sem o
  pulso CSS embutido** aqui (variante pulse-off) — um único pulso sincronizado por card. `prefers-
  reduced-motion` congela a borda no estado estático (dot já estático).

### Defaults de implementação (decididos por inspeção — vetáveis)

- **Reduced-motion do pulso tick:** gate via `matchMedia('(prefers-reduced-motion: reduce)')`,
  congela a borda no frame estável (o `pulseFrame` é JS/inline, então a media query CSS sozinha não o
  desliga — precisa do gate JS).
- **`Background`** = pontos (`BackgroundVariant.Dots`), cor tokenizada sutil, gap ~16–20;
  **`Controls`** tematizados por tokens em light **e** dark (não o chrome default light-only do RF).
- **Clique no canvas vazio** (`onPaneClick`) **não** limpa a seleção (só re-clicar o nó ou o botão de
  fechar do drawer) — panning não desseleciona por acidente.
- **Clique no nó** reusa o toggle existente do `App` (`handleSelectTask`: re-clique fecha o drawer).
