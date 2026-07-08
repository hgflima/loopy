# loopy — Logo Prompts

Generated: 2026-07-08 · From `LOGO-SPEC.md`
Mark: **combination** (geometric loop symbol + `loopy` wordmark) · Character: **precise, geometric** · Color: **loopy magenta `#C4207E`** (mono ink `#191B1D`, reversed `#FCFCFC`)

> Design the **symbol at 16×16 first** — it must survive as a favicon and a monochrome macOS tray template. Generate the icon and the wordmark **separately**, then assemble the lockup by hand for crisp kerning.

---

## Midjourney

### Primary symbol (icon)
```
minimalist logo icon for a developer tool called loopy, a single continuous geometric loop, a clean recirculation arrow that closes on itself into a cycle, one uniform stroke weight, optically balanced, arrowhead marking direction, solid magenta #C4207E on transparent, flat vector, no gradient no shadow, macOS SF Symbols quality, reads at 16px, professional software branding --v 6 --style raw --ar 1:1 --no text letters words 3d bevel glow robot gear
```

### Icon variant — monochrome / tray template
```
minimalist single-color app icon, one continuous geometric loop / return-arrow cycle, uniform stroke, pure black on transparent, macOS menubar template icon style, crisp at 18px, flat, geometric --v 6 --style raw --ar 1:1 --no color text 3d shadow
```

### Wordmark variant
```
lowercase wordmark logotype "loopy", SF Pro / -apple-system style semibold sans-serif, tight tracking, the doubled o subtly echoing a loop, ink #191B1D on white, clean confident typography, professional software brand --v 6 --style raw --ar 3:1 --no icon symbol serif 3d
```

### Full lockup
```
horizontal logo lockup: a geometric magenta loop symbol on the left, the lowercase wordmark "loopy" on the right, SF Pro semibold, balanced spacing, magenta #C4207E and ink #191B1D, flat vector, minimal, developer-tool branding --v 6 --style raw --ar 3:1 --no gradient 3d shadow glow
```

---

## DALL-E

### Primary symbol
```
A minimalist logo icon for a developer tool named "loopy". The mark is a single continuous geometric loop — a clean recirculation arrow that closes on itself to form a cycle, drawn with one uniform stroke weight and a single arrowhead showing direction. Solid magenta (#C4207E) on a transparent background. Flat vector, no gradients, no shadows, no 3D. The geometry should feel as precise and system-native as an Apple SF Symbol, and stay legible at 16×16 pixels. Serious, engineered, professional software branding.
```

### Icon variant (monochrome tray)
```
A single-color, flat app icon: one continuous geometric loop / return-arrow forming a closed cycle, uniform stroke weight, pure black on transparent, in the style of a macOS menubar template icon. Crisp and readable at 18 pixels. No color, no text, no shadow.
```

### Wordmark variant
```
A typography-only logo for "loopy", all lowercase, set in an SF Pro / San Francisco-style semibold sans-serif with tight letter-spacing. The two o's subtly suggest the roundness of a loop without being a gimmick. Ink color #191B1D on white. Clean, confident, readable at small sizes.
```

---

## Ideogram

### Primary symbol
```
Logo icon: loopy | Concept: a single continuous geometric loop, a recirculation arrow closing into a cycle | Style: minimalist, optically-precise, SF Symbols-grade geometry | Stroke: one uniform weight | Color: solid magenta #C4207E on transparent | Constraint: legible at 16px | Quality: professional developer-tool branding, flat vector, no gradient no shadow
```

### Full lockup (with typography)
```
"loopy" combination logo: geometric magenta loop symbol + lowercase SF Pro semibold wordmark, tight tracking, magenta #C4207E and ink #191B1D, flat, minimal, engineered feel, professional software brand
```

---

## Generic (any AI image tool)

### Primary logo — combination mark
Create a **combination logo** for a developer tool called **loopy** (always lowercase).

- **Symbol:** a single continuous **geometric loop** — a clean recirculation / return arrow that closes on itself to express "an agentic loop that iterates until done." One uniform stroke weight, optically-corrected curves, a single arrowhead for direction.
- **Character:** precise and geometric — it should feel like it was drawn with the same discipline as a design-token file or an Apple SF Symbol. Serious, reliable, engineered.
- **Wordmark:** lowercase `loopy` in an SF Pro / `-apple-system` semibold sans-serif, tight tracking; the doubled `oo` may subtly echo the loop.
- **Colors:** loopy magenta `#C4207E` for the symbol; ink `#191B1D` for the wordmark. Provide monochrome-ink and reversed-white variants too.
- **Requirements:** flat vector; transparent background; works on light AND dark; legible at 16×16 (favicon + macOS tray); scalable to 1024 for the app icon.

**Avoid:** gradients, 3D, bevels, shadows, glow; robots / gears / AI clichés; chat bubbles; terminal `>_`; cartoonish hand-drawn wobble; multi-color symbols.

---

## Favicon & Tray (simplify the symbol)

```
Ultra-minimal favicon: the loopy loop symbol only (no wordmark), one continuous geometric return-arrow cycle, uniform stroke, solid magenta #C4207E, ~12% safe-area padding, high contrast, crisp clean edges, readable at 16×16 pixels, flat, transparent background
```

**Tray-icon note:** for the macOS menubar, render the SAME symbol as a **monochrome black template** on transparent (no magenta) — macOS auto-tints template images to the menubar state. Target 18×18 (@1x) and 36×36 (@2x).

**Favicon checklist:**
1. Strip the wordmark — keep the loop symbol only.
2. Preview at 16×16 and 32×32; thicken the stroke if the loop's counter closes up.
3. Add ~12% safe-area padding.
4. Verify contrast on both a white and a dark browser tab.
5. Export the full set (see `LOGO-SPEC.md` → Favicon Set) + the monochrome tray template into `apps/menubar/src-tauri/icons/`.
