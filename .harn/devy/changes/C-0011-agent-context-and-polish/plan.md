# Plano: C-0011 — Agent context surfacing + menubar polish

> Companion de `spec.md` (mesma pasta). O `todo.md` é o backlog consumido pelo
> motor; este documento é a **narrativa**: grafo de dependências, fatiamento
> vertical, checkpoints, riscos e questões abertas. Requisitos e critérios de
> sucesso: `spec.md`.

## Overview

Nove melhorias em quatro frentes (A legibilidade Kanban · B ergonomia do
streaming · C telemetria por-Step · D identidade & correções). **Não** adiciona
capacidade de motor (AD-1): (a) o motor **encaminha metadado que já possui**
(qual Agente roda cada Step; quanto da janela de contexto foi usada) e (b) refina
a UX até ficar cognitivamente mais eficiente. A **única** mudança de motor com
peso é o **#8**: o reset de contexto passa de `/clear` textual (que o Codex
rejeita) para **reopen ACP-nativo** (`dispose()` + `session/new` + replay de
config), fix sempre-ativo.

## Architecture Decisions

- **AD-1/AD-6 preservados** — a app segue **apresentação pura** sobre `StoreState`
  de `loopy/tui/store` (reusa `reduce`, nunca forka). Extensões de Transport são
  **aditivas e gated por `--emit-events`**; `RunLoopResult` **byte-idêntico**
  com/sem a flag. O Transport já serializa via spread genérico
  (`{ frame:"event", ...event }`, `transport.ts:97-99`) — **campos novos em
  eventos existentes e o novo `usage_sample` viajam sem tocar `transport.ts`**.
- **#8 reopen preserva a identidade do wrapper** — `SessionWrapper.reopen()` faz
  **swap interno de `this.active`** (o `sessionId` é getter de `active`,
  `session.ts:165-167`), então a **referência do wrapper não muda**: os caches
  keyed por `${agent}::${cwd}` (`pool.ts:56-59`) e a `sessionsByAgent`/`opened`
  do orquestrador (`orchestrator.ts:614,866`) continuam válidos **sem re-keying**.
  O que quebra é o que é keyed por `sessionId`: `sessionToTask` (`index.ts:367,454`,
  re-registrado via callback `onReopen`) e o custo (`CostBuffer`,
  `client.ts:245-263`, atravessado por `costCarry` no wrapper). O wrapper passa a
  **guardar mode/model/effort aplicados** para **replayar** após `session/new`
  (senão o `mode: plan` do audit — setado 1× fora do loop de tentativa em
  `agent.ts:208-226` — seria perdido). `agent.ts` fica **estrutural igual**.
- **#4 o motor resolve o label** — `step_started` ganha `agentName` (label já
  resolvido `display_name ?? capitalize(chave)`) + `model`, **só em Steps de
  Agente**. O `binding` (`resolveAgentBinding`, `orchestrator.ts:171-185`) é
  resolvido em `:988`/`:1100` mas hoje **não** entra no evento (emitido em
  `:885-890`, sem `binding` em escopo) — a task o threada até o emit. O webview
  não conhece o registry `agents:`, por isso a resolução é do motor.
- **#5 fonte = `usage_update.{used,size}` do ACP** (refine #1), não tabela
  hardcoded. `client.ts:226-232` hoje só extrai `cost` e **descarta** `used`/`size`
  (presentes no SDK, `types.gen.d.ts:3898/3902`). Amostra **ao vivo** por
  `usage_update`; a raia usa `pct = round(used/size)`. `context-window.ts` é só
  **fallback** (tabela por-modelo quando `size` ausente). **Não** usa `drainUsage`
  (soma turnos → superestima).
