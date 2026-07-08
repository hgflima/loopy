# /ui:logo

Generate app logos and favicons with guided questions and AI-optimized prompts.

<command_definition>
name: logo
description: Create logo and favicon specifications with prompts for AI image generators
usage: /ui:logo [options]
options:
  - name: --refresh
    description: Regenerate prompts for existing logo spec
  - name: --favicon-only
    description: Generate only favicon prompts from existing logo
  - name: --export [tool]
    description: Export prompts for specific tool (midjourney, dalle, ideogram, generic)
</command_definition>

<execution_flow>

## Phase 1: Discovery Questions

Ask questions to understand the logo requirements. Gather information conversationally.

### Essential Questions

**1. App Identity**
- "What is the name of your app/product?"
- "What does your app do in one sentence?"
- "What feeling should users get from your brand?" (professional, playful, modern, classic, etc.)

**2. Style Direction**
- "Do you prefer a wordmark (text-based), icon-only, or combination mark?"
- "Any styles to avoid?" (gradients, 3D, cartoonish, etc.)
- "Minimalist or detailed?"

**3. Color Preferences**
- Check if design-tokens.json exists → "Should I use your existing brand colors?"
- If no tokens: "What colors represent your brand?"
- "Should the logo work on both light and dark backgrounds?"

**4. Inspiration**
- "Any logos you admire?" (companies, styles)
- "Any visual metaphors related to your product?"
- "Should it include any symbols or icons?"

**5. Technical Requirements**
- "What platforms will this be used on?" (web, iOS, Android, all)
- "Do you need a favicon set for web?"
- "Any specific sizes needed?"

### Optional Deep-Dive

If user wants more refinement:
- "What's your target audience?"
- "Any industry conventions to follow or break?"
- "Should it work as a small icon (16x16)?"

</execution_flow>

<output_specification>

## Logo Specification File

Create `.harn/design/LOGO-SPEC.md`:

```markdown
# Logo Specification

Last updated: [date]

## Brand Identity

**Name:** [App Name]
**Tagline:** [if any]
**Description:** [one sentence]

## Style Direction

**Logo Type:** [wordmark / icon / combination]
**Style:** [minimalist / detailed / geometric / organic / etc.]
**Mood:** [professional / playful / modern / classic / etc.]

**Do:**
- [positive direction 1]
- [positive direction 2]

**Don't:**
- [avoid 1]
- [avoid 2]

## Colors

**Primary:** [color] — [hex/token reference]
**Secondary:** [color] — [hex/token reference]
**Accent:** [color] — [hex/token reference]

**Background Compatibility:**
- [ ] Light backgrounds
- [ ] Dark backgrounds
- [ ] Transparent

## Visual Elements

**Symbols/Icons:** [description if any]
**Typography Style:** [sans-serif / serif / custom / none for icon-only]
**Visual Metaphors:** [related concepts]

## Inspiration

| Reference | What to Take |
|-----------|--------------|
| [Company/Logo 1] | [specific element] |
| [Company/Logo 2] | [specific element] |

## Technical Requirements

**Primary Use:** [web / mobile / print / all]
**Minimum Size:** [smallest readable size]

### Required Formats

| Format | Size | Use Case |
|--------|------|----------|
| SVG | Vector | Primary, scalable |
| PNG | 512x512 | High-res |
| PNG | 256x256 | Standard |
| PNG | 128x128 | Medium |
| ICO | Multi | Windows favicon |

### Favicon Set (Web)

| Size | File | Use |
|------|------|-----|
| 16x16 | favicon-16x16.png | Browser tab |
| 32x32 | favicon-32x32.png | Browser tab (retina) |
| 48x48 | favicon-48x48.png | Windows site |
| 180x180 | apple-touch-icon.png | iOS home screen |
| 192x192 | android-chrome-192x192.png | Android |
| 512x512 | android-chrome-512x512.png | Android splash |
| 150x150 | mstile-150x150.png | Windows tile |

### App Icons (Mobile)

| Platform | Sizes |
|----------|-------|
| iOS | 1024, 180, 167, 152, 120, 87, 80, 76, 60, 58, 40, 29, 20 |
| Android | 512, 192, 144, 96, 72, 48, 36 |
```

</output_specification>

<prompt_generation>

## AI Image Generator Prompts

Generate optimized prompts for each tool:

### Midjourney Format

```markdown
## Midjourney Prompt

### Primary Logo
[app name] logo, [style] design, [mood] aesthetic, [color description], [visual elements], minimal, vector style, professional branding, clean lines, scalable --v 6 --style raw --ar 1:1

### Icon Variant
[app name] app icon, [style] design, [visual metaphor], [colors], simple geometric shapes, flat design, mobile app icon style --v 6 --style raw --ar 1:1

### Wordmark Variant
[app name] wordmark, [typography style] font, [style] lettering, [colors], professional typography, clean readable text --v 6 --style raw --ar 3:1

### Negative Prompt
--no text, letters, words, watermark, signature, [avoided elements]
```

