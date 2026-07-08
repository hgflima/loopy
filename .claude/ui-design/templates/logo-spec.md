# Logo Specification

> Brand identity specification for [App Name]

Last updated: [date]

## Brand Identity

**Name:** [App Name]
**Tagline:** [Tagline if any]
**Description:** [One sentence description]
**Target Audience:** [Primary users]

## Style Direction

### Logo Type

- [ ] Wordmark (text-based)
- [ ] Icon-only (symbol)
- [ ] Combination (icon + text)
- [ ] Lettermark (initials)
- [ ] Emblem (text inside symbol)

### Style Keywords

**Primary Style:** [minimalist / geometric / organic / abstract / illustrative]
**Mood:** [professional / playful / modern / classic / bold / calm]

### Do

- [Positive direction 1]
- [Positive direction 2]
- [Positive direction 3]

### Avoid

- [Avoid 1]
- [Avoid 2]
- [Avoid 3]

## Colors

### Brand Colors

| Role | Color | Hex | Token Reference |
|------|-------|-----|-----------------|
| Primary | [name] | [#hex] | color.primary.default |
| Secondary | [name] | [#hex] | color.secondary.default |
| Accent | [name] | [#hex] | color.accent.default |

### Background Compatibility

- [x] Light backgrounds (white, light gray)
- [x] Dark backgrounds (dark gray, black)
- [ ] Transparent (PNG with alpha)

### Color Variants

| Variant | Use Case |
|---------|----------|
| Full color | Primary usage |
| Monochrome dark | Light backgrounds |
| Monochrome light | Dark backgrounds |
| Single color | Limited color contexts |

## Visual Elements

### Symbol/Icon

**Description:** [Describe the core visual element]
**Visual Metaphor:** [What concept it represents]
**Geometric Basis:** [Circle, square, triangle, custom]

### Typography (if wordmark/combination)

**Font Style:** [Sans-serif / Serif / Custom / Display]
**Weight:** [Light / Regular / Medium / Bold]
**Treatment:** [Normal / All caps / Title case]
**Letterform Notes:** [Any specific letter modifications]

## Inspiration

### Reference Logos

| Logo | What to Take | What to Avoid |
|------|--------------|---------------|
| [Company 1] | [Specific element] | [What not to copy] |
| [Company 2] | [Specific element] | [What not to copy] |
| [Company 3] | [Specific element] | [What not to copy] |

### Visual Metaphors

| Concept | Visual Representation |
|---------|----------------------|
| [Concept 1] | [Visual element] |
| [Concept 2] | [Visual element] |

## Technical Requirements

### Primary Use

- [x] Web (browser, favicon)
- [ ] iOS App
- [ ] Android App
- [ ] Print materials
- [ ] Social media

### Minimum Sizes

| Context | Minimum Size | Notes |
|---------|--------------|-------|
| Favicon | 16x16 px | Must be recognizable |
| App icon | 48x48 px | Simplified version |
| Header | 32px height | With text |
| Full logo | 200px width | Maximum detail |

### Required Formats

| Format | Size | Use Case |
|--------|------|----------|
| SVG | Vector | Primary, scalable |
| PNG | 512x512 | High-res raster |
| PNG | 256x256 | Standard raster |
| PNG | 128x128 | Medium raster |
| ICO | 16,32,48 | Windows favicon |

## Favicon Set (Web)

| Size | Filename | Purpose |
|------|----------|---------|
| 16x16 | favicon-16x16.png | Browser tab |
| 32x32 | favicon-32x32.png | Browser tab (retina) |
| 48x48 | favicon-48x48.png | Windows site icon |
| 180x180 | apple-touch-icon.png | iOS home screen |
| 192x192 | android-chrome-192x192.png | Android Chrome |
| 512x512 | android-chrome-512x512.png | Android splash |
| 150x150 | mstile-150x150.png | Windows tile |
| any | favicon.ico | Legacy browsers |

### Favicon HTML

```html
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
```

### site.webmanifest

```json
{
  "name": "[App Name]",
  "short_name": "[Short Name]",
  "icons": [
    {
      "src": "/android-chrome-192x192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/android-chrome-512x512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ],
  "theme_color": "[primary color hex]",
  "background_color": "[background color hex]",
  "display": "standalone"
}
```

## App Icons (Mobile)

### iOS

| Size | Scale | Context |
|------|-------|---------|
| 1024x1024 | 1x | App Store |
| 180x180 | 3x | iPhone |
| 167x167 | 2x | iPad Pro |
| 152x152 | 2x | iPad |
| 120x120 | 2x/3x | iPhone Spotlight |
| 87x87 | 3x | iPhone Settings |
| 80x80 | 2x | iPad Spotlight |
| 76x76 | 1x | iPad |
| 60x60 | 1x | iPhone |
| 58x58 | 2x | iPhone Settings |
| 40x40 | 2x | Spotlight |
| 29x29 | 1x | Settings |
| 20x20 | 1x | Notification |

### Android

| Size | Density | Context |
|------|---------|---------|
| 512x512 | xxxhdpi | Play Store |
| 192x192 | xxxhdpi | Launcher |
| 144x144 | xxhdpi | Launcher |
| 96x96 | xhdpi | Launcher |
| 72x72 | hdpi | Launcher |
| 48x48 | mdpi | Launcher |
| 36x36 | ldpi | Launcher |

## Usage Guidelines

### Clear Space

Minimum clear space around logo: [X]px or [X]% of logo height

```
    ┌──────────────────────┐
    │                      │
    │   ┌──────────────┐   │
    │   │              │   │
    │   │    LOGO      │   │
    │   │              │   │
    │   └──────────────┘   │
    │                      │
    └──────────────────────┘
         ↑ Clear space
```

### Incorrect Usage

- [ ] Do not stretch or distort
- [ ] Do not change colors outside palette
- [ ] Do not add effects (shadow, glow)
- [ ] Do not place on busy backgrounds
- [ ] Do not rotate
- [ ] Do not crop

## Status

| Item | Status | Notes |
|------|--------|-------|
| Specification | Complete | [date] |
| Prompts generated | Complete | [tools] |
| Logo created | Pending | - |
| Favicon set | Pending | - |
| App icons | Pending | - |

---

## AI Generation Prompts

See `.harn/design/ui-exports/logo-prompts.md` for copy-paste ready prompts.
