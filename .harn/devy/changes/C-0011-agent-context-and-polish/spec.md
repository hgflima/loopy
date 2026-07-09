# Spec: C-0011 — Agent context surfacing + menubar polish

> Follow-up de C-0010 (Menubar UI polish). C-0010 elevou a app `apps/menubar`
> ao padrão "impecável" (marca, popover, Kanban legível, streams com markdown,
> drill-in por card, gate no card). Esta change **não adiciona capacidade de
> motor de loop** (AD-1): ela (a) faz o motor **encaminhar metadado que já
> possui** — qual Agente roda cada Step e quanto da janela de contexto foi usada —
> e (b) refina a UX da app até ser cognitivamente mais eficiente. Uma única
> correção **é** de motor: o reset de contexto passa a ser ACP-nativo para
> funcionar com o Codex (que não entende `/clear` textual).

## Objective

Tornar a superfície de acompanhamento **auto-explicativa por Step**: ao olhar a
raia que separa os Steps no painel de streaming, o dev sabe **qual Agente** está
executando aquele Step e **quão cheia está a janela de contexto** dele — sem sair
da tela. Em paralelo, tornar o painel de streaming **ajustável** (arrastar altura),
os cards **mais legíveis** (colunas 30% mais largas, 3 linhas de título), o texto
dos Agentes **mais escaneável** (um período por linha), e a identidade **oficial**
(logo colorido no header). E consertar dois defeitos concretos: o Codex rejeitando
`/clear` e o `●` textual poluindo o ícone da menubar.

**Usuário:** o mesmo dev de C-0009/C-0010 — roda o `loopy` sobre um repo-alvo e
acompanha o Run por uma janela nativa. Agora quer, de relance, saber **quem** faz
cada Step e **quanto de contexto resta**, e quer moldar o layout ao seu gosto.

**As 9 melhorias, agrupadas em 4 frentes:**

