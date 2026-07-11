# Plano de implementação: C-0012 — Popover estilo menu nativo + tela "Sobre"

> Deriva de `spec.md` (mesma pasta). **Todas as decisões de design já estão resolvidas
> na spec** (§Assumptions + §Decisões do /devy:refine) — este plano decide só a
> *mecânica e a ordem*, não o design. Change de UI da app `apps/menubar`: **não** toca
> o motor (`src/` na raiz). Segue o padrão C-0009/C-0010 (DESIGN.md, tokens-only).

## Overview

Reformatar o popover da tray (`Glance.tsx`) para se comportar como um `NSMenu`
nativo do macOS — chrome de menu (material `Menu`, borda hairline + rim), todo item
com ícone monocromático, separadores entre grupos — preservando o **header de status
glanceável** no topo. Adicionar dois itens novos (**Sobre**, **Sair**) e uma **janela
"Sobre"** dedicada (~360×320) com wordmark, versão, tagline, links (GitHub/npm) e
crédito. **Sair** compartilha o guard de "Run ativo" com o Cmd+Q. Versão passa a ser
**single-sourced** na raiz `package.json` (já 0.3.0) via path-ref no `tauri.conf.json`.

Zero capacidade nova de motor. Zero cor hardcoded (tudo `tokens.css`). Overlay do
NSPanel em apps fullscreen **não** pode regredir.

## Architecture Decisions (herdadas da spec — não reabrir)

- **Popover = header de status + menu** (não menu puro): o status glanceável fica.
- **Material do NSPanel → `NSVisualEffectMaterial::Menu`** (era `Popover`) — backdrop
  mais sólido, fiel a um `NSMenu`. Mantém corner radius (10pt) + rim; não regride o
  overlay fullscreen (não tocar level/collection-behaviour).
- **Realce do item highlighted (hover **e** foco ↑/↓) → fill accent cheio**
  (`--accent` + `--accent-ink`), como o `NSMenu` nativo. **Item disabled nunca acende.**
- **Semântica de menu nativo:** toda ativação (Abrir/Parar/Sobre/Sair) **fecha o
  popover** — inclusive **Parar** (feedback via badge/título da tray). `Esc` fecha;
  **sem highlight de repouso ao abrir** (seta inicia o roving pelo topo). Reusa o
  caminho resign-key/`hide_popover_panel` do `panel.rs`.
- **Links externos → `tauri-plugin-opener`** (oficial v2). `openUrl` do
  `@tauri-apps/plugin-opener`; permissão `opener:allow-open-url` **host-scoped** aos 2
  destinos.
- **Janela "Sobre" → titlebar overlay** (`titleBarStyle:"Overlay"` + `hiddenTitle`):
  traffic lights flutuam sobre o conteúdo; gestão nativa (close/drag/Cmd+W de graça).
- **Versão single-sourced → raiz `package.json` via path-ref** (`tauri.conf.json`
  `"version": "../../../package.json"`); `getVersion()` reflete o produto. Fallback =
  script de prebuild sync se o path-ref não for suportado (confirmar via Context7).
- **Guard de quit unificado:** `confirm_quit_if_running(app) -> bool` (DRY) reusado
  pelo `ExitRequested` (Cmd+Q) e pelo comando `quit_app`.

## Dependency graph

```
T-001 (versão path-ref) ─┐
                         ├─► T-005 (janela about + opener + caps) ─► T-006 (About.tsx + rota)─┐
T-004 (quit_app + guard)─┘                                                                     │
                                                                                              ├─► T-007 (Glance → menu)
T-002 (icons) ─► T-003 (Menu/MenuItem/Separator) ────────────────────────────────────────────┘
                                                              T-004 ───────────────────────────┘
T-008 (panel.rs material Menu) — independente (validado visualmente junto de T-007)
```

Ordem de execução segue o grafo bottom-up. Conjunto **Ready** inicial (4-way paralelo):
**T-001, T-002, T-004, T-008**. As arestas serializam edições de arquivos
compartilhados (`index.ts` em T-002/T-003; `main.rs`/`tauri.conf.json` em T-004/T-005)
para evitar Merge conflict entre worktrees.

## Vertical slicing (por que esta ordem)

Cada fase depois da fundação entrega um **caminho completo e verificável**, e o
`Glance` é reescrito **por último** (T-007) para que o sistema fique **funcional o
tempo todo**: até T-007, o popover antigo (dois botões) segue intacto e operante; a
troca para o menu aterrissa atômica só quando **todos os seus alvos já existem**
(Menu+icons, `quit_app`, janela `about`+`show_about_window`+`About`). Assim nenhum
checkpoint deixa o popover num estado meio-quebrado (ex.: item "Sobre" que joga erro
porque o comando ainda não existe).

