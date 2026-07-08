# loopy — logo system

Combination mark: a single-stroke geometric recirculation loop (magenta) + the
lowercase `loopy` wordmark set in SF Pro semibold. Drawn to the discipline of
`LOGO-SPEC.md` — SF-Symbols-grade geometry, uniform stroke, one arrowhead,
legible at 16×16.

The symbol is **generated parametrically** (not hand-drawn) so it can be retuned
and re-exported deterministically. Everything here is reproducible with:

```bash
cd .harn/design/logo
python3 gen_symbol.py src   # symbol SVG variants
python3 export.py           # all SVGs, PNGs, favicons, tray
python3 sheet.py            # brand-sheet.png overview
```

Requires `cairosvg` + `Pillow` (already present in the local env).

## Colors

| Token | Hex | Use |
|-------|-----|-----|
| magenta | `#C4207E` | primary symbol (light backgrounds) |
| dark-mirror | `#CB2984` | symbol on dark backgrounds |
| ink | `#191B1D` | wordmark on light |
| reversed | `#FCFCFC` | wordmark / symbol on dark |

Grounded in `apps/menubar/src/ui/tokens.css`. A logo lives outside product chrome,
so full-magenta symbol is on-brand here (it *is* the brand seed) and does not
violate the in-app "Accent-Means-You" rule.

## Files

```
src/                       vector source (SVG)
  symbol-{magenta,ink,white}.svg   tight symbol, viewBox fit to ink
  icon-magenta.svg                 symbol centred in 24-box w/ 12% safe area (app-icon master)
  wordmark-{ink,white}.svg         live-text wordmark (font-family: -apple-system)
  lockup-{light,dark}.svg          live-text horizontal lockup
png/
  symbol-magenta-{1024,512,256,128}.png   symbol masters, 12% safe area
  symbol-{ink,white}-1024.png
  appicon-1024.png                 .icns / .ico source (14% safe area)
  wordmark-{ink,white}.png
  lockup-{light,dark}.png          on solid bg
  lockup-transparent-{ink,white}.png
favicon/
  favicon-{16,32,48}x*.png · favicon.ico · apple-touch-icon.png (180)
  android-chrome-{192,512}.png
tray/
  loopyTemplate.png (18) · loopyTemplate@2x.png (36)   macOS menubar template
brand-sheet.png            full-system overview
```

## Web — favicon `<head>` tags

```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="192x192" href="/android-chrome-192x192.png">
<link rel="icon" type="image/png" sizes="512x512" href="/android-chrome-512x512.png">
```

For an inline SVG favicon that recolors in dark mode, embed `src/symbol-magenta.svg`.

## macOS tray + app icon (Tauri)

- **Tray:** `tray/loopyTemplate.png` (+`@2x`) is a **pure-black template image** on
  transparent — macOS auto-tints it to the menubar state. Never bake magenta into
  the tray asset. Wire it in `tauri.conf.json` and mark it as a template image.
- **App icon:** build `.icns` from `png/appicon-1024.png` and drop the generated set
  into `apps/menubar/src-tauri/icons/` (`tauri icon png/appicon-1024.png`).

## Clear space & min size

- **Clear space:** keep a margin of ½ the symbol height around the lockup.
- **Min size:** symbol 16px; lockup 20px tall (below that, use the symbol alone).
- **Don't:** recolor the symbol multi-tone, add effects, or set the wordmark in
  anything but SF Pro / `-apple-system` semibold.

## Geometry (24-grid, in `gen_symbol.py`)

Ring centreline radius `R=7.7`, uniform stroke `W=2.9`, arrowhead at the top
(12 o'clock) pointing clockwise, arc sweep `322°` (38° gap). Retune the constants
at the top of `gen_symbol.py` and re-run `export.py`.
