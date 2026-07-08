# Plano de implementação: C-0010 — Menubar UI polish (impecável)

> Narrativa, grafo de dependências, checkpoints e riscos do backlog em `todo.md` (mesma pasta).
> Fonte de verdade dos requisitos: `spec.md`. Invariantes em toda task: **AD-1** (o app só
> observa; extensão do Transport é aditiva/gated por `--emit-events`; `RunLoopResult`
> byte-idêntico com/sem a flag) e **AD-6** (apresentação pura — reusa `reduce`/`computeDagreLayout`,
> nunca forka; toda lógica não-trivial é função pura testável).

## Overview

C-0009 entregou a paridade funcional (grafo + Kanban + streams + gate) numa app Tauri de
barra de menus. Esta change **não adiciona capacidade de motor** — refina a UI/UX de
`apps/menubar` até o padrão de `DESIGN.md`/`tokens.css`: marca oficial, popover no design
system, Kanban legível, painel de streaming alto com markdown + divisores cross-step, e
**drill-in por card** (descrição + deps + log persistido + aprovação contextual dentro do card).

O trabalho é fatiado em **12 tasks** sobre 4 fases. A Fase 0 estabelece 5 fundações
independentes (marca, tokens de layout, extensão do Transport, acumulador de histórico,
componente de markdown). As Fases 1–3 são fatias verticais que **consomem** essas fundações.

## Estado atual verificado (leitura do código, 2026-07-08)

