# Backlog: C-0012 — Popover estilo menu nativo + tela "Sobre"

> Consumido pelo motor (`- [ ]` pendente / `- [x]` concluída; id `T-\d+`; corpo indentado).
> Narrativa, grafo de dependências, checkpoints e riscos: ver `plan.md` (mesma pasta).
> Toda cor/raio/spacing/tipografia vem de `tokens.css` (zero literais) — varre o diff.

## Fase 1 — Fundação & de-risco (T-001 ∥ T-002 ∥ T-004 ∥ T-008)

- [ ] T-001: Versão single-sourced — `tauri.conf.json.version` → path-ref da raiz (de-risco)
    `apps/menubar/src-tauri/tauri.conf.json`: trocar `"version": "0.1.0"` literal por path-ref `"../../../package.json"` (resolve a partir de `src-tauri/` para a raiz do monorepo, já 0.3.0). Confirmar suporte a path-ref no Tauri v2 via Context7 **antes** de escrever; se não suportado, fallback = script de prebuild que sincroniza a versão da raiz para o `tauri.conf.json` (adicionar ao `build:sidecar`/pre-build). Alinhar `apps/menubar/package.json` a 0.3.0 por higiene (não é a fonte).
    Aceite: build/dev do app reporta versão 0.3.0 (não 0.1.0); a raiz `package.json` permanece a única fonte autoritativa; nenhuma regressão no bundle.
    Verificação: `npm run typecheck` && inspeção do config resolvido (dev sobe reportando 0.3.0; ou o script de sync grava 0.3.0). Confirmado por `getVersion()` em T-006.
    Deps: nenhuma. Files: apps/menubar/src-tauri/tauri.conf.json, apps/menubar/package.json, (fallback) apps/menubar/package.json script + script de sync. Scope: S. RISCO (path-ref).

