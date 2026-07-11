# Plano de implementação: C-0013 — Diagrama de dependências ReactFlow (cards + painel)

> Deriva de `spec.md` (mesma pasta). **Todas as decisões de design já estão resolvidas na
> spec** (§Assumptions + §Decisões do /devy:refine, D1–D7) — este plano decide só a
> *mecânica e a ordem*, não o design. Change 100% webview da app `apps/menubar`: **não**
> toca o motor (`src/` na raiz, inclusive `view.ts`/`computeDagreLayout`/`store.ts`) nem
> o Rust. Segue o padrão C-0009/C-0010/C-0012 (DESIGN.md, tokens-only, zero cor hardcoded).

## Overview

Revestir a view **Deps** (`apps/menubar/src/graph/`) para deixar de ser mímica de
terminal estática e virar um grafo **on-doctrine e navegável**:

1. **Nó = card de design-system** (paridade com `.kanban-card`): `TaskStatusDot` (dot
   estático) + ID mono + título sans (clamp 3 linhas) + `@step` falho. Estados completos
   (default/hover/focus-visible/selected/running).
2. **Canvas navegável e enxuto:** pan/zoom + `Background` de pontos + `Controls`
   (tematizados por tokens em light **e** dark). **Sem** `MiniMap`.
3. **Task(s) em execução sempre em destaque:** dot `state-running` + **pulso na borda**
   via `pulseFrame(tick)` (o tick único do `App`) + **arestas incidentes acesas e
   animadas** (CSS do RF, sem timer JS). `prefers-reduced-motion` → recolor estático.
4. **Clique no nó → mesmo `CardDetail`** do Kanban; **seleção compartilhada** Kanban ↔ Deps.

Zero capacidade nova de motor (AD-1: a view só observa). **Posições sempre de
`computeDagreLayout`** (AD-6) — a única adaptação é o fator cell→px, derivado das
dimensões do card, **100% no app** (D2). Zero cor/raio/spacing/tipografia hardcoded.

## Architecture Decisions (herdadas da spec — não reabrir)

- **AD-6 / SC #4 — geometria compartilhada intocada.** Posições vêm de
  `computeDagreLayout` (`loopy/tui/view`, dep transitiva não-editável). O motor **não**
  muda; a escala é adaptada no app.
- **D2 — escala derivada, não mágica.** `CARD_W`/`CARD_H`/gutter/`MIN_ROW_GAP` viram
  constantes TS nomeadas — **fonte única** que alimenta (a) a matemática cell→px e (b) o
  CSS do card (via CSS var). O eixo que aperta é o **vertical** (nós empilhados na mesma
  rank ficam `MIN_ROW_GAP`=2 rows à parte: 1 row de nó + 1 vazia preservada pela
  compactação `MAX_EMPTY_ROWS` do motor): `CELL_PX_Y = (CARD_H + gutter) / MIN_ROW_GAP`.
  O **horizontal** nunca aperta (dagre já espaça ranks por char-width + `ranksep:4`);
  `CELL_PX_X` é derivado para uma rank-step folgar `CARD_W`. **Guardrail:** teste de
  não-sobreposição num DAG representativo (asserção mais forte que "pos = col×escala").
- **D1 — dimensões do card:** largura fixa **220px**, título **clamp 3 linhas**, altura
  resultante ≈ **88px** (paridade total com `.kanban-card`; título completo vive no
  `CardDetail`).
- **D3 — arestas incidentes a running:** recolor `state-running` + fluxo animado (prop
  `animated` do RF = animação **CSS browser-driven**, sem timer JS). Demais no neutro
  quieto (`--border`). `prefers-reduced-motion` → recolor estático (sem marcha).
- **D4 — seleção × running = anéis concêntricos.** Seleção = anel `--accent` externo
  (box-shadow) + `accent-subtle` (o único anel-accent e o único fundo tingido). Running =
  realce **interno** `state-running` (pulsando) + dot + arestas. Coexistem: interno
  (estado) dentro do externo (interação); nenhum suprime o outro. Accent **nunca** vira
  cor de estado.
