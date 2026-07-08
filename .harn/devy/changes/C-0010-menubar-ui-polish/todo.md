# Backlog: C-0010 — Menubar UI polish (impecável)

> Consumido pelo motor (`- [ ]` pendente / `- [x]` concluída; id `T-\d+`; corpo indentado).
> A linha `Deps:` é canônica (`task.deps`) — mantida **isolada** (sem texto após os ids, lição D-0001).
> Invariantes em toda task: **AD-1** (o app só observa; Transport aditivo/gated por `--emit-events`;
> `RunLoopResult` byte-idêntico com/sem a flag) e **AD-6** (apresentação pura — reusa
> `reduce`/`computeDagreLayout`, nunca forka; lógica não-trivial = função pura testável).
> Toda cor/spacing/tipografia vem de `tokens.css` (zero literais). Narrativa, grafo, checkpoints
> e riscos: ver `plan.md` (mesma pasta). Requisitos: `spec.md`.

## Fase 0 — Fundações (T-001 ∥ T-002 ∥ T-003 ∥ T-004 ∥ T-005 ∥ T-006)

- [x] T-001: Marca & tray oficiais (app icon + tray template, claro/escuro)
    Substituir os placeholders de `apps/menubar/src-tauri/icons/` pelos assets de marca de
    `.harn/design/logo/loopy-brand/` (read-only): o `AppIcon.iconset`/`AppIcon.icns` viram o
    `icon.icns` + os PNGs (`32x32`, `128x128`, `128x128@2x`, `icon.png`) a partir de
    `macos/AppIcon.iconset` / `png/icon-rounded-dark`; `tray-template.png` vira o par
    `macos/tray/loopy-tray-22Template{,@2x}.png` (22pt, padrão da menubar macOS). Atualizar a
    lista `bundle.icon` em `tauri.conf.json` para os ícones novos. **Manter** `.icon_as_template(true)`
    em `main.rs:120` (NÃO reintroduzir flag alguma) para o tray adaptar claro/escuro.
    Aceite: `src-tauri/icons/` e `tauri.conf.json` referenciam assets de `loopy-brand`, não
    placeholders; o tray é um template PNG monocromático 22pt; `main.rs` inalterado salvo confirmação.
    Verificação: `npm run typecheck` && `npm run lint` && `npm test` (sem regressão de código);
    **manual/visual:** `npm run build -w apps/menubar` gera o `.app`; abrir → ícone oficial no Dock
    (janela aberta) + tray legível em menubar **clara e escura**.
    Deps: nenhuma
    Files: apps/menubar/src-tauri/icons/*, apps/menubar/src-tauri/tauri.conf.json. Scope: S.

- [x] T-002: Tokens de layout (larguras/alturas do Kanban, drawer e stream)
    Em `apps/menubar/src/ui/tokens.css`, adicionar os vars de **layout** que faltam (append no
    `:root`; espelhar no dark só se o valor mudar — normalmente não muda p/ dimensão): coluna do
    Kanban (`--kanban-col-min: 220px`), largura do drawer (`--drawer-w: 400px`), altura default do
    painel de streaming (`--stream-h: 45%`) e altura da barra dobrada (`--stream-fold-h: 28px`).
    Nomes finais a critério do implementador, desde que semânticos. **Este é o único ponto que
    escreve `tokens.css`** — todo CSS downstream só consome `var(--…)`.
    Aceite: os 4 vars existem no `:root`; `tokens.css` compila; nenhum outro arquivo desta change
    adiciona var a `tokens.css`; valores são os defaults do plano (ajustáveis no review).
    Verificação: `npm run typecheck` && `npm run lint` && `npm test`.
    Deps: nenhuma
    Files: apps/menubar/src/ui/tokens.css. Scope: XS.

- [x] T-003: Transport estendido — `task_registered` carrega `description` + `deps` (motor)
    ADITIVO e gated por `--emit-events` (AD-1). Em `src/tui/store.ts`: o evento `task_registered`
    ganha `description?: string` e `deps?: readonly string[]`; `TaskState` ganha os mesmos campos
    (opcionais); o `reduce` (switch **exaustivo**, sem `default`) os grava no `task_registered`.
    Em `src/loop/orchestrator.ts:1338`: popular `description` = `task.body` **sem a linha `Deps:`**
    (helper **puro** testável — o motor não tem campo `description`; `Files:` permanece) e `deps` =
    `task.deps`. Nada de semântica de loop muda; `line-reporter.ts` ignora os campos novos.
    Aceite: `reduce` segue exaustivo (compila sem `default`); `task_registered` grava
    `description`/`deps`; evento duplicado idempotente; o helper de strip remove só a linha `Deps:`
    e preserva `Files:`; **testes dourados de store/orchestrator seguem verdes**; teste prova
    `RunLoopResult` **byte-idêntico** com e sem `--emit-events`.
    Verificação: `npm test -- tui` && `npm test -- orchestrator` && `npm run typecheck` && `npm run lint`.
    Deps: nenhuma
    Files: src/tui/store.ts, src/loop/orchestrator.ts, testes de store/orchestrator. Scope: M. RISCO MÉDIO.

- [x] T-004: `store-bridge` acumulador cross-step + `stream-history.ts` (puro) + teste
    O `reduce` reseta `task.stream` a cada step/attempt — então o histórico vive na camada do app.
    Em `apps/menubar/src/state/store-bridge.ts`: `BridgeState` ganha um transcript **append-only**
    por task, marcado por `stepId`, **nunca resetado** (≠ `task.stream`, sobrevive a `task_finished`);
    `applyLine` acumula cada `stream_chunk` sob o `currentStepId` corrente. NOVO
    `apps/menubar/src/state/stream-history.ts` — função **pura** (AD-6)
    `segmentsFor(taskId, hist): StreamSegment[]` (`{ stepId; label; text }`) que fatia o transcript
    em segmentos por step. NOVO `stream-history.test.ts`.
    Aceite: `stream_chunk`s intercalados com `step_started` produzem os segmentos certos (tag por
    `currentStepId`); o histórico **persiste após `task_finished`** (não zera como `task.stream`);
    `applyLine` continua nunca-lança e retorna a mesma referência em no-op (AD-5).
    Verificação: `npm test -- stream-history` && `npm test -- store-bridge` && `npm run typecheck` && `npm run lint`.
    Deps: nenhuma
    Files: apps/menubar/src/state/store-bridge.ts, apps/menubar/src/state/stream-history.ts, apps/menubar/src/state/stream-history.test.ts. Scope: M.

- [x] T-005: `MarkdownStream.tsx` — render sanitizado de voz-de-máquina + teste + dep
    Adicionar `react-markdown@^10` + `remark-gfm@^4` (única dep nova, D5 aprovado; **sem `rehype-raw`**).
    NOVO `apps/menubar/src/ui/MarkdownStream.tsx`: componente que renderiza texto como markdown com
    `remarkPlugins={[remarkGfm]}`, blocos de código em `--font-mono`, **seguro por padrão** (HTML
    embutido NÃO injeta nós — react-markdown não usa `dangerouslySetInnerHTML`). Memoizar segmentos
    concluídos; só o tail em crescimento re-parseia (evita O(n²) ao vivo). Zero cor/spacing hardcoded.
    Aceite: markdown básico (headings/listas/code/tabela via gfm) renderiza; markdown com HTML
    embutido (`<script>`, `<img onerror>`) é **sanitizado** — vira texto, **não** injeta nós no DOM;
    code block usa a família mono dos tokens; honra `prefers-reduced-motion`.
    Verificação: `npm test -- MarkdownStream` && `npm run typecheck` && `npm run lint`.
    Deps: nenhuma
    Files: apps/menubar/package.json, apps/menubar/src/ui/MarkdownStream.tsx, apps/menubar/src/ui/MarkdownStream.test.tsx, apps/menubar/src/ui/index.ts. Scope: S.

- [x] T-006: Popover `Glance` reescrito off-brand → design system (#2)
    Reescrever `apps/menubar/src/popover/Glance.tsx` removendo **todos** os inline styles off-brand
    (`#007AFF`, `cyan`, `orange`, `#333`/`#999`…) → classes do DS + `tokens.css`. NOVO
    `apps/menubar/src/popover/Glance.css`. Usar `StatusDot`/`Pill` e a tipografia do DS
    (`t-body`/`t-label`), superfície `surface-elevated`, "Abrir" em **magenta** (`--accent`,
    `invoke("show_main_window")`), "Parar" secundário. Estados idle/running/gate.
    Aceite: `Glance.tsx` **não contém nenhum literal de cor** (varre o DOM/estilos); renderiza
    idle/running/gate; "Abrir" invoca `show_main_window`; usa classes/tokens; WCAG AA light+dark.
    Verificação: `npm test -- Glance` && `npm run typecheck` && `npm run lint`.
    Deps: nenhuma
    Files: apps/menubar/src/popover/Glance.tsx, apps/menubar/src/popover/Glance.css, apps/menubar/src/popover/Glance.test.tsx. Scope: S.

## Fase 1 — Kanban legível (T-007)

- [x] T-007: Colunas largas + título em 2 linhas (#3, #4)
    Em `apps/menubar/src/kanban/kanban.css`: aumentar a largura da coluna para `var(--kanban-col-min)`
    (~220px — cabe `T-NNN` + ~2 linhas de título) e trocar o `u-truncate` do título por
    `line-clamp: 2` (sem limite rígido de chars). Em `KanbanBoard.tsx:62`: substituir a classe
    `u-truncate` por uma classe de clamp de 2 linhas. Sem cor/spacing hardcoded.
    Aceite: coluna com `min-width: var(--kanban-col-min)`; título renderiza em **até 2 linhas** com
    line-clamp (não `u-truncate` de 1 linha); `T-NNN` + título cabem sem cortar cedo.
    Verificação: `npm test -- kanban` && `npm run typecheck` && `npm run lint`.
    Deps: T-002
    Files: apps/menubar/src/kanban/kanban.css, apps/menubar/src/kanban/KanbanBoard.tsx. Scope: S.

## Fase 2 — Painel de streaming (T-008 → T-009)

- [x] T-008: StreamPanel — altura ~45% + fold p/ barra fina persistente + 1–4 panes + chip (#5, #10)
    Em `apps/menubar/src/panes/StreamPanel.{tsx,css}` (+ `App.css` p/ o slot de altura): o painel
    ocupa `var(--stream-h)` (~45%) da altura; **fold** (estado só-de-sessão, OQ3/D4) colapsa para
    uma barra fina persistente `var(--stream-fold-h)` (~28px) mostrando "▸ Streams · N rodando" +
    chevron — um clique reexpande ao default; **nunca some**. Mostrar **no máximo 4 panes** de tasks
    rodando; com >4, exibir 4 + chip "**＋N rodando**" (as escondidas via drill-in). Estado de fold
    interno ao StreamPanel (não içar p/ `App.tsx`). Zero cor/spacing hardcoded.
    Aceite: painel a ~45%; fold → barra ~28px "▸ Streams · N rodando", reexpande ao default; ≤4 panes;
    >4 tasks → 4 + chip "＋N rodando"; 1 task → 1 pane preenchendo; honra `prefers-reduced-motion`.
    Verificação: `npm test -- StreamPanel` && `npm run typecheck` && `npm run lint`.
    Deps: T-002
    Files: apps/menubar/src/panes/StreamPanel.tsx, apps/menubar/src/panes/StreamPanel.css, apps/menubar/src/App.css. Scope: M.

- [x] T-009: StreamPanel — markdown + scroll contínuo cross-step + divisor rotulado (#6, #9)
    O pane passa a ler o transcript append-only do `store-bridge` (T-004) via `segmentsFor` — não
    mais `task.stream` (que reseta por step). `App.tsx` passa o histórico como prop ao StreamPanel.
    Render de cada segmento com `MarkdownStream` (T-005). Scroll **contínuo entre steps** com um
    **divisor rotulado** (hairline full-width + pill de rótulo centrado: `label` type + id do step)
    separando cada step; **auto-stick** no fim quando o usuário já está no fim.
    Aceite: dentro de um pane o scroll é contínuo cross-step com divisor por step; markdown
    sanitizado (T-005); auto-stick só quando ancorado no fim; segmentos concluídos memoizados.
    Verificação: `npm test -- StreamPanel` && `npm test -- stream-history` && `npm run typecheck` && `npm run lint`.
    Deps: T-004, T-005, T-008
    Files: apps/menubar/src/panes/StreamPanel.tsx, apps/menubar/src/panes/StreamPanel.css, apps/menubar/src/App.tsx. Scope: M.

## Fase 3 — Drill-in por card (T-010 → T-011 → T-012)

- [x] T-010: Card clicável/focável + drawer shell + seleção persistente (#7 estrutura, D1/D2)
    `KanbanBoard.tsx`: cada card vira clicável **e** focável (`tabIndex`, Enter/Space) → seleciona e
    abre o drawer; clicar em outro card **troca**; clicar no **mesmo** **fecha** (toggle); `⎋` e um
    botão `✕` fecham. A seleção (por `taskId`) é **içada** para `App.tsx` (compartilhada
    KanbanBoard↔CardDetail) e **sobrevive** a mudar de coluna (Backlog→Steps→Fim) **e** a
    `task_finished`. NOVO `apps/menubar/src/kanban/CardDetail.{tsx,css}` como **shell** do drawer
    lateral DIREITO (`var(--drawer-w)` ~400px, altura cheia; board+stream à esquerda seguem visíveis)
    — só o esqueleto (header id/título + botão ✕ + área de conteúdo vazia). Estado selecionado do
    card no `kanban.css`. `App.css` ganha o split board+stream | drawer. Zero cor/spacing hardcoded.
    Aceite: clicar OU Enter/Space num card seleciona e abre o drawer; trocar de card troca o conteúdo;
    mesmo card fecha (toggle); `✕`/`⎋` fecham; a seleção sobrevive à task mudar de coluna e a
    `task_finished`; drawer à direita ~400px sem cobrir o board.
    Verificação: `npm test -- KanbanBoard` && `npm test -- CardDetail` && `npm run typecheck` && `npm run lint`.
    Deps: T-007, T-009
    Files: apps/menubar/src/kanban/KanbanBoard.tsx, apps/menubar/src/kanban/kanban.css, apps/menubar/src/kanban/CardDetail.tsx, apps/menubar/src/kanban/CardDetail.css, apps/menubar/src/App.tsx, apps/menubar/src/App.css. Scope: M.

- [ ] T-011: CardDetail — descrição (markdown) + deps chips + log persistido (#7 conteúdo)
    Preencher o `CardDetail`: **descrição** = `TaskState.description` (T-003) renderizada como
    markdown sanitizado (`MarkdownStream`, T-005); **deps** = `TaskState.deps` como **chips com
    status dot** (não prosa — resolver o status de cada dep via `store.tasks`); **log** = o transcript
    persistido daquela task (T-004 `segmentsFor` + `MarkdownStream`), com o **mesmo** tratamento de
    divisor por step do StreamPanel. O log **continua acessível após a task concluir** (#7).
    Aceite: mostra descrição + deps chips (com status) + log; um `TaskState` com `description`/`deps`
    popula desc/chips; o log persiste após `task_finished`; com `--emit-events` off a descrição fica
    vazia mas o card não quebra; zero cor/spacing hardcoded; WCAG AA light+dark.
    Verificação: `npm test -- CardDetail` && `npm run typecheck` && `npm run lint`.
    Deps: T-003, T-004, T-005, T-010
    Files: apps/menubar/src/kanban/CardDetail.tsx, apps/menubar/src/kanban/CardDetail.css, apps/menubar/src/App.tsx. Scope: M.

- [ ] T-012: Gate no card — remove modal full-screen; resolve no CardDetail (#8, D6)
    Remover o `ApprovalPrompt` full-screen (`inset:0`, backdrop `rgba(0,0,0,.7)`, índigo `#1a1a2e`) —
    **deixa de existir**. Extrair os helpers puros (`headApproval`/`escalationCost`/
    `formatApprovalPayload`) e embutir o gate **dentro** do `CardDetail`: Aprovar (magenta `--accent`)
    / Reprovar (secundário), com **edge-top accent + `--shadow-gate`**. Ao chegar `approval_requested`
    com a janela aberta: **auto-abrir o drawer no card relacionado** (trocando de card se preciso — o
    gate tem precedência), trazer a janela pra frente + **notificação nativa** (`state/notify.ts`).
    **Precedência de `⎋`:** com gate ativo, `⎋` = **Reprovar** (não fecha o drawer); sem gate, `⎋`
    fecha. `⏎` = Aprovar. FIFO + contador "＋N na fila" preservados. Emite `approval_decision`
    idêntico ao C-0009 (semântica do gate inalterada — só o "onde"). `App.tsx` deixa de renderizar o
    modal.
    Aceite: modal full-screen removido; um `approval_requested` auto-abre o drawer no card certo +
    janela pra frente + notifica; Aprovar/Reprovar vivem no CardDetail com edge-top accent +
    `--shadow-gate`; `⏎`=Aprovar, `⎋`=Reprovar (precedência sobre fechar) com gate ativo; FIFO/"＋N na
    fila" preservados; emite `approval_decision` byte-compatível com C-0009; zero cor hardcoded.
    Verificação: `npm test -- approval` && `npm test -- CardDetail` && `npm test -- App` && `npm run typecheck` && `npm run lint`.
    Deps: T-011
    Files: apps/menubar/src/panes/ApprovalPrompt.tsx, apps/menubar/src/kanban/CardDetail.tsx, apps/menubar/src/kanban/CardDetail.css, apps/menubar/src/App.tsx. Scope: M.
