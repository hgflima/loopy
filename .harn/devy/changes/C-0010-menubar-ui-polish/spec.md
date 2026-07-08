# Spec: C-0010 — Menubar UI polish (impecável)

> Follow-up de C-0009 (Native UI). C-0009 entregou a paridade funcional
> (grafo + Kanban + streams + gate) numa app Tauri de barra de menus. Esta change
> **não adiciona capacidade de motor** — refina a UI/UX da app `apps/menubar`
> até o padrão descrito em `apps/menubar/DESIGN.md` ("Mission Control Window":
> chrome neutro, cor só com significado, magenta = interação/aprovação).

## Objective

Elevar a app menubar de "funciona" para **impecável**: identidade de marca oficial,
popover no design system, Kanban legível, painel de streaming alto/contínuo com
markdown, e **drill-in por card** (descrição + deps + log persistido + aprovação
contextual). Tudo consumindo `src/ui/tokens.css`; zero cor/spacing hardcoded.

**Usuário:** o mesmo dev de C-0009 — roda o `loopy` sobre um repo-alvo e acompanha
o Run por uma janela nativa. Agora quer uma superfície que ele confia olhar de
relance E na qual consegue mergulhar num card específico sem perder contexto.

**As 10 melhorias, agrupadas em 4 frentes:**