- **D5 — a11y do canvas:** o `div` do card é o **único** tab stop (`tabIndex=0`,
  `role=button`, `aria-pressed`, `aria-label`; Enter/Space abre o `CardDetail`). **Foco
  de nó nativo do RF desabilitado** (`nodesFocusable={false}`). Ao focar, **paneia** o
  viewport para o card ficar visível (pan do RF é `transform`, não scroll). Sem navegação
  por setas (YAGNI).
- **D6 — viewport:** `fitView` **uma vez** no **primeiro reveal** da pane Deps, depois
  **preserva** pan/zoom em todo toggle Kanban↔Deps e update de status. Trata o gotcha do
  RF (pane inicia size 0 sob `display:none` → o fit inicial roda no reveal, não no mount).
- **D7 — pulso do nó running:** só a borda/realce interno pulsa via `pulseFrame(tick)`
  (tick único do `App`). O **dot renderiza sem pulso** (variante estática — reusa
  `StatusDot` com `pulse` omitido, **sem** tocar `StatusIndicator`). `pulseFrame` é
  JS/inline → o gate de `prefers-reduced-motion` é **JS** (`matchMedia`), congelando a
  borda no frame estável.
- **AD-1 — a view só observa.** Nenhuma interação nova altera o Run; o único efeito
  colateral segue sendo o gate de aprovação, que já vive dentro do `CardDetail`.
- **Fronteira de monorepo.** Tudo em `apps/menubar`. `App.tsx` fica **inalterado** (já
  passa `selectedTaskId`/`onSelectTask` ao `ViewSwitcher`; a seleção via grafo entra pelo
  mesmo caminho de `effectiveTaskId`).

## Dependency graph

```
Fase 0 — primitivos (∥, sem arquivo compartilhado):
  T-001  scale.ts ────────────────┐
  T-002  usePrefersReducedMotion ─┤
  T-003  failedStepId ────────────┤
                                   │
Fase 1 — geometria + card (∥):     │
  T-001 ─────────────► T-004  DepsFlow escala derivada + não-sobreposição (nó ainda mono)
  T-001, T-002 ──────► T-005  TaskNode card de design-system
                                   │
Fase 2 — cards vivos + clique → CardDetail:
  T-004, T-005, T-003 ► T-006  DepsFlow: data do card + seleção + clique
  T-006 ──────────────► T-007  ViewSwitcher propaga seleção + integração no App
                                   │
Fase 3 — canvas navegável:
  T-007 ──────────────► T-008  DepsFlow: pan/zoom + Background + Controls + viewport (D6)
                                   │
Fase 4 — arestas vivas + a11y:
  T-008 ──────────────► T-009  DepsFlow: arestas incidentes animadas/recolor (D3)
  T-009 ──────────────► T-010  DepsFlow: a11y (nodesFocusable=false + pan-to-focus, D5)
```

Ordem bottom-up. **Ready inicial (3-way ∥): T-001, T-002, T-003.** As arestas serializam
edições de arquivos compartilhados entre worktrees (`DepsFlow.tsx` em
T-004/T-006/T-008/T-009/T-010; `ViewSwitcher.tsx` em T-007/T-008; `ui/index.ts` em T-002)
para evitar Merge conflict. A cadeia da Fase 2→4 é intrinsecamente sequencial (cada passo
constrói sobre um canvas já funcional).

## Vertical slicing (por que esta ordem)

Cada fase entrega um **caminho completo e verificável**, e a view fica **funcional o
tempo todo**:

- **Fase 0 (primitivos):** de-risco + DRY antes de qualquer visual. `scale.ts` isola a
  **matemática mais arriscada** (cell→px + não-sobreposição) num módulo puro e testável;
  `usePrefersReducedMotion` e `failedStepId` (extraído do `grouper`, mantendo paridade
  Kanban) são primitivos reusáveis pequenos.
- **Fase 1:** T-004 **prova a geometria** (teste de não-sobreposição contra caixas
  `CARD_W×CARD_H`) com o nó ainda mono — falha cedo se a escala estiver errada, sem
  arrastar visual junto. Em paralelo, T-005 constrói o **card** isolado, dirigido por
  `data` (testável sem `ReactFlow`).
- **Fase 2:** T-006 torna o card **real e interativo** (data completa + seleção + clique);
  T-007 fecha a fatia fim-a-fim — clicar num nó abre o **mesmo `CardDetail`** e a seleção
  reflete nas duas views. Até aqui o canvas ainda é estático, mas correto e clicável.