### DALL-E Format

```markdown
## DALL-E Prompt

### Primary Logo
A [style] logo design for "[app name]", featuring [visual elements]. The design should feel [mood] and use [colors]. Style: [minimalist/detailed], [additional style notes]. Professional branding, clean vector aesthetic, suitable for app icon and web use.

### Icon Variant
A simple app icon for "[app name]" featuring [visual metaphor]. [Style] design with [colors]. Geometric, clean lines, works at small sizes. Flat design style.

### Wordmark Variant
Typography-based logo for "[app name]" using [font style] lettering. [Colors], [mood] aesthetic. Clean, professional, readable at various sizes.
```

### Ideogram Format

```markdown
## Ideogram Prompt

### Primary Logo
Logo: "[app name]" | Style: [style] | Colors: [colors] | Elements: [visual elements] | Mood: [mood] | Type: [logo type] | Quality: professional vector branding

### With Typography
"[app name]" logo with [font style] typography, [style] design, [colors], [mood] aesthetic, clean professional branding
```

### Generic Format

```markdown
## Generic AI Image Prompt

### Primary Logo
Create a [logo type] logo for "[app name]"

**Style:** [style] design, [mood] aesthetic
**Colors:** [primary], [secondary], [accent]
**Elements:** [visual elements or metaphors]
**Typography:** [font style] (if wordmark or combination)

**Requirements:**
- Clean, scalable design
- Works on light and dark backgrounds
- Readable at small sizes (favicon)
- Professional branding quality

**Avoid:**
- [avoided elements]
- Overly complex details
- Trendy effects that date quickly
```

</prompt_generation>

<favicon_generation>

## Favicon & App Icon Prompts

For generating favicons specifically:

```markdown
## Favicon Prompt

Simple icon version of [app name] logo, [key visual element only], [primary color], minimal detail, works at 16x16 pixels, flat design, geometric, clean edges, high contrast

**Technical Notes:**
- Simplify: Remove text, keep only core symbol
- Contrast: Ensure visibility at tiny sizes
- Shape: Consider rounded square for app stores
- Test: Preview at 16x16 before finalizing
```

### Favicon Generation Checklist

After generating logo, create favicon variants:

1. **Simplify** — Remove text, keep core symbol
2. **Test small** — Preview at 16x16, 32x32
3. **Add padding** — 10-15% safe area
4. **Check contrast** — Works on browser tab
5. **Generate set** — All required sizes

</favicon_generation>

<integration>

## Integration with Design Tokens

If `design-tokens.json` exists, reference brand colors:

```javascript
// Read tokens
const tokens = require('.harn/design/design-tokens.json');
const primary = tokens.color.primary.default.$value;
const secondary = tokens.color.secondary?.default?.$value;

// Use in prompts
// "Primary: ${primary} (brand blue)"
```

## Integration with UI Context

If `UI-CONTEXT.md` exists, pull:
- Platform (web/mobile/both)
- App description
- Target audience
- Existing style direction

</integration>

<agent_routing>

## Agent Selection

This command spawns **UI Brander** agent for:
- Complex logo exploration
- Multiple concept generation
- Detailed style research
- Iterative refinement

Handle directly (Coordinator) for:
- Quick favicon-only generation
- Prompt refresh from existing spec
- Simple export to different tool

</agent_routing>

<git_integration>

## Git Protocol

After completion:

```bash
# Stage files
git add .harn/design/LOGO-SPEC.md
git add .harn/design/ui-exports/logo-prompts.md

# Commit
git commit -m "docs(ui): create logo specification for {app-name}

- Style: {style} {logo-type}
- Colors: {primary color description}
- Prompts: {tools generated for}
- Favicon: {yes/no}
"

# Push
git push origin $(git branch --show-current)
```

</git_integration>

<completion>

## Completion Summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► LOGO SPEC CREATED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Logo:        [style] [type] for [app name]
Colors:      [primary] + [secondary/accent]
Prompts:     Generated for [tools]
Favicon:     [Yes/No]

Files:
  .harn/design/LOGO-SPEC.md
  .harn/design/ui-exports/logo-prompts.md

───────────────────────────────────────────────────────

## ▶ Next Up

**Generate the logo** — Use the prompts with your preferred tool:
  - `/ui:pencil` — Design directly in Pencil
  - `/ui:export` — Export prompts for Stitch, V0, Figma

**Continue designing:**
  - `/ui:design-screens` — Create screen specifications
  - `/ui:setup-tokens` — Set up design tokens (if not done)

───────────────────────────────────────────────────────
```

</completion>