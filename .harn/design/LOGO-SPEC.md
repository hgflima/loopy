# Logo Specification

Last updated: 2026-07-08

## Brand Identity

**Name:** loopy (always lowercase)
**Tagline:** Config-driven agentic loop engine
**Description:** A CLI + native macOS menubar app that drives a coding agent through a backlog of tasks by interpreting a `loopy.yml` — a generic engine that runs *whatever loop the config declares*, not a hardcoded pipeline.

**Brand seed:** hue 355 → resolves to the signature loopy magenta at hue 352.

## Style Direction

**Logo Type:** Combination mark — a precise geometric loop symbol + the lowercase `loopy` wordmark.
Three deliverables from one system:
- **Icon alone** → menubar tray icon, favicon, app icon (`.icns`), DMG.
- **Horizontal lockup** (icon + wordmark) → README header, website, DMG background, GitHub social card.
- **Wordmark alone** → inline text contexts, footer.

**Style:** Minimalist, geometric, optically-constructed. The symbol is the *sibling of `apps/menubar/src/ui/tokens.css`* — same engineering discipline: uniform stroke weight, calculated corner radii, deliberate optical balance.

**Mood:** Serious, reliable, engineered. "A motor you trust with a long-running loop." Restraint over decoration — the same doctrine that governs the app's UI (neutrals carry ~90%, color is spent only on meaning).

**Do:**
- Build the loop from a single uniform-weight stroke that returns on itself (a clean recirculation glyph / return-arrow that closes the cycle).
- Keep it legible and balanced at 16×16 — the symbol must survive as a browser-tab favicon and a monochrome macOS template tray icon.
- Match the wordmark to the app's type voice: `-apple-system` / SF Pro Text feel, semibold (~590–600), tight tracking (~-0.01em), all lowercase.
- Hint the two-level loop (outer task loop / inner verify loop) only if it survives at small sizes — otherwise favor a single clean cycle.

**Don't:**
- No gradients, no 3D, no bevels, no drop shadows, no glow — the app design is flat until it floats.
- No literal robot/gear/AI clichés, no chat bubbles, no terminal-prompt `>_` motif.
- No cartoonish or hand-drawn "loopy = crazy" wobble — the name's playful sense is deliberately *not* taken literally here.
- No multi-color symbol; the mark is one solid color with monochrome fallbacks.

## Colors

Grounded in the shipped tokens (`apps/menubar/src/ui/tokens.css`, `apps/menubar/DESIGN.md`).

**Primary (accent — loopy magenta):** `oklch(0.55 0.21 352)` ≈ `#C4207E`
**Primary (dark-theme mirror):** `oklch(0.57 0.21 352)` ≈ `#CB2984`
**Ink (monochrome variant):** `oklch(0.22 0.005 260)` ≈ `#191B1D`
**Reversed (on dark / on magenta):** `oklch(0.99 0 0)` ≈ `#FCFCFC`

The primary lockup uses the **solid loopy magenta symbol**. A logo lives outside the product chrome, so full-magenta here is on-brand (it *is* the brand seed) and does not violate the in-app "Accent-Means-You" rule. Always ship monochrome ink + reversed white variants for constrained contexts (template tray icon, single-color print, dark surfaces).

**Background Compatibility:**
- [x] Light backgrounds — magenta symbol, ink wordmark
- [x] Dark backgrounds — dark-mirror magenta symbol, white wordmark
- [x] Transparent — required for tray icon + favicon
- [x] Monochrome — macOS template image (tray auto-tints to menubar state)

## Visual Elements

