# loopy — Brand Asset Set

Complete icon/logo set generated from the source concept. The symbol was rebuilt
as clean, self-contained vector (SVG paths — no external font dependency) and all
raster sizes are rendered from that vector master.

## Brand values
- **Gradient:** `#E62A88` → `#A5145F` (linear, top-left → bottom-right)
- **Flat brand:** `#BD2172`
- **Ink / black:** `#17171A`
- **App-icon background:** `#26262B`

## Folder structure

```
loopy-brand/
├── PREVIEW.png                      ← visual overview of the whole set
├── source/
│   └── loopy-concept-original.jpg   original concept reference (nano-banana)
├── svg/
│   ├── symbol/                      symbol only (all lockups build from this)
│   │   ├── loopy-symbol-gradient.svg
│   │   ├── loopy-symbol-black.svg
│   │   ├── loopy-symbol-white.svg
│   │   ├── loopy-symbol-brand.svg   (flat #BD2172)
│   │   └── loopy-symbol-mono-black.svg (pure #000 — tray/template source)
│   ├── icon/
│   │   └── loopy-icon-rounded-dark.svg  (rounded-square dark app icon)
│   ├── wordmark/
│   │   ├── loopy-wordmark-black.svg
│   │   └── loopy-wordmark-white.svg
│   └── lockup/                      symbol + wordmark
│       ├── loopy-lockup-horizontal-{gradient,black,white}.svg
│       └── loopy-lockup-stacked-{gradient,black,white}.svg
├── png/
│   ├── symbol-transparent/          loopy-symbol-{1024,512,256,128}.png
│   └── icon-rounded-dark/           loopy-icon-{1024,512,256,128}.png
├── favicon/
│   ├── favicon-16x16.png / 32 / 48  (transparent symbol)
│   ├── favicon.ico                  (16 + 32 + 48, multi-res)
│   ├── apple-touch-icon.png         (180, full-bleed opaque)
│   └── android-chrome-192x192.png / 512x512
├── windows/
│   ├── loopy.ico                    (16→256 multi-res app icon)
│   └── favicon.ico
└── macos/
    ├── AppIcon.icns                 (Retina sizes, ready for Tauri)
    ├── AppIcon.iconset/             (all 10 sizes — run `iconutil` for a full .icns)
    └── tray/                        monochrome menubar templates (transparent)
        ├── loopy-trayTemplate.png / @2x     (18 / 36)
        └── loopy-tray-22Template.png / @2x  (22 / 44)
```

## Usage notes

**Web** — drop `favicon/` into your site root:
```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```
Add a `site.webmanifest` referencing the two `android-chrome` PNGs.

**Tauri (`apps/menubar/src-tauri/icons/`)** — use `macos/AppIcon.icns` and
`windows/loopy.ico`. The `tray/` PNGs are macOS **template images**: keep the
`…Template` suffix so macOS auto-recolors them (black↔white) to match the menubar.
They contain only the symbol (no wordmark), monochrome, transparent — per spec.

**Regenerate / tweak** — the source generator is `loopy.py` + `build.py` (kept in the
project working folder). Adjust colors or geometry there and re-run `python3 build.py`.

## Notes on fidelity
The symbol is a mathematically clean figure-8 (Gerono lemniscate) ribbon with a
downward arrowhead, matching the source concept. The wordmark uses Poppins Bold with
the signature “oo → linked-loop” ligature echoing the mark; all glyphs are flattened
to vector paths so the SVGs render identically anywhere without the font installed.