- **A · Legibilidade do Kanban** (#1 largura +30%, #2 título 3 linhas).
- **B · Ergonomia do painel de streaming** (#3 resize por drag, #7 períodos curtos).
- **C · Telemetria por Step na raia** (#4 Agente na raia, #5 uso da context window na raia).
- **D · Identidade & correções** (#6 logo colorido, #8 clear do Codex ACP-nativo, #9 tray sem `●`).

**Sucesso:** abrir o `.app` → header com **logo colorido** → colunas do Kanban
30% mais largas com títulos em **3 linhas** → arrastar o divisor sobe/desce o
painel de streaming (persistido) → cada raia mostra `SIMPLIFY → Codex (287k / 29%)`
→ prosa dos Agentes com **um período por linha** → nenhum `●` na menubar → um Step
`agent: codex` roda **sem erro de `/clear`** (contexto resetado via `session/new`).

## Tech Stack

Herdado de C-0009/C-0010 (sem novas dependências):

- **Webview:** React 18 + Vite + `@xyflow/react` + `@tauri-apps/api` v2 +
  `react-markdown`/`remark-gfm` (já adotados em C-0010).
- **Nativa:** Tauri v2 (Rust), plugins `shell`/`positioner`/`dialog`/`notification`.
- **Motor (ACP):** `@agentclientprotocol/sdk`. Esta change usa **`session/new`**
  (já suportado pelo `LoopySession`/`AgentProcessPool`) para reset de contexto —
  nenhuma dep nova.
- **Reuso do motor (AD-6, sem fork):** apresentação pura sobre `StoreState` de
  `loopy/tui/store`. Extensão **aditiva e gated por `--emit-events`** do Transport:
  eventos passam a carregar `agentName`, `model` e amostra de `usedTokens`. O `reduce`
  segue exaustivo e `RunLoopResult` continua **byte-idêntico** com/sem a flag (AD-1).

## Commands

Inalterados de C-0009/C-0010 (raiz + workspace `apps/menubar`):

```
# Qualidade (raiz — cobre motor + webview)
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

Arquivos tocados (existentes salvo `NOVO`). Anotados com o item (#) que motiva.

```
src/                                    → MOTOR (extensão ADITIVA + fix de clear)
  loop/orchestrator.ts                  → #4/#5: threa `binding.agentName`+`binding.model` no emit de
                                          `step_started` (hoje `orchestrator.ts:880-890` não os carrega)
  acp/session.ts                        → #8: `clear()` → `reopen()` encapsulado (dispose+`session/new`,
                                          re-parseia configIds, re-aplica mode/model/effort guardados,
                                          `costCarry` cumulativo, callback `onReopen`); CLEAR_COMMAND `:55` aposentado.
                                          NOTA: #5 NÃO usa `drainUsage` (soma turnos → superestima); usa `usage_update`
  acp/pool.ts                           → #8: `reopen()` preserva a key `${agent}::${cwd}` e a identidade do wrapper
                                          (mesma referência em `open`/`sessionsByAgent`)
  acp/client.ts                         → #5: `usageUpdate*` extrai `used`+`size` (não só cost) `:226`;
                                          emite `usage_sample` ao vivo por `usage_update` (via `onUpdate`/seam)
  index.ts                              → #8: `onReopen` re-registra `sessionToTask` no novo sessionId
                                          (`:367,452-454`); #5: deriva `taskId→currentStepId` do stream de eventos p/
                                          carimbar `stepId` no `usage_sample`; #4: emite `agentName`/`model` (só Steps de Agente)
  tui/store.ts                          → #4/#5: `step_started` ganha `agentName`+`model`; novo evento
                                          `usage_sample {taskId,stepId,used,size}`; `TaskState`/step guardam agent+model+used+size
  tui/transport.ts                      → #4/#5: serializar os campos novos (gated `--emit-events`, aditivo)
  config/schema.ts                      → #4: `agents.<name>.display_name?: string` (opcional)
  types.ts                              → #4: `AgentDef.display_name?`; #5: tipo de amostra de uso por-step

apps/menubar/
  src/assets/loopy-lockup-*.svg         → #6 NOVO: lockup oficial, copiado de
                                          `.harn/design/logo/loopy-brand/svg/lockup/` (gradient + black/white p/ tema)
  src/App.tsx / App.css                 → #6: header troca `<span>Loopy</span>` por `<img>` (alt="Loopy");
                                          #3: insere o divisor arrastável entre `.app-main` e `<StreamPanel>` (`App.tsx:107-118`)
  src/ui/tokens.css                     → #1: `--kanban-col-min` 220→286px; #3: `--stream-h` vira var de runtime
  src/kanban/kanban.css                 → #2: `-webkit-line-clamp` 2→3 em `.kanban-card-title` (+min-height do card)
  src/panes/StreamPanel.tsx / .css      → #3: handle de resize (drag), altura em estado + persistência, min/max,
                                          double-click reseta; convive com o fold (C-0010) como estado à parte
  src/ui/StepDivider.tsx / .css         → #4/#5: renderiza `LABEL → <Agente> (<usados> / <pct>%)`
  src/state/stream-history.ts / .test   → #4/#5: `StreamSegment` ganha `agent?`,`model?`,`usedTokens?`; `segmentsFor` os propaga
  src/state/store-bridge.ts             → #4/#5: acumula agent/model/used por (taskId, stepId)
  src/ui/context-window.ts / .test      → #5 NOVO: `formatUsage(used, size?, model?)` → "(287k / 29%)";
                                          `size` do ACP é primário; tabela model→janela é só FALLBACK
  src/ui/sentence-split.ts / .test      → #7 NOVO: função pura que quebra prosa em períodos (whitelist anti-falso-positivo)
  src/ui/MarkdownStream.tsx             → #7: aplica `sentence-split` só a nós de prosa (não code block/inline code)
  src/main.tsx                          → #9: remove o `●` do título do tray (`:120-122`)
  src-tauri/src/main.rs                 → #9: (só se necessário) confirmar `set_title` vazio quando ocioso

.harn/devy/changes/C-0011-agent-context-and-polish/  → este spec, plan, todo
```

## Code Style

TypeScript ESM; componentes puros de `StoreState` + estado de UI local; **toda cor,
raio, spacing e tipografia vêm de `tokens.css`** (nunca literais — AD do C-0010).
Lógica nova = **função pura testável** (AD-6), separada do render. Exemplos-alvo:

```ts
// context-window.ts — formatação da raia (#5). Puro, testável.
// FONTE AUTORITATIVA (decisão do refine): `usage_update.{used,size}` do ACP —
// per-sessão, model-agnóstico, já dá a janela real (size) de QUALQUER agente
// (Anthropic/Codex/gpt-5). A tabela abaixo é apenas FALLBACK quando `size` vier
// ausente/0; NÃO é a fonte primária (Open Q2 dissolvida).
const WINDOW_FALLBACK: Record<string, number> = {
  "claude-opus-4-8": 1_000_000, "claude-sonnet-5": 200_000, "claude-haiku-4-5": 200_000,
};
export function formatUsage(used?: number, size?: number, model?: string): string {
  const win = size && size > 0 ? size : (model ? WINDOW_FALLBACK[model] : undefined);
  if (used == null || win == null) return "";                 // best-effort: sem parênteses
  const pct = Math.round((used / win) * 100);
  return `(${abbrev(used)} / ${pct}%)`;                        // "(287k / 29%)"
}
```

```ts
// sentence-split.ts — período por linha (#7). Só prosa; nunca dentro de código.
// NÃO quebra em: abreviações (e.g., vs., etc.), versões (v0.26), nomes de arquivo
// (session.ts), decimais (20.5), reticências (…/...), URLs. Regra: ponto final +
// espaço + Maiúscula/início de sentença, com whitelist negativa.
export function splitSentences(prose: string): string { /* puro */ }
```

```tsx
// StepDivider.tsx — a raia carrega Agente + uso (#4/#5). Fallbacks best-effort.
<StepDivider label="SIMPLIFY" agent="Codex" usage="(287k / 29%)" />
// → "─── SIMPLIFY → Codex (287k / 29%) ───"   (sem usage em steps não-agent; sem agente → só label)
```

Motion honra `prefers-reduced-motion`; contraste WCAG AA em light **e** dark.

## Testing Strategy

- **Motor (vitest):**
  - `resolveAgentBinding` já testado; adicionar que `step_started` emitido carrega
    `agentName`/`model` corretos (claude default vs. `agent: codex`).
  - `clear()` ACP-nativo: um `clear_context` dispara dispose+`session/new`; o
    `sessionToTask` é re-registrado no novo `sessionId` (nunca fica órfão); **nenhum**
    `/clear` textual é enviado como prompt (regressão do bug do Codex).
  - `RunLoopResult` **byte-idêntico** com/sem `--emit-events` (AD-1 mantido).
- **Webview (vitest + Testing Library):**
  - `context-window`: `formatUsage` — Opus 1M com 200k → "(200k / 20%)"; modelo
    desconhecido ou `used` ausente → string vazia (sem parênteses); Codex sem usage → vazio.
  - `sentence-split`: quebra períodos reais; **não** quebra `Node.js`, `e.g.`, `v0.26`,
    `session.ts`, `20.5`, `http://…`, `...`; blocos de código passam intactos.
  - `stream-history`: segmentos carregam `agent`/`model`/`usedTokens` do step correto.
  - `StreamPanel`: arrastar o handle muda a altura; recarregar **restaura** a altura
    persistida; double-click volta ao default; fold segue independente.
  - `StepDivider`: renderiza `LABEL → Agente (uso)`; step não-agent não mostra uso;
    ausência de agente/uso degrada graciosamente.
- **Manual/visual:** Run real com pipeline claude+codex; conferir logo colorido,
  colunas +30%, título 3 linhas, resize do painel, raia com Agente+uso ao vivo,
  prosa em períodos, tray sem `●`, e um Step Codex resetando contexto sem erro.

## Boundaries

- **Always:**
  - Consumir `tokens.css` — zero cor/spacing/tipografia hardcoded (varre o diff).
  - Telemetria (agente/uso) é **best-effort**: ausência degrada para vazio/`n/d`,
    **nunca** quebra a raia nem o render.
  - Texto de Agente é **não-confiável**: `sentence-split` opera sobre texto já
    sanitizado (mantém o `react-markdown` sem `rehype-raw` de C-0010).
  - Extensões de Transport **aditivas e gated** por `--emit-events`; `reduce`
    exaustivo; `RunLoopResult` byte-idêntico (AD-1, AD-6).
- **Ask first:**
  - Formato exato da raia de uso (`(usados / %)` vs. outra ordem) — default proposto abaixo.
  - Qualquer política nova de reset além de "trocar `/clear` textual por `session/new`".
  - Tabela de janela por-modelo para modelos não-Anthropic (gpt-5/codex) — números via Context7.
- **Never:**
  - Hardcodar comportamento de loop no motor (AD-1) — nenhum Step/ordem/vocabulário no código.
  - Forkar/reimplementar `reduce`, `resolveAgentBinding` ou `computeDagreLayout`.
  - Enviar `/clear` (ou qualquer slash textual) como prompt para resetar contexto.
  - `sentence-split` tocar em blocos de código, inline code, URLs ou abreviações.
  - Deixar o `●` no título do tray.

## Success Criteria

1. `npm run typecheck && npm run lint && npm test` verdes na raiz (inclui os novos testes).
2. **#1 — Largura:** `--kanban-col-min` = **286px** (220 × 1.30). Colunas visivelmente
   mais largas; scroll horizontal continua funcional.
3. **#2 — Título 3 linhas:** `.kanban-card-title` usa `-webkit-line-clamp: 3`; card
   acomoda 3 linhas sem "pular" a altura ao truncar.
4. **#3 — Resize do painel:** existe um divisor arrastável entre Kanban e o painel de
   streaming; arrastar aumenta/diminui a altura; a altura **persiste** entre sessões
   (localStorage); há **mín/máx** e **double-click reseta** ao default; o fold de C-0010
   segue funcionando como estado separado.
5. **#4 — Agente na raia:** cada raia de Step **de Agente** mostra `LABEL → <Agente>`
   (ex.: `SIMPLIFY → Claude Code`, `REVIEW → Codex`), usando `display_name` do registry
   (fallback: chave capitalizada). Aparece **tanto** no StreamPanel quanto no CardDetail.
6. **#5 — Uso da context window na raia:** em Steps de Agente, a raia acrescenta
   `(<usados abreviado> / <percent>%)` (ex.: `SIMPLIFY → Codex (287k / 29%)`),
   computado da tabela model→janela + amostra de tokens do ACP. Agente sem usage
   (ex.: Codex quando não reporta) → **sem** os parênteses (best-effort, `n/d`).
7. **#6 — Logo colorido:** o header renderiza o **lockup oficial**
   `loopy-lockup-horizontal-gradient.svg` (gradiente magenta, viewBox 466×150 ≈ 3.1:1)
   no lugar do wordmark textual, com `alt="Loopy"`, altura fixa e legível em light
   **e** dark. Se o wordmark do gradiente não contrastar num tema, troca-se para o
   lockup `-black`/`-white` por `prefers-color-scheme`/`data-theme` (variantes já existem).
8. **#7 — Períodos curtos:** na prosa dos Steps de Agente, cada ponto final que
   continuava na mesma linha **quebra linha**; abreviações/versões/nomes de arquivo/
   decimais/URLs/reticências **não** são quebrados; blocos de código ficam intactos.
9. **#8 — Clear do Codex:** com `clear_context: true` num Step `agent: codex`, o motor
   **não** envia `/clear` textual; reseta o contexto via `session/new` (dispose+reopen),
   re-registrando o `sessionToTask`. O erro "Unknown command /clear" **não ocorre mais**;
   o mesmo caminho vale para o Claude (comportamento uniforme).
10. **#9 — Tray sem `●`:** o título do tray **nunca** exibe `●`; ocioso/rodando = só o
    ícone; um gate de aprovação pendente mostra apenas o indicador de gate (`⚠`/contagem).

## Assumptions

Confirmadas com o usuário antes deste spec (2026-07-09):

1. **id da change = `C-0011-agent-context-and-polish`** (slot livre após C-0010).
2. Este spec vive na **pasta da change**, não na raiz (a `SPEC.md` da raiz é a spec
   canônica do motor e **não** é tocada).
3. **#5 sem o projeto de referência:** o exemplo em `~/Documents/.../claude-code-whatsapp`
   está bloqueado pelo TCC do macOS; por decisão do usuário, implemento a **tabela
   por-modelo própria** (não dependo daquele projeto).
4. **#8 = `session/new` nativo** (dispose+reopen), uniforme para todos os Agentes —
   escolhido pelo usuário sobre "reset por-agente" e "pular clear no Codex".
5. **#5 semântica de "usados"** = ocupação do contexto no turno mais recente do Step
   (input + cache + output do último turno da Sessão), que **reseta** junto com
   `clear_context`. Best-effort; a confirmar no review se preferir outra métrica.
6. **#5 formato** = `(<usados> / <percent>%)` — `usados` absoluto abreviado (ex.: `287k`),
   `percent` inteiro. Coerente com "200k tokens ou 20% da janela" (janela de 1M).

## Refine decisions (2026-07-09)

Resolvidas na entrevista `/devy:refine`; sobrepõem as Assumptions/Open Questions abaixo:

1. **#5 fonte = `usage_update.{used,size}` do ACP** (não a tabela hardcoded). O tipo
   `UsageUpdate` da SDK (`types.gen.d.ts:3894`) carrega `used` ("tokens currently in
   context") **e** `size` ("total context window size") — hoje o `client.ts:226`
   descarta ambos e só lê `cost`. `pct = round(used/size)`. Autoritativo, per-sessão,
   model-agnóstico: dissolve a Open Q2 (janela do gpt-5/codex) e casa com a semântica
   "ocupação do turno mais recente que reseta no clear". `context-window.ts` encolhe
   para **fallback** (tabela só quando `size` ausente); `formatUsage(used, size?, model?)`.
2. **#5 timing = ao vivo.** `client.ts` roteia um evento `usage_sample` a cada
   `usage_update`; a raia do Step ativo atualiza durante o Step. `client.ts` só conhece
   `sessionId`; o `index.ts` carimba `taskId` (via `infoFor`) e `stepId` (via um
   `taskId→currentStepId` derivado do próprio stream de eventos). Evento:
   `usage_sample {taskId, stepId, used, size}` (era `usedTokens`).
3. **#5 formato = `(287k / 29%)`** (Assumption 6 confirmada): usados absoluto abreviado
   + percentual inteiro; `size` só alimenta o cálculo, não aparece na raia.
4. **#8 = `reopen()` encapsulado no `SessionWrapper`** (não gated — fix de motor
   sempre-ativo). `clear()` passa a: `dispose()` → `buildSession(cwd).start()` →
   **re-parseia** `modelConfigId`/`availableModeIds` do novo `newSessionResponse` →
   **re-aplica** mode/model/effort guardados (session/new NÃO os preserva — o `mode: plan`
   do audit seria perdido!) → **acumula custo cumulativo** atravessando reopens
   (`costCarry`, conserta a regressão de custo das métricas) → callback `onReopen(old,new)`
   re-registra `sessionToTask` no novo `sessionId`. **Identidade do wrapper preservada**
   (caches `sessionsByAgent` do orquestrador e `${agent}::${cwd}` do pool ficam válidos);
   `agent.ts` fica estrutural igual (seta config 1×, o wrapper replaya no reopen).
5. **#7 = conservador.** `sentence-split` quebra só em `. ` + Maiúscula com whitelist
   negativa; incerto → **mantém junto** (fail-safe). Sem quebra em `? `/`! ` (menos
   falso-positivo em prosa técnica).
6. **#3 = fração de runtime.** `--stream-h` vira fração persistida em localStorage:
   default `0.45` (= 45% atual), min `0.20`, max `0.70`, double-click reseta ao default;
   estado **separado** do fold (C-0010). Fração (não px) mantém responsividade ao
   redimensionar a janela.
7. **#4 = motor resolve o label.** `step_started` ganha `agentName`(chave) + `model`
   **só em Steps de Agente**; o motor resolve `display_name ?? capitalize(chave)` (o
   webview não tem o registry `agents:`). Aparece em StreamPanel **e** CardDetail;
   Steps não-Agente → raia só com o label.

## Open Questions (para o review / plano)

1. ~~Asset do logo (#6)~~ **RESOLVIDO:** usar
   `.harn/design/logo/loopy-brand/svg/lockup/loopy-lockup-horizontal-gradient.svg`
   (copiado para `apps/menubar/src/assets/`); variantes `-black`/`-white` disponíveis
   caso um tema precise de swap.
2. ~~Janela por-modelo não-Anthropic (#5)~~ **RESOLVIDO** (refine #1): usa
   `usage_update.size` do ACP direto — sem depender de tabela para gpt-5/codex. Resta
   **validar empiricamente no teste manual** se o Codex de fato emite `usage_update`
   (se não emitir → raia cai em vazio/`n/d`, best-effort).
3. ~~Uso ao vivo vs. por-Step (#5)~~ **RESOLVIDO** (refine #2): ao vivo, última amostra
   por Step, atualiza durante o Step.