**Symbols/Icons:** A single-stroke geometric loop — a return/recirculation arrow that closes on itself, expressing the core domain (an agentic loop that iterates a backlog until done). Uniform stroke, optically-corrected curvature, one arrowhead marking the direction of the cycle.
**Typography Style:** Sans-serif, SF Pro Text voice — `-apple-system, 'SF Pro Text', system-ui, sans-serif`. Lowercase `loopy`, semibold, tight tracking. Consider the doubled `oo` echoing the loop's roundness without becoming a gimmick.
**Visual Metaphors:** the loop / the cycle / iterate-until-done; the two-level loop (outer = backlog of tasks, inner = verify-retry); recirculation; a closed feedback path.

## Inspiration

| Reference | What to Take |
|-----------|--------------|
| macOS SF Symbols (`arrow.triangle.2.circlepath`, `arrow.clockwise`) | The clean, system-native geometry of a recirculation glyph — the *quality bar* for the symbol at small sizes |
| Vercel / Linear marks | Restraint, single-color confidence, flawless favicon behavior |
| The app's own `tokens.css` | Same optical discipline: uniform stroke, calculated radii, no decoration |

## Technical Requirements

**Primary Use:** macOS desktop app (menubar) + web (README / site / social card) + CLI/npm brand.
**Minimum Size:** must read at 16×16 (favicon + tray). Design the symbol at 16px first, scale up.

### Required Formats

| Format | Size | Use Case |
|--------|------|----------|
| SVG | Vector | Primary source, scalable, all lockups |
| PNG | 1024×1024 | Master render, `.icns` source |
| PNG | 512×512 | High-res / stores |
| PNG | 256×256 | Standard |
| PNG | 128×128 | Medium |
| ICNS | Multi | macOS app bundle (`apps/menubar/src-tauri/icons/`) |
| ICO | Multi | Windows / web favicon |
| PNG (template) | 44×44 @2x | macOS menubar tray icon (monochrome, transparent) |

### Favicon Set (Web)

| Size | File | Use |
|------|------|-----|
| 16×16 | favicon-16x16.png | Browser tab |
| 32×32 | favicon-32x32.png | Browser tab (retina) |
| 48×48 | favicon-48x48.png | Windows site |
| 180×180 | apple-touch-icon.png | iOS home screen |
| 192×192 | android-chrome-192x192.png | Android |
| 512×512 | android-chrome-512x512.png | Android splash |

### macOS App / Tray Icons

| Asset | Sizes | Use |
|-------|-------|-----|
| AppIcon (`.icns`) | 1024, 512, 256, 128, 64, 32, 16 (@1x + @2x) | Dock / Finder / DMG |
| Tray template | 18×18, 36×36 (@2x) | Menubar — **monochrome template**, symbol only, no wordmark |

> **Tauri note:** app-icon assets belong in `apps/menubar/src-tauri/icons/`. The tray icon is a **template image** (transparent + single-color) so macOS auto-tints it to the menubar appearance — never bake magenta into the tray asset; use the monochrome symbol.

## Realization Checklist

> **Realized 2026-07-08 →** the system lives in [`logo/`](./logo/) (parametric,
> reproducible via `gen_symbol.py` + `export.py`; overview in `logo/brand-sheet.png`).

1. [x] Design the symbol at 16px first (favicon/tray is the hardest constraint). — validated via pixel zoom.
2. [x] Generate concepts with the prompts in `ui-exports/logo-prompts.md`. — drawn directly as parametric SVG.
3. [x] Redraw the winner as clean vector SVG (uniform stroke, snapped to grid). — `logo/src/symbol-*.svg`.
4. [x] Produce 3 color variants: magenta, ink-monochrome, reversed-white. — `logo/src/` + `logo/png/`.
5. [x] Build the horizontal lockup + define clear-space and min-size rules. — `logo/src/lockup-*.svg`, `logo/README.md`.
6. [x] Export the favicon set, `.icns` source, and the monochrome tray template. — `logo/favicon/`, `logo/png/appicon-1024.png`, `logo/tray/`.
7. [ ] Drop the tray template into `apps/menubar/src-tauri/icons/` and wire it in `tauri.conf.json`. — **pending** (touches the shipping app).