- **Fase 3:** o canvas ganha **pan/zoom + `Background` + `Controls`** e a persistência de
  viewport (D6) — a navegabilidade pedida.
- **Fase 4:** o sinal "vivo" completa (arestas incidentes acesas/animadas, D3) e a a11y
  do canvas fecha (um tab stop por card + pan-to-focus, D5).

O nó só troca de mono → card quando T-004 (escala) e T-005 (card) já existem, então
nenhum checkpoint deixa o grafo meio-quebrado.

## Fases & checkpoints

### Fase 0 — Primitivos (T-001 ∥ T-002 ∥ T-003)
Módulo de escala (de-risco), hook de reduced-motion, helper `failedStepId` (DRY).

**Checkpoint Primitivos:**
- [ ] `npm run typecheck` && `npm run lint` limpos.
- [ ] `npm test -w apps/menubar -- scale usePrefersReducedMotion failed-step` verdes.
- [ ] `grouper` reusa `failedStepId` sem mudar comportamento (suíte do Kanban verde).
- [ ] Nada visual mudou ainda (grafo mono intacto).

### Fase 1 — Geometria + card (T-004 ∥ T-005)
Escala derivada + prova de não-sobreposição; card de design-system (data-driven).

**Checkpoint Geometria+Card:**
- [ ] `npm test -w apps/menubar -- DepsFlow TaskNode` verdes.
- [ ] Posições = `computeDagreLayout` × escala **derivada**; **nenhuma** caixa
      `CARD_W×CARD_H` de dois cards se sobrepõe no DAG representativo (empilhamento +
      ranks adjacentes).
- [ ] `TaskNode` renderiza dot + ID + título (clamp 3, sans) + `@step`; `aria-pressed`
      reflete `selected`; running pulsa **na borda** e o **dot fica estático**; **sem**
      mono no título. Correto em light **e** dark.
- [ ] Grafo ainda usa o nó mono no app (troca acontece em T-006) — normal.

### Fase 2 — Cards vivos + clique → CardDetail (T-006 → T-007)
DepsFlow alimenta a data do card, habilita seleção/clique; ViewSwitcher propaga; App liga.

**Checkpoint Seleção:**
- [ ] `npm test -w apps/menubar -- DepsFlow ViewSwitcher App` verdes.
- [ ] Grafo mostra **cards** posicionados pelo dagre; `onNodeClick` → `onSelectTask(id)`;
      `onPaneClick` **não** desseleciona.
- [ ] Clicar num nó abre o **mesmo `CardDetail`** do Kanban (descrição/deps/log/gate); a
      seleção reflete nas duas views; re-clique fecha (toggle do `App`); aprovação
      pendente ainda força o drawer (D6/C-0011).
- [ ] `App.tsx` inalterado (só `App.test.tsx` ganhou o teste de integração).

### Fase 3 — Canvas navegável (T-008)
pan/zoom + `Background` (pontos) + `Controls` (tematizados) + viewport persistente (D6).

**Checkpoint Navegabilidade:**
- [ ] `npm test -w apps/menubar -- DepsFlow ViewSwitcher` verdes.
- [ ] pan/zoom operam; `Background` de pontos e `Controls` (zoom/fit) **tematizados por
      tokens** em light **e** dark (não o chrome default light-only do RF). **Sem** MiniMap.
- [ ] `fitView` só no **primeiro reveal** da pane Deps; trocar Kanban↔Deps e updates de
      status **preservam** pan/zoom; o botão "fit" re-enquadra sob demanda.

### Fase 4 — Arestas vivas + a11y (T-009 → T-010)
Arestas incidentes a running acesas/animadas; foco de card único + pan-to-focus.

**Checkpoint final (Success Criteria da spec):**
- [ ] `npm run typecheck && npm run lint && npm test` verdes na raiz + `npm test -w
      apps/menubar` verde.
- [ ] Nós = cards de design-system (dot + ID + título + `@step`), **não** texto mono;
      correto em light **e** dark.
- [ ] Posições de `computeDagreLayout` com a nova escala — **sem** auto-layout do RF e
      **sem** sobreposição.
