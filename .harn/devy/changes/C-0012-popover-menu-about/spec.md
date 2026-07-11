# Spec: C-0012 — Popover no estilo menu nativo do macOS + tela "Sobre"

> Follow-up de C-0010 (Menubar UI polish). C-0010 elevou a app `apps/menubar` ao
> padrão do `DESIGN.md` (chrome neutro, cor com significado, magenta = interação).
> Esta change **não adiciona capacidade de motor** — reformata o **popover da tray**
> para se comportar como um **`NSMenu` nativo do macOS** e adiciona uma **tela "Sobre"**.

## Objective

Hoje o popover (`src/popover/Glance.tsx`) abre com uma linha de status + **dois botões**
(Abrir / Parar) — não segue as convenções de menu nativo do macOS (OrbStack, AirPods
Max). Queremos um popover que **pareça e opere como um menu nativo**, sem perder a
observabilidade que é a alma do produto (PRODUCT.md, princípio #3 — "legível de relance").

As convenções-alvo (observadas nos apps de referência):

1. **Chrome de menu nativo** — borda hairline mais clara com rim luminoso no topo
   (pseudo-gradiente); fundo sólido/material de menu; tipografia e cor de menu.
2. **Todo item tem ícone** monocromático à esquerda.
3. **Separadores** (`---`) entre grupos.

**Itens do menu (nesta ordem):**

- **[⤢] Abrir** — sempre ativo → `show_main_window`.
- **[■] Parar** — ativo **somente quando há loop rodando** → `stop_sidecar`.
- `--- separador ---`
- **[ⓘ] Sobre** — abre a nova janela "Sobre" → `show_about_window`.
- **[⏻] Sair** — encerra o app respeitando o guard de "Run ativo" → `quit_app`.

Acima do primeiro separador, um **header de status glanceável** (`done/total ·
running · ⚠`) preserva a "altitude do relance". A **tela "Sobre"** é uma janela Tauri
dedicada (~360×320) com wordmark + versão + tagline + links (GitHub/npm) + autor/copyright.

**Usuário:** o mesmo dev de C-0009/C-0010 — roda `@hgflima/loopy` sobre um repo-alvo e
acompanha o Run pela tray. O popover é a superfície do relance; deve ler em <1s e
operar como um menu nativo (teclado inclusive).

**Sucesso:** clicar na tray → popover com cara de menu nativo (borda clara com rim,
material de menu, tipografia de menu) → header de status → separador → Abrir/Parar →
separador → Sobre/Sair, cada item **com ícone** → **Parar** desabilitado quando idle →
**Sobre** abre a janela dedicada com **versão correta (0.3.0)**, tagline, links vivos e
crédito → **Sair** sai (com confirm se há Run ativo).

## Tech Stack

Herdado de C-0009/C-0010 (sem novas dependências de motor):

- **Webview:** React 18 + Vite + `@tauri-apps/api` v2.
- **Nativa:** Tauri v2 (Rust), plugins `positioner`/`dialog`/`notification`/`nspanel`.
- **Popover = NSPanel não-ativante** (`src-tauri/src/panel.rs`) com `window-vibrancy`
  — overlay em apps fullscreen (NÃO regredir esse comportamento).
- **Nova dep (confirmada no refino):** `tauri-plugin-opener` (oficial v2) para abrir os
  links do "Sobre" no navegador — permissão `opener:allow-open-url` host-scoped. Versão
  fixada via Context7 no plano.
- **Versão do app:** lida via `getVersion()` de `@tauri-apps/api/app`. Single-sourcing
  resolvido no refino: `tauri.conf.json` `"version"` referencia a raiz `package.json` via
  path-ref (`../../../package.json`, já 0.3.0) — não mais literal. Ver §Decisões.

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
Build .app:    npm run build -w apps/menubar

# Rust
Clippy: cargo clippy --manifest-path apps/menubar/src-tauri/Cargo.toml
Test:   cargo test   --manifest-path apps/menubar/src-tauri/Cargo.toml
```

Novos comandos Tauri (`src-tauri/src/main.rs`):

| Comando             | Contrato |
|---------------------|----------|
| `show_about_window` | Cria/mostra/foca a janela `about`; promove a `Regular` enquanto visível; ao fechar, se `main` está escondida, reverte para `Accessory`. |
| `quit_app`          | Encerra passando pelo guard de Run ativo (§Boundaries + Testing). Se rodando: confirm "A Run is active. Quit anyway?"; confirmado → `stop()` + `exit(0)`. Idle → `exit(0)`. |

## Project Structure

Arquivos tocados (existentes salvo `NOVO`):

```
apps/menubar/
  src/ui/
    icons.tsx            → NOVO: SVG monocromáticos (IconOpen, IconStop, IconInfo,
                           IconPower); 16×16, currentColor, aria-hidden.
    Menu.tsx / Menu.css  → NOVO: Menu (role=menu), MenuItem (role=menuitem; props
                           icon/disabled/onSelect), MenuSeparator. Set de estados completo.
    index.ts             → exporta Menu/MenuItem/MenuSeparator + ícones.
  src/popover/
    Glance.tsx           → REESCRITA: header de status → separador → Abrir/Parar →
                           separador → Sobre/Sair (via Menu). Remove a sub-linha
                           "delegação: --yes …" (minimalismo de menu). Mantém o
                           re-measure de altura (ResizeObserver → resize_popover).
    Glance.css           → estilos do header; superfície transparente sobre a vibrancy.
    Glance.test.tsx      → ATUALIZAR para o novo layout de menu.
  src/about/
    About.tsx / About.css → NOVO: conteúdo da janela "Sobre".
    About.test.tsx        → NOVO.
  src/main.tsx           → roteia label de janela `about` → <About/> (como `popover`
                           → <Glance/>); flag IS_ABOUT; wiring dos novos invokes.
  src-tauri/
    src/main.rs          → + show_about_window, + quit_app; extrai o confirm inline de
                           ExitRequested → helper confirm_quit_if_running(app)->bool
                           (DRY, reusado pelos dois caminhos); registra handlers.
    src/panel.rs         → NSVisualEffectMaterial::Popover → ::Menu (material de menu
                           nativo, fundo mais sólido); rim/hairline do topo se preciso.
    tauri.conf.json      → + janela `about` (visible:false, ~360×320, resizable:false,
                           centralizada, `titleBarStyle:"Overlay"` + `hiddenTitle:true`);
                           `version` → path-ref `../../../package.json` (raiz, já 0.3.0).
    Cargo.toml           → + tauri-plugin-opener.
    capabilities/default.json → permissões p/ opener + janela `about`.
  package.json (raiz)    → fonte única de versão (já 0.3.0); `tauri.conf.json` a referencia
                           via path-ref. `apps/menubar/package.json` não é autoritativo p/
                           versão (opcional alinhar a 0.3.0 por higiene).

.harn/devy/changes/C-0012-popover-menu-about/ → este spec, plan, todo
```

## Code Style

TypeScript ESM; componentes puros + estado de UI local. **Toda cor, raio, spacing e
tipografia vêm de `tokens.css`** (nunca literais) — varre o diff. Ícones herdam
`currentColor` (viram `accent-ink` no item selecionado, `ink-tertiary` no disabled):

```tsx
// icons.tsx — monocromático, herda a cor do texto do item
export function IconStop(props: SVGProps) {
  return <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden {...props}>
    <rect x={3.5} y={3.5} width={9} height={9} rx={1.5} fill="currentColor" />
  </svg>;
}

// MenuItem — role/estado nativos; sem cor hardcoded
<MenuItem icon={<IconStop />} disabled={!isRunning} onSelect={() => invoke("stop_sidecar")}>
  Parar
</MenuItem>
```

Copy em português (coerente com "Abrir"/"Parar"/"Nenhum run ativo"). Motion honra
`prefers-reduced-motion`; contraste WCAG AA em light **e** dark.

## Testing Strategy

Padrão AAA; ≥80% de cobertura no código novo.

- **Menu/MenuItem** (vitest + Testing Library): renderiza itens + ícones + `role`;
  `disabled` recebe `aria-disabled` e **não** dispara `onSelect`; separadores presentes;
  `onSelect` no click/Enter.
- **icons:** smoke render (monta, `aria-hidden`, usa `currentColor`).
- **Glance** (atualizar): itens Abrir/Parar/Sobre/Sair presentes; **Parar desabilitado
  quando idle**, habilitado quando `running`; cada item chama o `invoke` correto (mock
  de `@tauri-apps/api/core`); header de status ainda renderiza.
- **About:** mostra versão (mock `getVersion`), tagline, autor; click nos links chama o
  opener (mock).
- **Rust:** manter os testes de `panel.rs`. `confirm_quit_if_running`: o ramo não-dialog
  (`!is_running` → `true`) é testável; o ramo com diálogo é validado manualmente.
- **Manual/visual:** popover com cara de menu (borda/rim/material) em light+dark; hover
  e teclado (↑/↓/Enter/Esc); "Sobre" abre com versão certa e links vivos; "Sair" com/sem
  Run ativo.
- **Regressão:** `App.test.tsx` e demais suites verdes; `npm run typecheck` limpo.

## Boundaries

- **Always:**
  - Só tokens de `tokens.css` — zero hex/cor/spacing/tipografia hardcoded (varre o diff).
  - Temas claro **e** escuro completos; honrar `prefers-reduced-motion`.
  - Set de estados completo em todo interativo (default/hover/focus-visible/active/disabled).
  - Acessibilidade: `role="menu"`/`"menuitem"`, `aria-disabled`, ícones `aria-hidden`,
    navegação por teclado (↑/↓ mover, Enter ativar, Esc fecha o popover), foco visível.
  - **Versão single-sourced**: raiz `package.json` (já 0.3.0) é a fonte; `tauri.conf.json`
    a referencia via path-ref (`../../../package.json`); "Sobre" lê via `getVersion()`.
  - Preservar o overlay NSPanel em apps fullscreen (não regredir `panel.rs`).
- **Resolvido no refino** (ver §Decisões do /devy:refine):
  - `tauri-plugin-opener` — **sim**, adicionar (host-scoped).
  - Material do NSPanel — **`Menu`** (validar visualmente no build; não regredir overlay).
  - Realce de hover — **accent cheio** (`--accent` + `--accent-ink`); item disabled isento.
  - Janela "Sobre" — **titlebar overlay** (`titleBarStyle:"Overlay"` + `hiddenTitle`).
- **Never:**
  - Sobrescrever `CONTEXT.md`/docs do motor na raiz do monorepo.
  - Emoji ou glyph ASCII como ícone de menu (anti-ref DESIGN.md).
  - Burlar o guard de "Run ativo" no quit.
  - Mutar estado (padrões imutáveis) ou hardcodar cor/valor mágico.
  - Editar código do engine (`src/` na raiz) a partir desta change.

## Success Criteria

1. `npm run typecheck && npm run lint && npm test` verdes na raiz (com os testes novos/atualizados).
2. **Chrome de menu:** clicar na tray abre um popover com aparência de menu nativo —
   borda hairline clara com **rim no topo** (pseudo-gradiente), **material de menu**
   (fundo mais sólido), tipografia/cor de menu. Correto em light **e** dark.
3. **Estrutura:** header de status glanceável → separador → **Abrir**/**Parar** →
   separador → **Sobre**/**Sair**, cada item com **ícone monocromático**.
4. **Parar** desabilitado quando não há run; habilitado quando `running` (`aria-disabled`).
5. **Sobre** abre a janela dedicada com wordmark, **versão 0.3.0**, tagline, links
   GitHub/npm que abrem no navegador, e autor/copyright.
6. **Sair** encerra o app; com Run ativo exibe o confirm, idle sai direto — o guard
   **não** é burlado (Cmd+Q e "Sair" compartilham `confirm_quit_if_running`).
7. Navegação por teclado (↑/↓/Enter/Esc) e foco visível funcionam no popover.
8. Zero cor hardcoded no diff do webview; `panel.rs` mantém o overlay fullscreen.

## Assumptions

Confirmadas com o usuário (via `AskUserQuestion`) antes deste spec:

1. **Tela "Sobre" = janela Tauri dedicada** (~360×320) — não painel nativo do AppKit,
   não view na janela principal.
2. **Popover = status header + menu** — não menu puro (o status glanceável fica).
3. **Conteúdo do "Sobre"** = wordmark + versão + tagline + links (GitHub, npm) + autor/copyright.
4. **Ícones = SVG monocromático inline** estilo SF Symbols (não emoji/ASCII), `currentColor`.
5. **Parar** é renderizado sempre e **desabilitado** quando idle (não escondido).
6. id da change = `C-0012-popover-menu-about` (slot livre após C-0011).
7. Este spec vive na pasta da change, não na raiz.

## Decisões do /devy:refine

Entrevista de refino (2026-07-11) — cada branch resolvida com o usuário via `AskUserQuestion`:

1. **Material do NSPanel → `NSVisualEffectMaterial::Menu`** (era `Popover`). Backdrop mais
   sólido/opaco, fiel a um `NSMenu` nativo. Mantém corner radius (10pt) + rim. Validação
   visual em light+dark é gate do build (não regredir o overlay fullscreen do `panel.rs`).
2. **Realce do item highlighted (hover **e** foco ↑/↓) → fill accent cheio** (`--accent` +
   ícone/label em `--accent-ink`), exatamente como o `NSMenu` nativo. On-doctrine: DESIGN.md
   trata "current selection" como accent, e só **uma** linha acende por vez, transitória —
   não dilui o beacon de aprovação persistente. **Item disabled ("Parar" idle) nunca acende.**
3. **Abrir links externos → `tauri-plugin-opener`** (plugin oficial v2, sucessor do
   `shell.open`). `import { openUrl } from "@tauri-apps/plugin-opener"`. Permissão
   `opener:allow-open-url` **host-scoped** aos dois destinos: `github.com/hgflima/loopy` e
   `npmjs.com/package/@hgflima/loopy`. Versão pinada via Context7 no plano.
4. **Janela "Sobre" → titlebar overlay/transparente** (`titleBarStyle:"Overlay"` +
   `hiddenTitle:true`): traffic lights flutuam sobre o conteúdo, sem faixa de título "Sobre".
   Mantém gestão de janela nativa (close/drag/Cmd+W de graça). Header com
   `data-tauri-drag-region` e `padding-top` que livra os traffic lights. ~360×320,
   `resizable:false`, centralizada.
5. **Versão single-sourced → raiz `package.json` via path-ref.** `tauri.conf.json`
   `"version": "../../../package.json"` (resolve, a partir de `src-tauri/`, para a raiz do
   monorepo — já 0.3.0). `getVersion()` passa a refletir a versão do produto sem bump extra.
   O plano confirma o suporte a path-ref no Tauri v2 via Context7; fallback = script de
   prebuild sync se não suportado. `apps/menubar/package.json` deixa de ser autoritativo p/
   versão (pode ser alinhado a 0.3.0 por higiene, mas não é a fonte).
6. **Glyphs dos ícones** (16×16, `currentColor`, `aria-hidden`, estilo SF Symbols):
   - **Abrir** → glyph de janela (`macwindow`: retângulo arredondado com barra superior).
   - **Parar** → `stop.fill` (quadrado arredondado preenchido).
   - **Sobre** → `info.circle` (círculo com "i").
   - **Sair** → `power` (⏻: anel com quebra no topo + haste).

**Decisões de segunda-ordem** (build, sem bloqueio — derivadas das acima):

- **Semântica de menu nativo:** toda ativação (Abrir/Parar/Sobre/Sair) **fecha o popover**
  (como um `NSMenu`) — inclusive **Parar** (feedback vem pelo badge/título da tray). `Esc`
  fecha; **sem highlight de repouso ao abrir** (arrow-key inicia o roving a partir do topo);
  foco visível honrado. Reusa o caminho de resign-key/`hide_popover_panel` do `panel.rs`.
- **Capabilities:** adicionar `about` à lista de janelas + `opener:allow-open-url`
  host-scoped aos dois destinos.
- **Copy do "Sobre":** tagline reaproveita a `description` da raiz ("Motor de loop agêntico
  config-driven via ACP") como copy PT hardcoded. Copyright = "© Henrique Lima", ano via
  `new Date().getFullYear()` (sem magic number que envelhece).