- **Assets de marca existem** (desbloqueia #1): `.harn/design/logo/loopy-brand/macos/AppIcon.iconset`,
  `macos/AppIcon.icns`, `macos/tray/loopy-tray-22Template{,@2x}.png` (+ `loopy-trayTemplate{,@2x}.png`),
  `png/icon-rounded-dark/`. `main.rs:120` já tem `.icon_as_template(true)`.
- **Off-brand a corrigir:** `popover/Glance.tsx` (inline `#007AFF`/`cyan`/`orange`) e
  `panes/ApprovalPrompt.tsx` (modal full-screen `inset:0`, backdrop `rgba(0,0,0,.7)`, índigo `#1a1a2e`).
- **`tokens.css` já é rico** (accent magenta, `--shadow-gate`, `--z-gate`, spacing/radii, dark mirror).
  Só faltam vars de **layout** (largura de coluna, largura do drawer, altura/fold do stream).
- **Motor:** `task_registered` (`store.ts:142`, emitido em `orchestrator.ts:1338`) carrega só
  `taskId/title/status`. `Task` (`types.ts:50`) já tem `body` e `deps`. `TaskState` (`store.ts:75`)
  não tem `description`/`deps`. O `reduce` **reseta `stream:""`** em `task_registered`, `step_started`
  e `attempt_started` — por isso o histórico cross-step tem que viver na camada do app.
- **App-layer:** `store-bridge.ts` roteia NDJSON (event→`reduce`, control→UI); **não acumula**
  transcript. `StreamPanel` lê `task.stream` (reseta por step). `App.tsx` monta `StreamPanel` e
  renderiza o `ApprovalPrompt` full-screen. `state/notify.ts` (notificação nativa) já existe.
- **Markdown (Context7):** `react-markdown@^10` + `remark-gfm@^4`. `react-markdown` é **seguro por
  padrão** (não usa `dangerouslySetInnerHTML`); **não** adicionar `rehype-raw` = HTML embutido vira
  texto (sanitizado). React 18 OK.

## Architecture Decisions

- **AD-1 / AD-6 preservados.** A única mudança de motor (T-003) é **aditiva**: `task_registered`
  passa a carregar `description`+`deps`; `reduce` segue exaustivo; `RunLoopResult` byte-idêntico
  (o emit é side-effect puro, gated por `--emit-events`).
- **`description` = `task.body` sem a linha `Deps:`** (D3), derivado por helper puro no **site do
  emit** (o motor não tem campo `description`; `Files:` permanece). `deps` = `task.deps`.
- **Histórico cross-step na camada do app** (spec Tech Stack): `store-bridge` mantém um transcript
  append-only por `(taskId, stepId)` que **nunca reseta** (≠ `task.stream`); `stream-history.ts`
  (puro, AD-6) fatia em segmentos. **Ambas** as superfícies (StreamPanel ao vivo **e** log do
  CardDetail) leem daí — mesmo tratamento de markdown/divisores (Assumption #2).
- **Zero cor/spacing hardcoded.** Novos vars de layout entram **num único** ponto (T-002); todo
  CSS downstream só **consome** `var(--…)`. Isso também elimina contenção de escrita em `tokens.css`
  entre tasks paralelas.
- **Drill-in = drawer lateral direito** (~`var(--drawer-w)`, altura cheia; D1); board+stream à
  esquerda permanecem visíveis. Gate resolvido **dentro** do drawer; modal full-screen **removido** (D6).

## Grafo de dependências

```
Fase 0 (fundações, independentes — até 5 em paralelo):
  T-001 Marca & tray            (assets → src-tauri/icons + tauri.conf.json)
  T-002 Tokens de layout        (tokens.css: --kanban-col-min, --drawer-w, --stream-h, --stream-fold-h)
  T-003 Transport estendido     (engine: task_registered += description/deps; TaskState guarda)
  T-004 store-bridge + stream-history  (transcript append-only + função pura de segmentos)
  T-005 MarkdownStream          (react-markdown + remark-gfm, sanitizado)
  T-006 Glance popover          (reescrita off-brand → DS; consome tokens existentes)

Fase 1 (Kanban legível):
  T-007 Colunas largas + título 2 linhas   ← T-002

Fase 2 (Painel de streaming):
  T-008 Altura ~45% + fold + 1–4 panes + chip   ← T-002
  T-009 Markdown + cross-step + divisor + auto-stick   ← T-004, T-005, T-008

Fase 3 (Drill-in por card):
  T-010 Card clicável/focável + drawer shell + seleção persistente   ← T-007, T-009
  T-011 CardDetail: desc(markdown) + deps chips + log persistido      ← T-003, T-004, T-005, T-010
  T-012 Gate no card (remove modal; auto-abre; ⎋=Reprovar; notifica)  ← T-011
```

**Serialização por arquivo (evita conflito de merge de tasks paralelas no mesmo arquivo — lição
D-0001/harness):** `tokens.css`→só T-002 escreve. `kanban.css`/`KanbanBoard.tsx`→T-007,T-010 (T-010←T-007).
`StreamPanel.*`→T-008,T-009 (T-009←T-008). `App.css`→T-008,T-010 (serial via T-009). `App.tsx`→T-009,T-010,
T-011,T-012 (cadeia serial). `CardDetail.*`→T-010,T-011,T-012 (serial). `ApprovalPrompt.tsx`→só T-012.
Engine (`store.ts`/`orchestrator.ts`/`transport.ts`)→só T-003.

## Fases & Checkpoints

### Fase 0 — Fundações (T-001 ∥ T-002 ∥ T-003 ∥ T-004 ∥ T-005 ∥ T-006)
Seis tasks independentes. `concurrency: 5` no yml → 5 rodam, 1 aguarda.

**Checkpoint 0:** `npm run typecheck && npm run lint && npm test` verdes (inclui novos testes de
`stream-history` e `MarkdownStream`). Testes dourados de store/orchestrator **seguem verdes**
(regressão AD-1/AD-6). Manual: ícone oficial na menubar (claro **e** escuro).

### Fase 1 — Kanban legível (T-007)
Colunas ~220px + título 2 linhas (line-clamp).

### Fase 2 — Painel de streaming (T-008 → T-009)
Altura/fold/panes primeiro; markdown + cross-step depois.

**Checkpoint 1 (Fases 1–2):** streams a 40–50% com fold para barra ~28px; markdown renderizado;
divisor rotulado por step; scroll contínuo cross-step com auto-stick; ≤4 panes + chip "＋N rodando".

### Fase 3 — Drill-in por card (T-010 → T-011 → T-012)
Interação+shell → conteúdo → gate.

**Checkpoint final:** clicar/Enter num card abre o drawer; descrição (markdown) + deps chips + log;
o log **persiste após `task_finished`**; um `approval_requested` auto-abre o drawer no card certo,
traz a janela pra frente + notifica, e Aprovar/Reprovar acontece dentro do card (`⎋`=Reprovar com
gate ativo). Modal full-screen não existe mais. Todos os Success Criteria do spec atendidos.

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| T-003 quebra testes dourados de store (deep-equal do `TaskState`) | Médio | Campos **opcionais** (`description?`/`deps?`); atualizar os goldens na própria task; provar `RunLoopResult` byte-idêntico com/sem `--emit-events`. |
| Tasks paralelas editando o mesmo arquivo → conflito de merge irreconciliável | Alto | Serialização por-arquivo via `Deps:` (tabela acima); `tokens.css` escrito só por T-002 (resto consome). |
| Contaminação do harness (`.claude/` no diff, lint do repo inteiro) | Médio | `loopy.yml` já exclui `.claude` no commit (`:!.claude`) e o eslint ignora `.claude/`+`.worktrees/` (config de C-0009). Não reintroduzir `git add -A` sem o pathspec. |
| #1 (assets) não é coberto por `ci` (typecheck/lint/test) | Baixo | Verificação **manual/visual** explícita + o step `review` sanity-check; `ci` só garante ausência de regressão de código. |
| O `loopy.yml` da raiz ainda aponta `inputs` para C-0009 | Alto (pré-run) | **Pré-run (usuário):** reapontar `inputs.{spec,plan,todo}` para `C-0010-…` e rodar `loopy` com `--emit-events`. Ver "Pré-run" abaixo. |
| Perf do markdown ao vivo (re-parse O(n²)) | Baixo | Memoizar segmentos concluídos; só o tail em crescimento re-parseia (D5). |

## Pré-run (responsabilidade do usuário — eu não executo o loop)

1. Reaponte no `loopy.yml` da raiz: `inputs.spec/plan/todo` → `.harn/devy/changes/C-0010-menubar-ui-polish/…`.
2. Confirme `--emit-events` no comando de run (a app só recebe `description`/`deps` com a flag).
3. `loopy . --dry-run` para conferir o pipeline resolvido antes do run vivo.

## Open questions

Nenhuma bloqueante — as OQ1–3 e D1–D6 do spec já resolvem o entendimento compartilhado. Defaults
de nível-plano (larguras/alturas exatas) estão nas tasks e são ajustáveis no review.