- [ ] Canvas navegável e enxuto: pan/zoom + `Background` + `Controls`; **sem** MiniMap.
- [ ] Task(s) em execução **sempre destacadas**: dot `state-running` + pulso na borda +
      **arestas incidentes acesas e animadas**; o resto fica quieto. `prefers-reduced-
      motion` → sem pulso nem marcha (recolor estático).
- [ ] Seleção × running **concêntricos** (accent externo estático + running interno
      pulsando), nunca conflatados (D4).
- [ ] Clique no nó → **mesmo `CardDetail`**; seleção compartilhada; clique no canvas vazio
      **não** desseleciona.
- [ ] a11y: card **focável** e **ativável por teclado** (Enter/Space); **um** tab stop por
      card; **pan-to-focus** traz o card focado à vista.
- [ ] **Zero cor hardcoded** no diff; **motor intocado** (nenhum arquivo em `src/` na raiz
      alterado).
- [ ] Revisar com o humano antes de considerar concluído.

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Escala cell→px erra e cards se sobrepõem (especialmente horizontal, dependente das larguras de rank do dagre) | Alto | `scale.ts` deriva de constantes nomeadas (D2) e o **teste de não-sobreposição** num DAG representativo é **gate** (T-004); se falhar, ajustar `MIN_RANK_COL_GAP`/gutter — a asserção surfa o erro em vez de "posição = col×escala". De-riscado como **primeira** task. |
| `fitView` roda no mount com a pane `display:none` (size 0) e não enquadra nada (D6) | Médio | Fit **imperativo** (`useReactFlow().fitView()`) disparado no **primeiro reveal** (`active` do ViewSwitcher) + guard de "já enquadrou"; usar `useNodesInitialized` para esperar as medidas. Remover o prop `fitView` sempre-ligado atual. |
| `Controls`/`Background` renderizam o chrome default light-only do RF (fora de doctrine) | Médio | `DepsFlow.css` (NOVO) sobrescreve `.react-flow__controls*` e a cor do `Background` com tokens, em light **e** dark. Validação visual é gate do checkpoint da Fase 3. |
| Pulso do nó não desliga em `prefers-reduced-motion` (é JS/inline, não CSS) | Médio | Gate **JS** via `usePrefersReducedMotion` (T-002): DepsFlow computa **uma vez** e injeta `reducedMotion` na `data` de cada nó; o card congela a borda no frame estável. Arestas (CSS `animated`) desligam por `@media` no CSS. |
| `DepsFlow.tsx` editado por 5 tasks (T-004/006/008/009/010) → Merge conflict entre worktrees | Baixo | As arestas de dependência serializam esses edits (a cadeia é sequencial de fato). Sem paralelismo forçado sobre o mesmo arquivo. |
| Paridade `@step` falho diverge do Kanban | Baixo | `failedStepId(task)` extraído do `grouper` (T-003, escalated-only) e reusado nas duas views — paridade garantida por construção. |
| `nodeTypes`/`edgeTypes` re-registrados a cada render (warning do RF + perf) | Baixo | Mantê-los **estáveis fora** do componente (como hoje); `data` imutável a cada update. |

## Open questions

Nenhuma bloqueante — a spec fechou todas as branches de design no /devy:refine (D1–D7).
Um ponto técnico "a confirmar" durante T-008 (Context7 estava offline no planejamento):
os nomes exatos da API do `@xyflow/react` **v12.11.2** foram verificados direto nos tipos
do pacote instalado — `Background`/`BackgroundVariant`/`Controls`/`useReactFlow`
(`fitView`/`setCenter`)/`useNodesInitialized`/`nodesFocusable`/`onNodeClick`/`onPaneClick`
existem. Confirmar detalhes de assinatura contra os tipos instalados na hora de escrever
(source-driven), não contra memória.

## Nota sobre a lista de arquivos da spec

A spec lista só `TaskNode.css` como NOVO. Esta implementação adiciona também
**`DepsFlow.css` (NOVO)** para o chrome de canvas (`Background`/`Controls`/recolor de
arestas), que é nível-canvas e não cabe no CSS do card — desvio mecânico justificado, sem
mudar nenhuma decisão de design. Novos utilitários pequenos (`graph/scale.ts`,
`ui/usePrefersReducedMotion.ts`, helper `failedStepId`) seguem "muitos arquivos pequenos".