- **Fundação (T-001..T-004, T-008):** primitivos reusáveis (contrato-first) + de-risco
  dos dois pontos incertos (path-ref de versão; variante `Menu` do material) cedo.
- **Caminho "Sobre" (T-005→T-006):** fatia vertical fim-a-fim — Rust/config abre a
  janela e habilita o opener; o webview a preenche e a `main.tsx` a roteia.
- **Montagem (T-007):** o popover vira menu e liga Abrir/Parar/Sobre/Sair — fim-a-fim.

## Fases & checkpoints

### Fase 1 — Fundação & de-risco (T-001 ∥ T-002 ∥ T-004 ∥ T-008; depois T-003)
Primitivos de menu, ícones, comando de quit, material do painel e versão single-sourced.

**Checkpoint Fundação:**
- [ ] `npm run typecheck` && `npm run lint` limpos; `npm test -w apps/menubar -- icons Menu` verdes.
- [ ] `cargo clippy` + `cargo test` (menubar) verdes; overlay fullscreen do popover **não** regrediu.
- [ ] Popover **antigo** (dois botões) segue funcional (nada de `Glance` tocado ainda).
- [ ] App reporta versão **0.3.0** (path-ref ou sync fallback).

### Fase 2 — Caminho "Sobre" (T-005 → T-006)
Janela `about` + opener + capabilities; conteúdo React + roteamento.

**Checkpoint Sobre:**
- [ ] `show_about_window` abre janela ~360×320, titlebar overlay, sem faixa "Sobre".
- [ ] "Sobre" mostra **versão 0.3.0** (via `getVersion`), tagline, autor; links chamam `openUrl` (host-scoped).
- [ ] `npm test -w apps/menubar -- About` verde; `npm run typecheck` limpo.
- [ ] Nota: Sobre/Sair ainda **não** alcançáveis pela tray (popover antigo) — normal até T-007.

### Fase 3 — Montagem do popover (T-007)
Reescrita do `Glance` para o layout de menu, ligando os 4 itens.

**Checkpoint final (Success Criteria da spec):**
- [ ] `npm run typecheck && npm run lint && npm test` verdes na raiz + `npm test -w apps/menubar` verde.
- [ ] Chrome de menu (borda+rim+material `Menu`) correto em **light e dark**.
- [ ] Estrutura: header → sep → Abrir/Parar → sep → Sobre/Sair, cada item com ícone.
- [ ] **Parar** desabilitado idle / habilitado running (`aria-disabled`); disabled não acende.
- [ ] **Sobre** abre a janela com wordmark, 0.3.0, tagline, links vivos, crédito.
- [ ] **Sair** encerra; com Run ativo confirma, idle sai direto (guard compartilhado, não burlado).
- [ ] Teclado (↑/↓/Enter/Esc) e foco visível funcionam; toda ativação fecha o popover.
- [ ] Zero cor hardcoded no diff do webview; `panel.rs` mantém o overlay fullscreen.
- [ ] Revisar com o humano antes de considerar concluído.

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Path-ref de `version` não suportado no Tauri v2 | Médio | Confirmar via Context7 **antes** (T-001); fallback = script de prebuild que sincroniza 0.3.0 no `tauri.conf.json`. |
| Variante `NSVisualEffectMaterial::Menu` ausente no `window-vibrancy` 0.6 | Médio | Confirmar o enum antes de trocar (T-008); se ausente, manter `Popover` e reforçar rim/opacidade via CSS — regride só o backdrop, não o overlay. |
| Roving focus por teclado conflita com o "drop focus ring" e o key-focus do NSPanel | Médio | Sem highlight de repouso ao abrir; a 1ª seta inicia o roving pelo topo; reconciliar com `dropControlFocus` (só limpa `:focus-visible` de repouso, não bloqueia navegação). |
| Sintaxe do host-scoping de `opener:allow-open-url` | Baixo | Source-driven (Context7/docs oficiais) para o schema exato do scope no `capabilities/default.json` (T-005). |
| `getVersion()` não reflete o path-ref (lê Cargo.toml) | Baixo | Verificar em T-006 com mock nos testes + checagem manual no build; se divergir, o sync fallback grava a versão no bundle config. |
| Regressão visual do popover em fullscreen (material mais opaco) | Médio | Validação visual light+dark + teste de overlay fullscreen é **gate** do checkpoint final. |

## Open questions

Nenhuma bloqueante — a spec fechou todas as branches de design no /devy:refine. Os dois
pontos "a confirmar" (path-ref de versão; variante `Menu`) são verificações técnicas
com fallback definido, resolvidas dentro de T-001/T-008 (não exigem input humano).
