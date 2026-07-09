# Backlog: C-0011 — Agent context surfacing + menubar polish

> Consumido pelo motor (`- [ ]` pendente / `- [x]` concluída; id `T-\d+`; corpo indentado).
> A linha `Deps:` é canônica (`task.deps`) — mantida **isolada** (sem texto após os ids, lição D-0001).
> Invariantes em toda task: **AD-1** (o app só observa; Transport aditivo/gated por `--emit-events`;
> `RunLoopResult` byte-idêntico com/sem a flag) e **AD-6** (apresentação pura — reusa
> `reduce`/`resolveAgentBinding`/`computeDagreLayout`, nunca forka; lógica não-trivial = função pura testável).
> Toda cor/spacing/tipografia vem de `tokens.css` (zero literais). Telemetria (agente/uso) é **best-effort**:
> ausência degrada para vazio/`n/d`, nunca quebra a raia. Narrativa, grafo, checkpoints e riscos:
> ver `plan.md` (mesma pasta). Requisitos: `spec.md`.

## Fase 0 — Quick wins & fundações puras (T-001 ∥ T-002 ∥ T-003 ∥ T-004)

- [x] T-001: Tray sem `●` (#9)
    Em `apps/menubar/src/main.tsx:120-122` o título do tray hoje é `count > 0 ? "● ⚠" : "●"`.
    Trocar por: ocioso/rodando = **título vazio** (`""`) → só o ícone template (C-0010 T-001);
    com aprovação pendente = **apenas** o indicador de gate (`"⚠"`, opcionalmente `⚠ N` com a
    contagem) — **nunca** `●`. Em `src-tauri/src/main.rs:88-92` (`update_tray_title` →
    `tray.set_title(Some(&title))`): confirmar que título vazio limpa o texto (deixa só o ícone);
    **só** trocar para `set_title(None)` se `Some("")` não limpar. Não reintroduzir flag de ícone.
    Aceite: o título do tray **nunca** contém `●`; ocioso/rodando = só o ícone; um gate pendente
    mostra só `⚠` (+ contagem opcional); nenhuma outra lógica do tray muda.
    Verificação: `npm run typecheck` && `npm run lint` && `npm test`; **manual/visual:**
    `npm run build -w apps/menubar` → abrir → menubar ociosa sem `●`, gate mostra `⚠`.
    Deps: nenhuma
    Files: apps/menubar/src/main.tsx, apps/menubar/src-tauri/src/main.rs. Scope: S.

- [x] T-002: `sentence-split.ts` (puro) + aplicação em MarkdownStream (#7)
    NOVO `apps/menubar/src/ui/sentence-split.ts` — função **pura** `splitSentences(prose): string`
    (AD-6) que quebra prosa em um período por linha, **conservadora** (refine #5): quebra só em
    `. ` seguido de Maiúscula/início de sentença, com **whitelist negativa** — NÃO quebra em
    abreviações (`e.g.`, `vs.`, `etc.`), versões (`v0.26`), nomes de arquivo (`session.ts`),
    decimais (`20.5`), reticências (`…`/`...`), URLs (`http://…`), `Node.js`. Sem quebra em `?`/`!`
    (menos falso-positivo). Incerto → **mantém junto** (fail-safe). NOVO `sentence-split.test.ts`.
    `apps/menubar/src/ui/MarkdownStream.tsx`: aplicar `splitSentences` **só a nós de prosa**
    (via override de componentes do react-markdown para texto/parágrafo) — **nunca** dentro de
    code block / inline code / URLs. Import direto de `./sentence-split` (NÃO adicionar a `ui/index.ts`).
    Aceite: quebra períodos reais; **não** quebra `Node.js`/`e.g.`/`v0.26`/`session.ts`/`20.5`/
    `http://…`/`...`; blocos e inline code passam **intactos**; texto de Agente segue **sanitizado**
    (mantém react-markdown sem `rehype-raw`, C-0010).
    Verificação: `npm test -- sentence-split` && `npm test -- MarkdownStream` && `npm run typecheck` && `npm run lint`.
    Deps: nenhuma
    Files: apps/menubar/src/ui/sentence-split.ts, apps/menubar/src/ui/sentence-split.test.ts, apps/menubar/src/ui/MarkdownStream.tsx. Scope: S.

- [x] T-003: `context-window.ts` — `formatUsage` (puro) (#5)
    NOVO `apps/menubar/src/ui/context-window.ts` — `formatUsage(used?, size?, model?): string`
    **puro** (AD-6): `win = size && size > 0 ? size : (model ? WINDOW_FALLBACK[model] : undefined)`;
    se `used == null || win == null` → `""` (best-effort, sem parênteses); senão
    `pct = round(used/win*100)` e retorna `"(<usados abreviado> / <pct>%)"` (ex.: `"(287k / 29%)"`).
    Helper `abbrev` (287000 → `"287k"`). `size` do ACP é **primário**; `WINDOW_FALLBACK`
    (`claude-opus-4-8: 1_000_000`, `claude-sonnet-5: 200_000`, `claude-haiku-4-5: 200_000`) é
    **só fallback** quando `size` ausente — cobre **só** Anthropic (decisão 2026-07-09):
    Agente não-Anthropic sem `size` → `""` (raia sem bloco de uso); **sem** caminho
    absoluto-sem-% e **sem** popular gpt-5/codex. NOVO `context-window.test.ts`. Import
    direto (NÃO adicionar a `ui/index.ts`).
    Aceite: Opus 1M com 200k → `"(200k / 20%)"`; `size` presente domina o `model`; modelo
    desconhecido **sem** `size` ou `used` ausente → `""` (sem parênteses); nunca lança.
    Verificação: `npm test -- context-window` && `npm run typecheck` && `npm run lint`.
    Deps: nenhuma
    Files: apps/menubar/src/ui/context-window.ts, apps/menubar/src/ui/context-window.test.ts. Scope: S.

- [x] T-004: Tokens de layout — único escritor de `tokens.css` (#1 + suporte a #3/#6)
    Em `apps/menubar/src/ui/tokens.css` (o **único** ponto desta change que escreve `tokens.css` —
    espelho de C-0010 T-002): (a) `--kanban-col-min: 220px → 286px` (#1, 220×1.30); (b) adicionar
    `--logo-h` (altura do lockup no header, ~20–24px) que #6 consome; (c) manter `--stream-h: 45%`
    como **default/fallback** (o #3 sobrepõe em runtime via inline-style; token permanece a base).
    Espelhar no dark **só** se o valor mudar (dimensões não mudam). Nenhum outro arquivo desta
    change adiciona var a `tokens.css`.
    Aceite: `--kanban-col-min` = **286px**; `--logo-h` existe no `:root`; `--stream-h` permanece
    (default); `tokens.css` compila; colunas visivelmente mais largas; scroll horizontal do Kanban
    segue funcional.
    Verificação: `npm run typecheck` && `npm run lint` && `npm test`.
    Deps: nenhuma
    Files: apps/menubar/src/ui/tokens.css. Scope: XS.

## Fase 1 — Motor (T-005 ∥ T-006 → T-007)

- [x] T-005: `clear()` → reopen ACP-nativo (`session/new`), fix sempre-ativo (#8)
    **RISCO ALTO** — cirurgia no ciclo de vida da Sessão. Hoje `clear()` (`src/acp/session.ts:256-260`)
    roda `/clear` como turno (`CLEAR_COMMAND` `:55`), que o Codex rejeita ("Unknown command /clear").
    Trocar por `reopen()` encapsulado no `SessionWrapper` (`session.ts:137-351`):
    (1) `dispose()` do `active` atual → `deps.ctx.buildSession(this.cwd).start()` → **swap de
    `this.active`** preservando a **referência do wrapper** (`sessionId` é getter de `active`
    `:165-167`); (2) **re-parsear** `modelConfigId`/`effortConfigId`/`availableModeIds` do novo
    `newSessionResponse`; (3) **re-aplicar** mode/model/effort **guardados** — o wrapper passa a
    **armazenar** os valores aplicados em `setMode/setModel/setEffort` (`:190-222`), pois
    `session/new` nasce no default e `agent.ts:208-226` seta config **1× fora** do loop de tentativa
    (o `mode: plan` do audit seria perdido!); (4) **`costCarry`** cumulativo — `readCost()`
    (`:305-309`) passa a somar `costCarry + read(novo sessionId)` (o `CostBuffer` é keyed por
    `sessionId`, `client.ts:245-263`, e zeraria); (5) callback **`onReopen(oldSessionId, newSessionId)`**
    plumbado pela criação da sessão. `clear()` passa a chamar `reopen()`. `CLEAR_COMMAND` aposentado.
    Em `src/acp/pool.ts`: confirmar que a chave `${agent}::${cwd}` (`:56-59`) e as refs em
    `open`/`opening` seguem válidas (wrapper preservado) — nenhum re-keying. Em `src/index.ts`:
    fiar `onReopen` no `sessionProvider` (`:452-456`) para re-registrar `sessionToTask`
    (`:367,454`): `delete(old)` + `set(new, {taskId, agent})`. `agent.ts` fica estrutural igual.
    Atualizar `tests/acp/session.test.ts` (o contrato antigo "clear mantém sessionId" **inverte**:
    `:126-127,199,290-291,311-340`) e `tests/acp/pool.test.ts` (identidade preservada).
    Aceite: `clear()` faz dispose+`session/new` (o `sessionId` **muda**); mode/model/effort são
    **re-aplicados** (o `mode: plan` do audit sobrevive ao reopen); **nenhum** `/clear` textual é
    enviado como prompt; `sessionToTask` é re-registrado no novo `sessionId` (nunca órfão); custo é
    **cumulativo** atravessando reopens (`costCarry`); a referência do wrapper é preservada (caches do
    pool/orquestrador válidos); comportamento uniforme para Claude **e** Codex.
    Verificação: `npm test -- acp/session` && `npm test -- acp/pool` && `npm test -- e2e` && `npm run typecheck` && `npm run lint`.
    Deps: nenhuma
    Files: src/acp/session.ts, src/acp/pool.ts, src/index.ts, tests/acp/session.test.ts, tests/acp/pool.test.ts. Scope: L. RISCO ALTO.

- [x] T-006: `step_started` carrega Agente + model (motor resolve o label) (#4)
    Extensão ADITIVA. Em `src/types.ts:27-32`: `AgentDef.display_name?: string`. Em
    `src/config/schema.ts:66-73`: `agentDefSchema` += `display_name: nonEmptyString.optional()`
    (mantém `.strict()`). Em `src/tui/store.ts`: o evento `step_started` (`:157-162`) ganha
    `agentName?: string` + `model?: string`; `StepState` (`:60-72`) ganha os mesmos; o `reduce`
    (switch **exaustivo**, `:344-357`) os grava. Em `src/loop/orchestrator.ts`: threadar o
    `binding` (resolvido em `:988`/`:1100` via `resolveAgentBinding` `:171-185`) até o emit de
    `step_started` (`:885-890`, hoje sem `binding` em escopo) — **só em Steps de Agente**
    (`step.type === "agent"`); o motor resolve o label com um helper **puro** testável
    `resolveAgentLabel(chave, agentDef) = display_name ?? capitalize(chave)` e emite
    `agentName`(label)+`model`. Steps não-Agente → sem `agentName`/`model`. `transport.ts` **não**
    muda (spread genérico serializa os campos novos). A view Ink e o `line-reporter` **ignoram** os
    campos novos (nenhuma mudança de saída).
    Aceite: `step_started` carrega `agentName`(label resolvido)+`model` corretos (claude default →
    `display_name` ou `capitalize`; `agent: codex` → seu label) **só** em Steps de Agente;
    `reduce` segue exaustivo (compila sem `default`); saída da TUI/linha **inalterada**;
    `RunLoopResult` **byte-idêntico** com/sem `--emit-events`; testes dourados de store/orchestrator verdes.
    Verificação: `npm test -- tui` && `npm test -- run-loop` && `npm run typecheck` && `npm run lint`.
    Deps: nenhuma
    Files: src/types.ts, src/config/schema.ts, src/tui/store.ts, src/loop/orchestrator.ts, tests/tui/store.test.ts, tests/loop/run-loop.test.ts. Scope: M. RISCO MÉDIO.

- [x] T-007: `usage_sample` ao vivo — `used`/`size` do ACP por Step (#5)
    Extensão ADITIVA. Em `src/acp/client.ts`: o handler de `usage_update` (`:226-232` extrai só
    `cost`; alimenta `costBuffer` em `:587-588`) passa a **também** extrair `used`+`size`
    (obrigatórios no SDK, `types.gen.d.ts:3898/3902`) e expô-los ao seam `onUpdate` (`:584`) — o
    consumidor recebe a `SessionNotification` inteira, então a extração pode viver no `index.ts`.
    Em `src/tui/store.ts`: novo evento `usage_sample {taskId, stepId, used, size}`; `StepState`
    ganha `used?`+`size?`; `reduce` (exaustivo) grava a **última** amostra no Step (ocupação
    atual — **não** pico, **não** soma; decisão 2026-07-09). Em
    `src/index.ts`: no callback `onUpdate` (`:409-415`), quando `sessionUpdate === "usage_update"`,
    resolver `taskId` via `infoFor(sessionId)` (`:372-376`) e `stepId` via um `taskId→currentStepId`
    derivado do **próprio stream de eventos** (observando `step_started`/`step_finished`), e
    dispatchar `usage_sample`. **Não** usa `drainUsage` (soma turnos → superestima). Em
    `src/types.ts`: tipo da amostra de uso por-Step se necessário. O `line-reporter` **ignora**
    `usage_sample` (sem mudança de stdout).
    Aceite: `client.ts` extrai `used`+`size` de `usage_update`; `index.ts` carimba `taskId`+`stepId`
    (nunca fica sem `stepId` durante um Step de Agente ativo); `usage_sample` grava `used`/`size` no
    Step certo; amostra é **ao vivo** (atualiza durante o Step); Agente que não reporta `usage_update`
    → sem amostra (best-effort); `RunLoopResult` **byte-idêntico** com/sem `--emit-events`; saída
    TUI/linha inalterada.
    Verificação: `npm test -- acp/client` && `npm test -- tui` && `npm test -- run-loop` && `npm run typecheck` && `npm run lint`.
    Deps: T-005, T-006
    Files: src/acp/client.ts, src/index.ts, src/tui/store.ts, src/types.ts, tests/acp/client.test.ts, tests/tui/store.test.ts. Scope: M. RISCO MÉDIO.

## Fase 2 — Integração no app (T-008 ∥ T-009 ∥ T-010 → T-011 → T-012)

- [x] T-008: `store-bridge` + `stream-history` propagam Agente/model/uso por Step (#4/#5)
    Em `apps/menubar/src/state/store-bridge.ts`: acumular telemetria por **(taskId, stepId)** —
    `agentName`/`model` chegam via `step_started` (já em `StoreState.tasks[].steps[]` após o
    reduce de T-006) e `used`/`size` via `usage_sample` (após T-007). Derivar isso do `nextStore`
    (o Step já carrega os campos) ou de um mapa `stepMeta` paralelo. Em
    `apps/menubar/src/state/stream-history.ts`: `StreamSegment` (`:22-26`) ganha `agent?`,`model?`,
    `usedTokens?`,`size?`; `TranscriptEntry` carrega o necessário; `segmentsFor` (`:39-63`)
    **propaga** os campos por segmento (do Step correto). Atualizar
    `apps/menubar/src/state/stream-history.test.ts`. `applyLine` segue nunca-lança e no-op retorna
    a mesma referência (AD-5). Ausência de dado → campos `undefined` (best-effort).
    Aceite: um stream com `step_started`(agent/model) + `usage_sample`(used/size) intercalado produz
    segmentos com `agent`/`model`/`usedTokens`/`size` do **Step correto**; `size` primário
    disponível para o cálculo; segmento sem telemetria → campos ausentes sem quebrar; transcript
    persiste após `task_finished` (≠ `task.stream`).
    Verificação: `npm test -- stream-history` && `npm test -- store-bridge` && `npm run typecheck` && `npm run lint`.
    Deps: T-007
    Files: apps/menubar/src/state/store-bridge.ts, apps/menubar/src/state/stream-history.ts, apps/menubar/src/state/stream-history.test.ts. Scope: M.

- [x] T-009: Kanban — título em 3 linhas com altura estável (#2)
    Em `apps/menubar/src/kanban/kanban.css`: `.kanban-card-title` (`:92-100`) troca
    `-webkit-line-clamp: 2 → 3`; garantir que o card **acomoda 3 linhas sem "pular" a altura** ao
    truncar (min-height no `.kanban-card` e/ou `align-items: flex-start` para título multi-linha —
    hoje `:57-68` usa `align-items: center`). Sem cor/spacing hardcoded (só `var(--…)`). A largura
    (#1) já vem de `--kanban-col-min` (T-004).
    Aceite: `.kanban-card-title` usa `-webkit-line-clamp: 3`; o card não muda de altura ao truncar
    (min-height estável); `T-NNN` + título em até 3 linhas cabem sem cortar cedo.
    Verificação: `npm test -- kanban` && `npm run typecheck` && `npm run lint`.
    Deps: T-004
    Files: apps/menubar/src/kanban/kanban.css. Scope: XS.

- [x] T-010: Logo colorido no header (#6)
    Copiar (read-only) de `.harn/design/logo/loopy-brand/svg/lockup/` para NOVO
    `apps/menubar/src/assets/`: `loopy-lockup-horizontal-gradient.svg` (primário) + variantes
    `-black`/`-white` (para swap por tema). Em `apps/menubar/src/App.tsx:73-74`: trocar
    `<span className="app-header__wordmark t-title">Loopy</span>` por
    `<img className="app-header__logo" src={…} alt="Loopy" />` (Vite importa svg como URL). Em
    `apps/menubar/src/App.css`: `.app-header__logo` com `height: var(--logo-h)` (T-004), `width: auto`;
    se o wordmark gradiente não contrastar num tema, swap para `-black`/`-white` via
    `prefers-color-scheme`/`data-theme` (duas `<img>` alternadas por CSS, ou máscara). WCAG AA
    light **e** dark. Sem cor hardcoded.
    Aceite: o header renderiza o lockup oficial (gradiente, viewBox ~466×150) no lugar do wordmark
    textual, com `alt="Loopy"`, altura fixa (`--logo-h`), legível em light **e** dark; nenhum literal
    de cor/spacing.
    Verificação: `npm test -- App` && `npm run typecheck` && `npm run lint`; **manual/visual:** logo
    colorido e legível em menubar clara e escura.
    Deps: T-004
    Files: apps/menubar/src/assets/loopy-lockup-horizontal-gradient.svg, apps/menubar/src/assets/loopy-lockup-horizontal-black.svg, apps/menubar/src/assets/loopy-lockup-horizontal-white.svg, apps/menubar/src/App.tsx, apps/menubar/src/App.css. Scope: S.

- [x] T-011: Divisor arrastável Kanban↔stream — altura persistida (#3)
    Em `apps/menubar/src/App.tsx` (entre `.app-main` e `<StreamPanel>`, `:109-117`) inserir um
    **divisor arrastável**. A altura do painel de streaming vira **fração de runtime** (refine #6):
    default `0.45`, min `0.20`, max `0.70`, persistida em **localStorage**, aplicada via inline-style
    (`--stream-h`) — **não** reescreve `tokens.css`; **double-click reseta** ao default. Estado
    **separado** do **fold** de C-0010 (que segue funcionando). Helpers puros (clamp, fração→altura)
    testáveis (AD-6). Em `apps/menubar/src/App.css` + `apps/menubar/src/panes/StreamPanel.{tsx,css}`:
    handle de resize, cursor, min/max, `prefers-reduced-motion`. Sem cor/spacing hardcoded.
    Aceite: existe divisor arrastável; arrastar aumenta/diminui a altura (min 0.20 / max 0.70); a
    altura **persiste** entre sessões (localStorage); **double-click reseta** ao default (0.45); o
    fold de C-0010 segue como estado separado; fração (não px) mantém responsividade ao redimensionar
    a janela.
    Verificação: `npm test -- StreamPanel` && `npm test -- App` && `npm run typecheck` && `npm run lint`.
    Deps: T-004, T-010
    Files: apps/menubar/src/App.tsx, apps/menubar/src/App.css, apps/menubar/src/panes/StreamPanel.tsx, apps/menubar/src/panes/StreamPanel.css. Scope: M.

- [ ] T-012: Raia carrega Agente + uso da context window (#4/#5)
    Em `apps/menubar/src/ui/StepDivider.{tsx,css}` (hoje só `label`, `:9-19`): props `agent?` e
    `usage?` (string **pré-formatada**) → renderiza `LABEL → <Agente> (<uso>)` (ex.:
    `SIMPLIFY → Codex (287k / 29%)`); sem `usage` em Steps não-Agente; sem `agent` → só o label.
    Em `apps/menubar/src/panes/StreamPanel.tsx:120` e `apps/menubar/src/kanban/CardDetail.tsx:178`
    (ambos `<StepDivider label={seg.label} />`): passar `agent={seg.agent}` e
    `usage={formatUsage(seg.usedTokens, seg.size, seg.model)}` (import direto de
    `../ui/context-window`, T-003). Aparece em **StreamPanel e CardDetail**. Degrada graciosamente:
    ausência de agente/uso → só o label; nunca quebra a raia. Sem cor/spacing hardcoded.
    Aceite: cada raia de Step **de Agente** mostra `LABEL → <Agente>` (via `display_name`/label do
    motor) e, quando há amostra, `(<usados> / <pct>%)`; Step não-Agente → **só** o label; Agente sem
    uso → `LABEL → Agente` (sem parênteses); aparece em StreamPanel **e** CardDetail; WCAG AA
    light+dark; zero literal de cor.
    Verificação: `npm test -- StepDivider` && `npm test -- StreamPanel` && `npm test -- CardDetail` && `npm run typecheck` && `npm run lint`.
    Deps: T-003, T-008, T-011
    Files: apps/menubar/src/ui/StepDivider.tsx, apps/menubar/src/ui/StepDivider.css, apps/menubar/src/panes/StreamPanel.tsx, apps/menubar/src/kanban/CardDetail.tsx. Scope: M.