- [x] T-002: Ícones monocromáticos — `icons.tsx` (IconOpen/IconStop/IconInfo/IconPower) + export + smoke
    NOVO `src/ui/icons.tsx`: 4 SVGs 16×16, `viewBox="0 0 16 16"`, `fill="currentColor"`, `aria-hidden`, estilo SF Symbols (§Decisões #6: `macwindow`/`stop.fill`/`info.circle`/`power`). Sem cor hardcoded (herdam `currentColor`). Exportar via `src/ui/index.ts`. Teste de smoke: monta cada ícone, confirma `aria-hidden` e uso de `currentColor` (nenhum hex).
    Aceite: os 4 ícones renderizam; todos `aria-hidden`; nenhum literal de cor no SVG; exportados pelo barrel.
    Verificação: `npm test -w apps/menubar -- icons` && `npm run typecheck`.
    Deps: nenhuma. Files: src/ui/icons.tsx, src/ui/icons.test.tsx, src/ui/index.ts. Scope: S.

- [ ] T-003: Primitivos de menu — `Menu`/`MenuItem`/`MenuSeparator` + CSS + testes + export
    NOVO `src/ui/Menu.tsx` + `Menu.css`: `Menu` (`role="menu"`), `MenuItem` (`role="menuitem"`; props `icon`/`disabled`/`onSelect`; ativa por click e Enter; `disabled` → `aria-disabled` e **não** dispara `onSelect`), `MenuSeparator` (`role="separator"`). Set de estados completo (default/hover/focus-visible/active/disabled). Realce do item highlighted (hover **e** foco ↑/↓) = **fill accent cheio** (`--accent` + `--accent-ink`); item disabled **nunca** acende. Roving focus por teclado (↑/↓ move entre itens habilitados, pula separadores/disabled). Exportar pelo barrel.
    Aceite: itens+ícones renderizam com `role` correto; `disabled` recebe `aria-disabled` e não chama `onSelect`; separadores presentes; `onSelect` no click e no Enter; ↑/↓ movem o foco entre itens habilitados; zero literal de cor.
    Verificação: `npm test -w apps/menubar -- Menu` && `npm run typecheck`.
    Deps: T-002 (barrel `index.ts` compartilhado). Files: src/ui/Menu.tsx, src/ui/Menu.css, src/ui/Menu.test.tsx, src/ui/index.ts. Scope: M.

- [ ] T-004: Rust — `quit_app` + extrair `confirm_quit_if_running(app) -> bool` (DRY do guard)
    `src-tauri/src/main.rs`: extrair o confirm inline do `ExitRequested` para helper `confirm_quit_if_running(app: &AppHandle) -> bool` (idle → `true` sem diálogo; rodando → diálogo "A Run is active. Quit anyway?", retorna o veredito). Reusar nos dois caminhos. Novo `#[tauri::command] quit_app`: se confirmado → `state.stop()` + `app.exit(0)`. Registrar no `invoke_handler!`. Teste unitário do ramo não-diálogo (`!is_running → true`).
    Aceite: Cmd+Q e `quit_app` compartilham `confirm_quit_if_running`; idle sai direto; rodando exige confirm; guard **não** é burlado; ramo não-diálogo testado.
    Verificação: `cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml` && `cargo clippy --manifest-path apps/menubar/src-tauri/Cargo.toml`.
    Deps: nenhuma. Files: apps/menubar/src-tauri/src/main.rs. Scope: S.

- [x] T-008: `panel.rs` — material `Popover` → `Menu` (chrome de menu nativo)
    `src-tauri/src/panel.rs`: trocar `NSVisualEffectMaterial::Popover` por `::Menu` no `apply_vibrancy` (backdrop mais sólido/opaco, fiel a um `NSMenu`). Confirmar que a variante `Menu` existe no `window-vibrancy` 0.6. Manter `POPOVER_CORNER_RADIUS` (10pt), o rim/hairline do topo e **não regredir** o overlay fullscreen (não tocar level/collection-behaviour). Manter os testes existentes de `panel.rs` verdes.
    Aceite: material = `Menu`; corner radius + rim preservados; overlay em app fullscreen intacto; testes de `panel.rs` verdes.
    Verificação: `cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml` && `cargo clippy ...`; validação visual (T-007/checkpoint).
    Deps: nenhuma. Files: apps/menubar/src-tauri/src/panel.rs. Scope: XS.

## Fase 2 — Caminho "Sobre" (T-005 → T-006)

- [ ] T-005: Rust/config — janela `about` + `tauri-plugin-opener` + capabilities
    `tauri.conf.json`: janela `about` (`visible:false`, ~360×320, `resizable:false`, centralizada, `titleBarStyle:"Overlay"` + `hiddenTitle:true`). `main.rs`: `#[tauri::command] show_about_window` (cria/mostra/foca `about`; promove a `Regular` enquanto visível; ao fechar, se `main` está escondida → reverte a `Accessory`) + registrar; wiring do `on_window_event` de close da `about`. `Cargo.toml`: + `tauri-plugin-opener` (versão pinada via Context7) + `.plugin(tauri_plugin_opener::init())`. `capabilities/default.json`: adicionar `about` à lista de janelas + `opener:allow-open-url` **host-scoped** a `github.com/hgflima/loopy` e `npmjs.com/package/@hgflima/loopy`.
    Aceite: `show_about_window` abre janela ~360×320 sem faixa de título; promove/reverte activation policy corretamente; plugin opener registrado; capability restringe `openUrl` aos 2 destinos.
    Verificação: `cargo build --manifest-path apps/menubar/src-tauri/Cargo.toml` && `cargo clippy ...`; abrir a janela manualmente (invoke temporário) confirma dimensão/titlebar overlay.
    Deps: T-001, T-004 (`tauri.conf.json`/`main.rs` compartilhados). Files: apps/menubar/src-tauri/tauri.conf.json, apps/menubar/src-tauri/src/main.rs, apps/menubar/src-tauri/Cargo.toml, apps/menubar/src-tauri/capabilities/default.json. Scope: M.

- [ ] T-006: Webview "Sobre" — `About.tsx`/`.css`/`.test.tsx` + roteamento em `main.tsx`
    NOVO `src/about/About.tsx` + `About.css`: wordmark (reusa os SVGs de brand, swap light/dark como `App.css`) + versão via `getVersion()` (`@tauri-apps/api/app`) + tagline PT ("Motor de loop agêntico config-driven via ACP") + links GitHub/npm que chamam `openUrl` (`@tauri-apps/plugin-opener`) + autor/copyright ("© Henrique Lima", ano via `new Date().getFullYear()`). Header com `data-tauri-drag-region` + `padding-top` que livra os traffic lights (titlebar overlay). `main.tsx`: flag `IS_ABOUT` (label `about`) → renderiza `<About/>` (espelha `IS_POPOVER`→`<Glance/>`); tag no `documentElement` se precisar de estilo por-janela.
    Aceite: mostra versão (mock `getVersion` → "0.3.0"), tagline e autor; click nos links chama `openUrl` com o destino certo (mock); temas claro/escuro; zero literal de cor.
    Verificação: `npm test -w apps/menubar -- About` && `npm run typecheck`.
    Deps: T-005. Files: src/about/About.tsx, src/about/About.css, src/about/About.test.tsx, src/main.tsx. Scope: M.

## Fase 3 — Montagem do popover (T-007)

- [ ] T-007: Reescrita do `Glance` — header de status → menu (Abrir/Parar · Sobre/Sair)
    `src/popover/Glance.tsx`: header de status glanceável (`done/total · running · ⚠`) → `MenuSeparator` → **Abrir** (`show_main_window`) / **Parar** (`stop_sidecar`, `disabled` quando idle) → `MenuSeparator` → **Sobre** (`show_about_window`) / **Sair** (`quit_app`), cada item com ícone (T-002) via `Menu`/`MenuItem` (T-003). Remover a sub-linha "delegação: --yes …". Manter o re-measure de altura (ResizeObserver → `resize_popover`). Semântica de menu nativo: toda ativação **fecha o popover** (inclusive Parar; reusa o caminho resign-key/`hide_popover_panel`), `Esc` fecha, sem highlight de repouso ao abrir (roving inicia do topo na primeira seta), foco visível. `Glance.css`: estilos do header; superfície transparente sobre a vibrancy (preservar `.popover-window` transparente). `Glance.test.tsx`: atualizar — Abrir/Parar/Sobre/Sair + ícones presentes; **Parar** desabilitado idle / habilitado running; cada item chama o `invoke` correto (mock `@tauri-apps/api/core`); header ainda renderiza; zero literal de cor.
    Aceite: layout header→sep→Abrir/Parar→sep→Sobre/Sair com ícones; Parar `aria-disabled` quando idle; cada item invoca o comando certo; ↑/↓/Enter/Esc funcionam; re-measure preservado; zero literal de cor no DOM.
    Verificação: `npm test -w apps/menubar -- Glance` && `npm run typecheck`.
    Deps: T-003, T-004, T-006. Files: src/popover/Glance.tsx, src/popover/Glance.css, src/popover/Glance.test.tsx. Scope: M.