- **A · Marca & tray** (#1): app icons + tray oficiais.
- **B · Layout do Kanban** (#2 popover, #3 largura, #4 título): legibilidade nativa.
- **C · Painel de streaming** (#5 altura+fold, #6 markdown, #9 cross-step+divisor,
  #10 1–4 panes): a região de streams ao vivo.
- **D · Drill-in por card** (#7 detalhe+log persistido, #8 aprovação no card, #10):
  mergulho num card, com histórico que sobrevive à conclusão.

**Sucesso:** abrir o `.app` → ícone oficial na barra de menus (adapta claro/escuro)
→ popover impecável → Kanban com colunas largas e títulos legíveis em 2 linhas →
streams altos (40–50%) com markdown, divisores por step e scroll contínuo →
clicar num card abre seu detalhe (descrição + deps + log) que **persiste após
concluir** → um gate de aprovação é avisado e resolvido **dentro do card**.

## Tech Stack

Herdado de C-0009 (sem novas dependências de motor):

- **Webview:** React 18 + Vite + `@xyflow/react` + `@tauri-apps/api` v2.
- **Nativa:** Tauri v2 (Rust), plugins `shell`/`positioner`/`dialog`/`notification`.
- **Reuso do motor (AD-6, sem fork):** apresentação pura sobre `StoreState` de
  `loopy/tui/store`. **Novo nesta change:** como o `reduce` do motor **reseta
  `task.stream` a cada step/attempt** (`store.ts` — `stream: ""` em `step_started`),
  o histórico cross-step vive na **camada do app** (`store-bridge`), NÃO no `reduce`.
- **Extensão aditiva do Transport (OQ1, aprovada; fonte confirmada em D3):**
  `task_registered` ganha `description` e `deps`. **O motor NÃO tem campo `description`** —
  a fonte é `task.body` (bloco indentado do `todo.md`) **com a linha `Deps:` removida**;
  `deps` vêm de `task.deps: string[]` (ambos já no `Task` — `src/types.ts`). `TaskState`
  passa a carregá-los. É **aditivo e gated por `--emit-events`**: o `reduce` segue exaustivo,
  e `RunLoopResult` continua **byte-idêntico** com/sem a flag (AD-1). Não altera
  semântica de loop (AD-1) — só encaminha metadado que o motor possui.
- **Markdown (APROVADO, D5):** `react-markdown` + `remark-gfm`, **sem `rehype-raw`**
  (HTML embutido desabilitado — streams do agente = conteúdo não-confiável). Única dep
  nova. Perf: segmentos concluídos são memoizados; só o tail em crescimento re-parseia
  (evita O(n²) no stream ao vivo). Versões fixadas via Context7 no plano.

## Commands

Inalterados de C-0009 (raiz + workspace `apps/menubar`):

```
# Qualidade (raiz — cobre o webview)
Typecheck:   npm run typecheck
Lint:        npm run lint
Test:        npm test

# App
Dev (nativo):  npm run dev -w apps/menubar        # tauri dev
Dev (webview): npm run dev:web -w apps/menubar     # Vite standalone, NDJSON mockado
Build .app:    npm run build -w apps/menubar       # build:sidecar && tauri build
Atalho root:   npm run menubar

# Rust
Clippy: cargo clippy --manifest-path apps/menubar/src-tauri/Cargo.toml
Test:   cargo test   --manifest-path apps/menubar/src-tauri/Cargo.toml
```

## Project Structure

Arquivos tocados por esta change (existentes salvo `NOVO`):

```
src/                                    → motor: extensão ADITIVA do Transport (OQ1)
  tui/store.ts                          → TaskState + `description?`/`deps?`; task_registered carrega ambos
  tui/start.ts (ou emissor)             → popula description/deps do modelo de task ao emitir task_registered

.harn/design/logo/loopy-brand/          → FONTE dos assets oficiais (read-only)
  macos/AppIcon.icns, macos/AppIcon.iconset/*  → app icon
  macos/tray/loopy-trayTemplate{,@2x}.png      → tray template (menubar)
  png/icon-rounded-dark/*                       → PNGs do app icon

apps/menubar/
  src-tauri/
    icons/                → SUBSTITUIR placeholders pelos assets de marca
    icons/tray-template.png → SUBSTITUIR pelo tray oficial (mantém main.rs:120 .icon_as_template(true))
    tauri.conf.json       → atualizar lista `bundle.icon`
    src/main.rs           → (só se necessário) confirmar tray template; nada de reintroduzir a flag
  src/ui/
    tokens.css            → (se faltar) tokens usados pelas novas superfícies
    MarkdownStream.tsx    → NOVO: render sanitizado de markdown para voz-de-máquina
  src/popover/
    Glance.tsx            → REESCRITA: remover inline styles off-brand → design system
    Glance.css            → NOVO
  src/kanban/
    kanban.css            → alargar coluna; título 2 linhas (line-clamp); estado selecionado
    KanbanBoard.tsx       → card clicável/focável (Enter/Space) → seleção; abre o drawer (D2 interação)
    CardDetail.tsx        → NOVO: drawer lateral DIREITO (~400px, altura cheia da janela, D1);
                            desc (markdown) + deps (chips c/ status) + log persistido + gate contextual
    CardDetail.css        → NOVO
  src/panes/
    StreamPanel.tsx/.css  → default ~45% da altura (OQ3); fold → barra fina persistente ~28px
                            "▸ Streams · N rodando" (D4); ≤4 panes + chip "＋N rodando" (OQ2);
                            markdown; divisor rotulado por step; scroll contínuo cross-step
    ApprovalPrompt.tsx    → REESCRITA: remover modal full-screen (inset:0/backdrop/índigo #1a1a2e)
                            → componente no design system, embutido no CardDetail (gate no drawer, D6)
  src/state/
    store-bridge.ts       → NOVO acumulador: histórico de stream por (taskId, stepId), sobrevive a done
    stream-history.ts     → NOVO: função pura (AD-6) que fatia o transcript em segmentos por step
    stream-history.test.ts → NOVO

.harn/devy/changes/C-0010-menubar-ui-polish/  → este spec, plan, todo
```

## Code Style

TypeScript ESM, componentes puros de `StoreState` + estado de UI local. **Toda cor,
raio, spacing e tipografia vêm de `tokens.css`** (nunca literais). Exemplo do padrão
correto (contraste com o `Glance.tsx` atual, que hardcoda `#007AFF`/`cyan`/`orange`):

```tsx
// ❌ atual (off-brand, inline):  background:"#007AFF"  color:"cyan"
// ✅ alvo (design system):
<button className="btn btn--primary" onClick={() => invoke("show_main_window")}>
  Abrir
</button>
// .btn--primary { background: var(--accent); color: var(--surface-elevated); }
```

Acúmulo de histórico de stream = **função pura testável** (AD-6), separada do render:

```ts
// stream-history.ts — reconstrói segmentos por step a partir do bridge, não do reduce
export interface StreamSegment { readonly stepId: string; readonly label: string; readonly text: string; }
export function segmentsFor(taskId: string, hist: StreamHistory): StreamSegment[] { /* puro */ }
```

Motion honra `prefers-reduced-motion`; contraste WCAG AA em light **e** dark.

## Testing Strategy

- **Webview (vitest + Testing Library):**
  - `stream-history`: `stream_chunk`s intercalados com `step_started` produzem os
    segmentos certos (tag por `currentStepId`); histórico **persiste após
    `task_finished`** (não reseta como `task.stream`).
  - `Glance`: renderiza estados idle/running/gate; ação "Abrir" invoca
    `show_main_window`; sem literais de cor no DOM (usa classes/tokens).
  - `KanbanBoard`: clicar/`Enter` num card seleciona e abre `CardDetail`.
  - `CardDetail`: mostra descrição + deps + log; um `approval_requested` para a
    task exibe Aprovar/Reprovar inline e emite `approval_decision`.
  - `MarkdownStream`: markdown com HTML embutido é **sanitizado** (não injeta nós).
- **Manual/visual:** rodar um Run real; verificar ícone na menubar (claro/escuro),
  popover, colunas largas, título 2 linhas, streams 40–50% com fold, divisores por
  step, scroll contínuo, drill-in, log persistido pós-done, gate no card.
- **Regressão de paridade (AD-1/AD-6):** o `reduce` do motor **não muda**; testes
  dourados existentes de store/layout seguem verdes.

## Boundaries

- **Always:**
  - Consumir `tokens.css` — zero cor/spacing/tipografia hardcoded (varre o diff).
  - Histórico de stream na **camada do app** (bridge/pura), nunca no `reduce` (AD-6).
  - Honrar `prefers-reduced-motion` e WCAG AA em light+dark.
  - Manter `.icon_as_template(true)` no tray (já em `main.rs:120`) para adaptar claro/escuro.
- **Ask first:**
  - ~~Adicionar a dep de markdown~~ → **resolvido (D5):** `react-markdown` + `remark-gfm`, sem `rehype-raw`.
  - Qualquer mudança do Transport **além** da extensão aprovada em OQ1
    (`task_registered` + `description`/`deps`). Novos Events/Commands ⇒ confirmar.
  - Qualquer nova política que mude o gate além de "onde" ele é resolvido.
- **Never:**
  - Reimplementar/forkar `reduce` ou `computeDagreLayout`.
  - Mímica de terminal (índigo-hacker, mono-everywhere, ASCII decorativo) — DESIGN.md.
  - `border-left`/`border-right` colorido como stripe (DESIGN.md proíbe); usar
    hairline/tint/dot/edge-top accent.
  - Deixar o gate de aprovação "diluir" no board — segue impossível de ignorar.
  - Renderizar markdown sem sanitização (stream = não-confiável).

## Success Criteria

1. `npm run typecheck && npm run lint && npm test` verdes na raiz (inclui os novos testes).
2. **#1 — Marca:** o `.app` mostra o ícone oficial no Dock (quando janela aberta) e o
   tray template na barra de menus, legível em menubar **clara e escura** (`icon_as_template`).
   `src-tauri/icons/` e `tauri.conf.json` referenciam assets de `loopy-brand`, não placeholders.
3. **#2 — Popover:** `Glance.tsx` não contém nenhum literal de cor; usa tokens,
   `StatusDot`, tipografia do DS; "Abrir" em magenta; superfície `surface-elevated`.
4. **#3 — Colunas:** largura da coluna do Kanban aumentada (valor definido no plano)
   — cabe `T-NNN` + ~2 linhas de título sem cortar cedo.
5. **#4 — Título:** título do card renderiza em **até 2 linhas** com line-clamp e
   limite de caracteres bem maior que o atual (não `u-truncate` de 1 linha).
6. **#5 — Altura/fold:** painel de streaming ocupa **40–50%** da altura (default ~45%), com
   **fold** para uma **barra fina persistente ~28px** ("▸ Streams · N rodando"), reexpandindo
   ao default (estado só-de-sessão, OQ3/D4). Nunca some por completo.
7. **#6 — Markdown:** o conteúdo dos streams é renderizado como markdown **sanitizado**
   (blocos de código em mono; sem injeção de HTML).
8. **#9 — Cross-step:** dentro de um pane, o scroll é **contínuo entre steps**, com um
   **divisor rotulado** separando cada step; auto-stick no fim quando o usuário está no fim.
9. **#10 — Panes:** de **1 a 4** panes simultâneos; com >4 tasks rodando, mostra 4 +
   chip "**＋N rodando**" (OQ2), e as escondidas são vistas via drill-in no card.
10. **#7 — Drill-in + persistência:** clicar num card abre seu detalhe com **descrição
    completa + deps** (via Transport estendido, OQ1) **+ o log daquele card**; após a
    task concluir, **o log continua acessível dentro do card** (não é descartado como
    `task.stream`). Com `--emit-events` off, `RunLoopResult` segue byte-idêntico (AD-1).
11. **#8 — Gate no card (D6):** com a janela aberta, um `approval_requested` **auto-abre o
    drawer no card relacionado** (trocando de card se preciso), traz a janela pra frente +
    notificação, e a decisão (Aprovar magenta / Reprovar secundária, `⏎`/`⎋`) acontece
    **dentro do `CardDetail`** com edge-top accent + `shadow-gate`. O modal full-screen
    **não existe mais**. Com gate ativo, `⎋` = Reprovar (precedência sobre fechar o drawer).
    Aprovar/reprovar emite `approval_decision` — igual ao gate de C-0009.

## Assumptions

Confirmadas com o usuário antes deste spec:

1. **Drill-in = painel de detalhe / card expandido** (não expansão inline no board,
   apertado demais). Layout exato (drawer lateral vs. overlay do card) fica no DESIGN/plano.
2. **Duas superfícies, um fluxo:** o painel inferior de streams = **ao vivo/overview**
   (1–4 tasks rodando); o card expandido = **detalhe + histórico persistido** da mesma
   task. Mesmo tratamento de markdown/divisores nos dois.
3. **Markdown com renderer sanitizado** (streams do agente são não-confiáveis).
4. id da change = `C-0010-menubar-ui-polish` (slot livre após C-0009).
5. Este spec vive na pasta da change, não na raiz.

## Decisões (Open Questions resolvidas, 2026-07-08)

1. **Descrição + deps no card (#7) = estender o Transport.** Nem `deps` nem a descrição
   completa chegam hoje ao webview (`TaskState` só tem id/title/status/steps/stream;
   `task_registered` só id/title/status). Aprovado: `task_registered` passa a carregar
   `description` + `deps` e `TaskState` os guarda — **aditivo, gated, `reduce` intacto,
   `RunLoopResult` byte-idêntico** (AD-1). Fonte: o modelo de task do motor (DAG).
2. **>4 tasks rodando (#10) = 4 panes + chip "＋N rodando".** Nunca aperta os panes;
   as tasks escondidas são acessíveis via drill-in no card. (Sem scroll horizontal,
   sem grid que encolhe.)
3. **Fold/altura do streaming (#5) = só-sessão.** Vale enquanto a janela está aberta;
   reabrir volta ao default (unfold, ~45%). Sem I/O no app-config para isto.

## Decisões do /devy:refine (2026-07-08)

Resolvidas na entrevista de refino, andando a árvore de decisões a partir das OQ acima.

- **D1 — Drill-in = drawer lateral direito.** ~400px, altura cheia da janela; o board
  (Kanban/Graph) + o StreamPanel ficam à esquerda e permanecem visíveis. Não é overlay
  central nem coluna à esquerda. (Resolve a Assumption #1, que deixava drawer × overlay ao plano.)
- **D2 — Interação do drawer.** Clicar **ou Enter/Space** num card seleciona e abre o drawer;
  clicar em outro card **troca** o conteúdo; clicar no **mesmo** card **fecha** (toggle); `⎋`
  e um botão `✕` no drawer também fecham. A **seleção sobrevive** à task mudar de coluna
  (Backlog→Steps→Fim) **e** a `task_finished` — o drawer segue no card com o **log persistido** (#7).
- **D3 — Fonte da descrição (#7) = `task.body` sem a linha `Deps:`.** O motor **não tem
  campo `description`**; a descrição é o `body` (bloco indentado do `todo.md`) com a linha
  `Deps:` removida, renderizado como **markdown sanitizado**. Os `deps` (`task.deps`) viram
  **chips com status dot**, não prosa. (`Files:`, se houver, permanece no body/descrição.)
- **D4 — Fold do StreamPanel (#5) colapsa para barra fina persistente.** ~28px, mostrando
  "▸ Streams · N rodando" + chevron; um clique reexpande ao default ~45%. **Nunca some por
  completo** — sempre sinaliza que há streams. (Refina a OQ3.)
- **D5 — Dep de markdown = `react-markdown` + `remark-gfm`** (sem `rehype-raw`). Única dep
  nova (Boundaries "Ask first" satisfeito). Memoização por segmento; só o tail ao vivo re-parseia.
- **D6 — Gate resolvido DENTRO do drawer; modal full-screen REMOVIDO.** Ao chegar
  `approval_requested` com a janela aberta: o drawer **auto-abre no card relacionado**
  (trocando de card se outro estava aberto — o gate tem precedência, "impossível de ignorar"),
  a janela vem pra frente + **notificação nativa**, e o Aprovar (magenta) / Reprovar
  (secundário) vive no `CardDetail` com **edge-top accent + `shadow-gate`**. O
  `ApprovalPrompt` full-screen (backdrop `rgba(0,0,0,.7)`, índigo `#1a1a2e`) **deixa de existir**.
  Fila FIFO + contador "＋N na fila" preservados. **Precedência de `⎋`:** com gate ativo,
  `⎋` = **Reprovar** (não fecha o drawer); sem gate, `⎋` fecha o drawer. Emite
  `approval_decision` idêntico ao C-0009 (semântica do gate inalterada — só o "onde").

### Defaults de nível-plano (recomendados; ajustáveis no review)

Detalhes visuais deixados como recomendação — não bloqueiam o entendimento compartilhado:

- **#3 largura da coluna:** `min-width` de 168px → **~220px** (cabe `T-NNN` + ~2 linhas de título).
- **#4 título:** `line-clamp: 2` (substitui o `u-truncate` de 1 linha), sem limite de chars rígido.
- **#9 divisor por step:** hairline full-width com **pill de rótulo centrado** (`label` type, id do step).
- **#1 tray:** usar o par `loopy-tray-22Template{,@2x}.png` (22pt, padrão da menubar macOS) como
  `tray-template.png`, mantendo `.icon_as_template(true)` (`main.rs:120`); app icon vem do
  `AppIcon.iconset` da marca. Wiring de `tauri.conf.json` `bundle.icon` no plano.
- **Histórico cross-step (#9):** o `store-bridge` mantém um transcript append-only por task
  (nunca resetado, ≠ `task.stream`) marcado por `stepId`; `stream-history.ts` (puro, AD-6) fatia
  em segmentos. **Ambas** as superfícies (StreamPanel ao vivo **e** log do CardDetail) leem daí —
  mesmo tratamento (Assumption #2).