- **Ponte de correlação (#5)** — `used`/`size` chegam por `sessionId`
  (`client.ts` → seam `onUpdate`, `client.ts:584`); `taskId` sai de
  `sessionToTask`/`infoFor` (`index.ts:372-376`); `stepId` sai de um
  `taskId→currentStepId` derivado do próprio stream de eventos no `index.ts`
  (a store já mantém `currentStepId` em `store.ts:356`, mas o `usage` é roteado
  fora dela). Evento: `usage_sample {taskId, stepId, used, size}`.
- **Um único escritor de `tokens.css`** — como no C-0010 (T-002), **uma** task
  (T-004) detém todas as edições de `tokens.css` (kanban 286px, `--logo-h`,
  default do stream); os consumidores só leem `var(--…)`. #3 dirige a altura em
  **runtime** (fração em localStorage) via inline-style — **não** reescreve
  `tokens.css`.
- **Deps serializam arquivos compartilhados** — várias tasks de UI tocam
  `App.tsx`/`App.css`/`StreamPanel.tsx`; a telemetria de motor toca
  `index.ts`/`store.ts`. Sob `concurrency: 5`, tasks concorrentes no mesmo arquivo
  **conflitam** (lição registrada). O DAG abaixo declara `Deps` para serializar
  **exatamente** os arquivos compartilhados, deixando o resto paralelo. Imports de
  `sentence-split`/`context-window` são **diretos** (não via `ui/index.ts`) para
  não criar contenção nesse barrel.
- **Fatiamento vertical** — cada task entrega um caminho completo e deixa o
  sistema verde. A telemetria (C) corta na costura natural motor↔app (que também
  é a costura de teste: vitest de motor × vitest de webview): o motor emite mesmo
  que o app ainda não leia; o app degrada para vazio quando não há dado.

## Dependency graph

```
Fase 0 (raízes, paralelas — sem arquivo compartilhado entre si)
  T-001  #9 tray sem ●            (main.tsx, main.rs)
  T-002  #7 sentence-split        (sentence-split.ts, MarkdownStream.tsx)
  T-003  #5 context-window        (context-window.ts)          ─┐
  T-004  tokens (286/logo/stream) (tokens.css)          ─┐      │
                                                         │      │
Fase 1 (motor)                                           │      │
  T-005  #8 clear→reopen  ─┐  (session.ts, pool.ts, index.ts)   │
  T-006  #4 agent emit    ─┤  (types, schema, store, orch.)     │
                          │ │                                    │
  T-007  #5 usage live  ◄─┴─┘ (client.ts, index.ts, store.ts)   │
     │        Deps: T-005 (index.ts) + T-006 (store.ts, types)  │
     │                                                          │
Fase 2 (integração no app)                                      │
  T-008  #4/#5 app data  ◄── Deps: T-007   (store-bridge, stream-history)
  T-009  #2 título 3 linhas ◄── Deps: T-004 (kanban.css)  ◄─────┘
  T-010  #6 logo            ◄── Deps: T-004 (App.tsx, App.css, assets)
  T-011  #3 resize          ◄── Deps: T-004, T-010 (App.tsx, App.css, StreamPanel)
  T-012  #4/#5 raia render  ◄── Deps: T-003, T-008, T-011
                               (StepDivider, StreamPanel, CardDetail)
```

Serialização por arquivo compartilhado (todo o resto é paralelizável):
`index.ts` T-005→T-007 · `store.ts`/`types.ts` T-006→T-007 · `App.tsx`/`App.css`
T-010→T-011 · `StreamPanel.tsx` T-011→T-012 · `tokens.css` só T-004.

## Task list (detalhe em `todo.md`)

### Fase 0 — Quick wins & fundações puras
- **T-001 (#9)** — tray nunca exibe `●`; ocioso/rodando = só ícone; gate = `⚠`.
- **T-002 (#7)** — `sentence-split.ts` puro (whitelist negativa) + aplicação em
  `MarkdownStream` só a nós de prosa.
- **T-003 (#5)** — `context-window.ts` puro (`formatUsage`, `size` primário /
  tabela fallback).
- **T-004** — único escritor de `tokens.css` (kanban 220→286; `--logo-h`;
  default do stream).

### Checkpoint A (pós Fase 0)
- [ ] `npm run typecheck && npm run lint && npm test` verdes.
- [ ] `dev:web` abre; tray sem `●`; colunas +30%; prosa quebrada; nenhuma
      regressão de motor (nenhuma dessas tocou o motor).

### Fase 1 — Motor
- **T-005 (#8)** — `clear()` → `reopen()` (dispose + `session/new` + replay de
  mode/model/effort + `costCarry` + `onReopen` re-registra `sessionToTask`).
  **RISCO ALTO** — cirurgia no ciclo de vida da Sessão; roda cedo (fail-fast).
- **T-006 (#4)** — `step_started` carrega `agentName`(label) + `model` só em
  Steps de Agente; motor resolve `display_name ?? capitalize(chave)`.
- **T-007 (#5)** — `usage_update.{used,size}` extraído em `client.ts`; evento
  `usage_sample {taskId, stepId, used, size}` ao vivo; `RunLoopResult`
  byte-idêntico.

### Checkpoint B (pós Fase 1)
- [ ] `npm run typecheck && npm run lint && npm test` verdes (inclui testes novos
      de motor).
- [ ] Teste prova `RunLoopResult` **byte-idêntico** com/sem `--emit-events`.
- [ ] Teste prova que `clear_context` **não** envia `/clear` textual e que
      `sessionToTask` é re-registrado no novo `sessionId`.
- [ ] **Manual:** Run curto com pipeline claude+codex — um Step `agent: codex`
      com `clear_context: true` **não** dispara "Unknown command /clear".

### Fase 2 — Integração no app
- **T-008 (#4/#5)** — `store-bridge` acumula agent/model/used por (taskId,stepId);
  `stream-history` propaga nos segmentos.
- **T-009 (#2)** — `.kanban-card-title` `line-clamp: 3` + min-height estável.
- **T-010 (#6)** — lockup oficial no header (gradiente; swap black/white por tema).
- **T-011 (#3)** — divisor arrastável Kanban↔stream; fração persistida
  (0.45 default, 0.20–0.70, double-click reseta); fold independente.
- **T-012 (#4/#5)** — raia `LABEL → <Agente> (<uso>)` em StreamPanel **e**
  CardDetail; degrada graciosamente.

### Checkpoint C (pós Fase 2 — completo)
- [ ] `npm run typecheck && npm run lint && npm test` verdes (raiz).
- [ ] `cargo clippy` + `cargo test` (menubar) verdes.
- [ ] **Manual/visual:** `npm run build -w apps/menubar` → `.app`; Run real
      claude+codex: logo colorido, colunas +30% com título 3 linhas, resize do
      painel (persiste ao reabrir), raia com Agente+uso ao vivo, prosa em
      períodos, tray sem `●`, Step Codex resetando contexto sem erro.
- [ ] Varredura do diff: zero cor/spacing/tipografia hardcoded (tudo `tokens.css`).

## Risks and Mitigations

| Risco | Impacto | Mitigação |
|---|---|---|
| `reopen()` perde `mode: plan` do audit (session/new nasce no default) | Alto — audit viraria read-write | Wrapper **guarda** mode/model/effort aplicados e **replaya** após `session/new`; teste fixa que o mode sobrevive ao reopen |
| Reopen zera custo (`CostBuffer` keyed por `sessionId`) | Médio — regressão de métricas | `costCarry` cumulativo no wrapper: `readCost() = costCarry + read(novo sessionId)`; teste de cumulatividade atravessando reopen |
| `sessionToTask` órfão no novo `sessionId` → stream/tráfego sem taskId | Médio — TUI/log perdem rótulo | `onReopen(old,new)` re-registra (`delete old` + `set new`); teste dedicado |
| Testes de `session.test.ts` fixam o invariante antigo (clear mantém sessionId) | Médio — quebram de propósito | T-005 **atualiza** `:126-127,199,290-291,311-340` para o novo contrato (clear troca sessionId) |
| Codex pode não emitir `usage_update` | Baixo — raia sem uso | Best-effort: `formatUsage` retorna `""` (sem parênteses); validar empiricamente no teste manual |
| Tasks concorrentes no mesmo arquivo → conflito de merge (rebase não resolve) | Alto — vide lição registrada | DAG serializa **exatamente** os arquivos compartilhados via `Deps` |
| Emitir campos novos em `step_started`/`usage_sample` mudaria a saída TUI/linha | Médio — quebraria byte-identidade | Campos são **só dados**; view/line-reporter **ignoram**; teste de `RunLoopResult` byte-idêntico |
| Contaminação do harness (lint do repo + `git add -A` mexendo em `.claude/`) | Médio — merges concorrentes conflitam | Reusar os guards do yml de C-0010: commit `:!.claude` + eslint ignora `.claude/`/`.worktrees/` |

## Open Questions — RESOLVIDAS (2026-07-09)

Confirmadas com o usuário após o plano; todas fecham no default do `refine`:

1. **Formato da raia** — ✅ `(287k / 29%)`: usados absoluto abreviado + percentual
   inteiro; `size` só alimenta o cálculo (não aparece na raia). (T-003 / T-012.)
2. **Semântica de "usados"** — ✅ **ocupação atual** = última amostra de
   `usage_update.used` (tokens no contexto agora): atualiza ao vivo, congela na
   última amostra ao fim do Step, reseta com `clear_context`. **Não** é pico nem
   soma (nada de `drainUsage`). (T-007.)
3. **Fallback não-Anthropic** — ✅ `WINDOW_FALLBACK` cobre **só** Anthropic
   (opus/sonnet/haiku). Agente sem `size` do ACP → raia **sem** o bloco de uso (só
   o label); `formatUsage` retorna `""` quando não há janela. **Sem** degradar para
   absoluto-sem-% e **sem** popular gpt-5/codex. (T-003.)

## Pré-run (o usuário roda o loop, não o agente)

Antes de disparar a Run sobre este backlog, apontar `loopy.yml` para C-0011:
`name`, `inputs.spec/plan/todo` → `.harn/devy/changes/C-0011-agent-context-and-polish/*`.
Manter os guards de contaminação do harness (commit `:!.claude`, eslint ignora
`.claude/`). Recomenda-se um `--dry-run` primeiro para conferir o pipeline
resolvido e o *ready set* do DAG.
