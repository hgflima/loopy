# DESIGN.md Adapter

Rules for exporting harness specs to a single `DESIGN.md` file (VoltAgent/awesome-design-md format) and for importing a `DESIGN.md` back into harness artifacts.

<adapter_info>
Format: DESIGN.md (VoltAgent/awesome-design-md)
URL: https://github.com/VoltAgent/awesome-design-md
Output: Single Markdown file with 9 canonical sections
Strength: Agent-readable visual contract, publishable, tool-agnostic documentation
Best For: Feeding other AI coding agents (Claude Code, Cursor, Windsurf) a compact visual spec without installing the harness; onboarding a project from an existing brand (Stripe, Linear, Claude, etc.)
Limitations: Static Markdown — no interactive prototyping, no code output, no per-screen detail (describes *system*, not screens)
Direction: Bidirectional — both export (harness → DESIGN.md) and import (DESIGN.md → harness artifacts)
</adapter_info>

<capability_matrix>

| Capability | Support | Notes |
|------------|---------|-------|
| Visual system documentation | ✅ Excellent | Primary purpose |
| Agent-consumable contract | ✅ Excellent | Format designed for LLMs |
| Color palette + roles | ✅ Excellent | Section 2 canonical |
| Typography rules | ✅ Excellent | Section 3 canonical |
| Spacing + layout principles | ✅ Good | Section 5 + token excerpts |
| Component stylings | ✅ Good | Section 4 — prose, not per-component specs |
| Dark mode | ✅ Good | Documented as parallel palette |
| Do's and Don'ts | ✅ Excellent | Section 7 canonical |
| Responsive behavior | ✅ Good | Section 8 canonical |
| Agent prompt examples | ✅ Excellent | Section 9 — unique to this format |
| Full screens | ❌ No | DESIGN.md is system-level; screens live elsewhere |
| Production code | ❌ No | Documentation only |
| Interactive prototypes | ❌ No | Static file |
| Import back to harness | ✅ Bidirectional | See `<reverse_sync>` |

</capability_matrix>

<prompt_structure>

DESIGN.md is NOT a prompt — it is a documentation artifact. The "structure" below is the canonical 9-section template. All sections MUST appear, in order, even if brief.

```markdown
# DESIGN.md

> Visual design system for [Project Name].
> Source of truth for AI agents generating UI consistent with the brand.

---

## 1. Visual Theme & Atmosphere

[2–5 paragraphs describing the overall mood, audience, feeling, and visual inspiration.
Answer: What does this interface feel like? Who is it for? What brands or aesthetics inform it?]

**Keywords:** [clean, minimal, editorial, playful, technical, etc.]
**Inspiration:** [brands, movements, eras, competitors]
**Audience:** [who sees this interface]

---

## 2. Color Palette & Roles

**Mode:** Light / Dark / Both

### Core Palette

| Role | Hex | Usage |
|------|-----|-------|
| Primary | `#HEX` | [where used — CTAs, links, focus rings] |
| Secondary | `#HEX` | [less prominent UI] |
| Background (page) | `#HEX` | [canvas] |
| Surface (cards) | `#HEX` | [elevated surfaces] |
| Text primary | `#HEX` | [body, headings] |
| Text muted | `#HEX` | [captions, labels] |
| Border | `#HEX` | [dividers, outlines] |
| Success | `#HEX` | [positive states] |
| Warning | `#HEX` | [cautions] |
| Error/Destructive | `#HEX` | [negative states] |

### Dark Mode (if applicable)

| Role | Hex | Notes |
|------|-----|-------|
| Primary | `#HEX` | [often slightly brighter than light mode] |
| Background | `#HEX` | — |
| ... | ... | ... |

**Rules:**
- [Contrast rules — e.g. WCAG AA minimum 4.5:1 for body text]
- [Which roles never swap — e.g. destructive always red family]

---

## 3. Typography Rules

**Font families:**
- Sans: `[Family name]` — used for [where]
- Serif: `[Family name]` — used for [where, if any]
- Mono: `[Family name]` — used for code blocks, inline code, numerics

**Scale:**

| Role | Size | Weight | Line height | Use |
|------|------|--------|-------------|-----|
| Display | [px/rem] | [weight] | [lh] | Hero, marketing |
| H1 | [px/rem] | [weight] | [lh] | Page title |
| H2 | [px/rem] | [weight] | [lh] | Section title |
| H3 | [px/rem] | [weight] | [lh] | Subsection |
| Body | [px/rem] | [weight] | [lh] | Paragraphs |
| Small | [px/rem] | [weight] | [lh] | Captions, helper text |
| Code | [px/rem] | [weight] | [lh] | Inline + blocks |

**Rules:**
- [e.g. headings always semibold, never uppercase]
- [e.g. body text never below 14px]

---

## 4. Component Stylings

Per-component prose describing visual treatment. Do NOT include implementation code — describe what a designer or agent would need to render the component correctly.

### Buttons

- **Primary:** [fill color, text color, radius, padding, hover, active, disabled]
- **Secondary:** [treatment]
- **Ghost / tertiary:** [treatment]
- **Destructive:** [treatment]

### Inputs

[describe text fields, selects, checkboxes, radios, toggles, sliders, file uploads]

### Cards & Surfaces

[describe card treatment: background, border, radius, shadow, padding]

### Navigation

[top nav, side nav, tabs, breadcrumbs]

### Feedback

[toasts, alerts, banners, modals, tooltips]

### Data display

[tables, lists, badges, chips, avatars]

---

## 5. Layout Principles

**Spacing scale:** [list the canonical values — e.g. 4, 8, 12, 16, 24, 32, 48, 64]

**Grid:** [e.g. 12-column, 24px gutter, 1200px max-width]

**Containers:**
- Page max-width: [value]
- Content max-width: [value]
- Sidebar width: [value]

**Rhythm rules:**
- [e.g. section padding always 64px top/bottom on desktop, 32px on mobile]
- [e.g. related elements grouped with 8–12px gap; unrelated groups separated by 24px+]

**Alignment:** [e.g. left-aligned content, centered marketing hero]

---

## 6. Depth & Elevation

**Philosophy:** [flat / subtle shadow / Material-like layered / etc.]

**Elevation scale:**

| Level | Token | Value | Used for |
|-------|-------|-------|----------|
| 0 | `shadow.none` | none | Flat surfaces |
| 1 | `shadow.sm` | `0 1px 2px rgba(...)` | Resting cards |
| 2 | `shadow.md` | `0 4px 6px rgba(...)` | Hover, dropdowns |
| 3 | `shadow.lg` | `0 10px 15px rgba(...)` | Modals, popovers |
| 4 | `shadow.xl` | `0 20px 25px rgba(...)` | Dialogs |

**Rules:**
- [e.g. dark mode uses lighter shadows or relies on borders]
- [e.g. never stack more than 2 elevation levels visually]

---

## 7. Do's and Don'ts

### Do

- [Pattern A — positive example from UI-PATTERNS.md]
- [Pattern B]
- [Pattern C]

### Don't

- [Anti-pattern A — often sourced from UI-DECISIONS.md "rejected" entries]
- [Anti-pattern B]
- [Anti-pattern C]

---

## 8. Responsive Behavior

**Breakpoints:**

| Name | Min width | Target device |
|------|-----------|---------------|
| xs | 0 | Small phones |
| sm | 640 | Large phones |
| md | 768 | Tablets |
| lg | 1024 | Small laptops |
| xl | 1280 | Desktops |
| 2xl | 1536 | Large desktops |

**Strategy:** [mobile-first / desktop-first]

**Rules:**
- [e.g. navigation collapses to hamburger below `md`]
- [e.g. multi-column layouts stack below `lg`]
- [e.g. touch targets minimum 44×44 below `md`]

**Device focus:** [primary device — e.g. desktop-first SaaS, or mobile-first consumer app]

---

## 9. Agent Prompt Guide

Short prompts an AI agent can paste into their context when generating new UI, to stay on-brand.

### General brief

```
You are designing UI for [Project Name]. The system feels [keywords from §1].
Use the palette in §2 exactly — primary is #HEX, backgrounds are #HEX, text is #HEX.
Typography: [family] for UI, [family] for code. Body size: [size].
Spacing scale: [values]. Corner radius: [values]. Shadows: [description].
Always follow the Do/Don't rules in §7.
```

### Building a new screen

```
Generate a [screen type] for [Project Name] at [viewport].
Layout: [grid rule from §5].
Colors: [palette roles from §2].
Components: use the [button / input / card] treatments from §4.
Elevation: [rule from §6].
Follow Do's in §7; avoid Don'ts.
```

### Adding a component

```
Design a new [component] for [Project Name].
Match the visual treatment in §4 — same radius, padding rhythm, and color roles.
If interactive, define hover/active/disabled using the palette in §2.
Respect elevation in §6; don't introduce a new shadow level.
```
```

</prompt_structure>

<transformation_rules>

## Harness Specs → DESIGN.md (Export)

Each DESIGN.md section is populated from specific harness artifacts. The export pipeline aggregates, summarizes, and renders.

| DESIGN.md Section | Harness Source | Transformation |
|-------------------|----------------|----------------|
| 1. Visual Theme & Atmosphere | `UI-CONTEXT.md` → mood, audience, inspiration | Extract "Design Direction" / "Mood" / "Inspiration" subsections; distill to 2–5 paragraphs of prose. Pull keywords from any "tags" field. |
| 2. Color Palette & Roles | `design-tokens.json` → `color.*` | Walk each role (primary, secondary, background, surface, text, border, success, warning, destructive). Emit `$value` as hex. If `$extensions.mode.dark` present, emit a parallel dark palette table. |
| 3. Typography Rules | `design-tokens.json` → `fontFamily.*`, `fontSize.*`, `fontWeight.*`, `lineHeight.*` | Join family tokens into the "Font families" list. Build the scale table from `fontSize.*` roles; pair each with default weight + line-height if tokens encode them. |
| 4. Component Stylings | `COMPONENTS.md` | For each component spec, emit a short prose paragraph covering: fill, border, radius, padding, states (hover/active/disabled), typography. Drop implementation detail (props, TSX). |
| 5. Layout Principles | `design-tokens.json` → `spacing.*` + `UI-CONTEXT.md` → layout notes | List spacing values in order. Pull grid/container rules from UI-CONTEXT's "Layout" or "Grid" section. |
| 6. Depth & Elevation | `design-tokens.json` → `shadow.*` | Emit elevation table with token name → CSS value → intended use. Flag "flat design" if only `shadow.none` is defined. |
| 7. Do's and Don'ts | `UI-PATTERNS.md` (Do's) + `UI-DECISIONS.md` (rejected options → Don'ts) | Each pattern with status=recommended becomes a Do. Each decision with chosen=false or section=rejected becomes a Don't. Paraphrase to prescriptive voice. |
| 8. Responsive Behavior | `UI-CONTEXT.md` → viewport, device focus, breakpoints | Pull breakpoint table verbatim. Extract "device focus" field to the Device focus line. Collect any responsive rules from patterns. |
| 9. Agent Prompt Guide | Aggregated from §1, §2, §3, §5, §6, §7 | Templated — fill placeholders (`[Project Name]`, `#HEX`, font family, spacing scale, radii) from the aggregated data. Always emit the 3 default prompts (general, new screen, new component). |

### Transformation Rules (Export)

1. **Preserve hex values exactly** — never re-quantize or re-name colors the user defined.
2. **Prose, not lists, in §1 and §4** — DESIGN.md is read by humans *and* agents; full sentences carry mood better than bullets for theme and component descriptions.
3. **All 9 sections always present** — if source is missing data, emit a section with a single italicized line `*Not yet defined — see [source-file].*` rather than skipping.
4. **One source of truth per field** — don't double-emit values (e.g. primary hex in both §2 and §9). In §9, reference the value.
5. **Drop harness-internal metadata** — `$type`, `$description`, `$metadata.generated`, token paths like `color.primary.500` don't belong in DESIGN.md. Translate to human language ("Primary brand color, the `500` tint").
6. **Dark mode is parallel, not alternate** — if dark tokens exist, emit a second palette table under §2, not a separate section or a separate file.

## DESIGN.md → Harness Specs (Import)

See `<reverse_sync>` for the full import transformation rules.

</transformation_rules>

<token_mapping>

Design tokens mapping — authoritative for both export and import.

### `design-tokens.json` → DESIGN.md

| Token path | DESIGN.md location | Render as |
|------------|--------------------|-----------|
| `color.primary.default.$value` | §2 table, Primary row | `#HEX` |
| `color.primary.default.$extensions.mode.dark` | §2 dark table, Primary row | `#HEX` |
| `color.secondary.default.$value` | §2, Secondary row | `#HEX` |
| `color.background.default.$value` | §2, Background row | `#HEX` |
| `color.surface.default.$value` | §2, Surface row | `#HEX` |
| `color.text.default.$value` | §2, Text primary row | `#HEX` |
| `color.text.muted.$value` | §2, Text muted row | `#HEX` |
| `color.border.default.$value` | §2, Border row | `#HEX` |
| `color.success.default.$value` | §2, Success row | `#HEX` |
| `color.warning.default.$value` | §2, Warning row | `#HEX` |
| `color.destructive.default.$value` | §2, Error/Destructive row | `#HEX` |
| `fontFamily.sans.$value` | §3, Font families, Sans line | `[Family name]` |
| `fontFamily.serif.$value` | §3, Font families, Serif line | `[Family name]` |
| `fontFamily.mono.$value` | §3, Font families, Mono line | `[Family name]` |
| `fontSize.display.$value` | §3 scale table, Display row | `[value]` |
| `fontSize.h1.$value` | §3 scale table, H1 row | `[value]` |
| `fontSize.h2.$value` | §3 scale table, H2 row | `[value]` |
| `fontSize.base.$value` | §3 scale table, Body row | `[value]` |
| `fontSize.sm.$value` | §3 scale table, Small row | `[value]` |
| `fontWeight.*.$value` | §3 scale table, Weight column | `[weight]` |
| `lineHeight.*.$value` | §3 scale table, Line height column | `[lh]` |
| `spacing.*.$value` | §5 Spacing scale list | inline comma list |
| `borderRadius.*.$value` | §4 Component Stylings (buttons, cards) | inline in prose |
| `shadow.none.$value` | §6 elevation table, Level 0 | `none` |
| `shadow.sm.$value` | §6 elevation table, Level 1 | CSS value |
| `shadow.md.$value` | §6 elevation table, Level 2 | CSS value |
| `shadow.lg.$value` | §6 elevation table, Level 3 | CSS value |
| `shadow.xl.$value` | §6 elevation table, Level 4 | CSS value |

### DESIGN.md → `design-tokens.json` (Import)

Inverse of the table above. When a field is missing from DESIGN.md (e.g. no dark mode table), do NOT fabricate — leave the corresponding token at its current value or omit if creating fresh tokens.

**Edge cases:**
- DESIGN.md uses hex without role name → ask user to assign role, or default to `color.accent.N` sequential naming.
- DESIGN.md lists only one font family → populate `fontFamily.sans`; leave serif/mono empty.
- DESIGN.md spacing given only as descriptive ("tight", "generous") → map tight=8, comfortable=16, generous=24, spacious=32; flag to user for confirmation.
- DESIGN.md has no explicit breakpoints → use default Tailwind scale (640/768/1024/1280/1536); flag to user.

</token_mapping>

<component_descriptions>

DESIGN.md §4 Component Stylings uses prose paragraphs, not tables. Each component gets one short paragraph (2–5 sentences) covering visual treatment only — no props, no code.

| Component | DESIGN.md §4 Prose Pattern |
|-----------|----------------------------|
| Button (primary) | "Primary buttons fill with [color], display [color] text at [size/weight], have [radius] corners, and [padding] padding. On hover, [change]; on active, [change]; disabled state [change]." |
| Button (secondary) | "Secondary buttons use a [color] border with transparent fill; text in [color] at same weight as primary. Hover fills with [color] at low opacity." |
| Button (ghost) | "Ghost buttons have no border or fill; text only in [color]. Hover adds a subtle [color] background at [opacity]." |
| Button (destructive) | "Destructive buttons fill with [destructive color]; text always white. Used only for irreversible actions." |
| Input (text) | "Text inputs have a [border color] border, [radius] corners, [padding] padding, and [background] fill. Focus shows a [color] ring of [width]. Labels sit above in [color/size]." |
| Card | "Cards are [background] on [page background], with [shadow description] elevation and [radius] corners. Internal padding is [value]." |
| Modal / Dialog | "Modals center over a [opacity] dimmed backdrop, use [background] with [radius] corners, and cast a [shadow level] shadow. Max width [value]; padding [value]." |
| Navigation (top) | "Top nav sits at [height] tall, [background] background with a [border color] bottom border. Active links in [color]; inactive in [muted color]." |
| Sidebar | "The sidebar is [width] wide, [background] background, with [padding] internal padding. Active items use [color] text on [background] fill." |
| Tabs | "Tabs display horizontally with [color] text; active tab has a [underline / pill] indicator in [color]." |
| Badge | "Badges are small [radius] rounded pills, [padding] padding, [weight] weight at [size] text. Color varies by semantic role (success / warning / info / error)." |
| Avatar | "Avatars are fully-rounded images; default sizes [xs/sm/md/lg]. When no image, show initials in [color] on a [color] fill." |
| Toast / Alert | "Toasts appear in the [position] corner, [background] fill with [border color] accent matching severity, [shadow level] shadow, [radius] corners." |
| Table | "Tables use [header background] headers with [header color] text, [row color] alternating row tint (or none), and [border] dividers between rows." |

**Writing tips:**
- Use present-tense descriptive voice ("Buttons fill with blue" not "Buttons should fill with blue").
- Avoid framework references ("shadcn Button" → just "button").
- If a component has multiple variants, cover the primary variant in prose and list others as ", , ." inline.
- If harness has no `COMPONENTS.md` entry for a component, skip that paragraph — do not invent.

</component_descriptions>

<example_transformation>

## Concrete Example — Small SaaS (synthetic)

### Input: Harness artifacts (excerpts)

`.harn/design/design-tokens.json`:
```json
{
  "color": {
    "primary": { "default": { "$value": "#2563EB" } },
    "background": {
      "default": { "$value": "#FFFFFF", "$extensions": { "mode": { "dark": "#0F172A" } } },
      "subtle":  { "$value": "#F8FAFC", "$extensions": { "mode": { "dark": "#1E293B" } } }
    },
    "text":    { "default": { "$value": "#0F172A" }, "muted": { "$value": "#64748B" } },
    "border":  { "default": { "$value": "#E2E8F0" } },
    "destructive": { "default": { "$value": "#DC2626" } }
  },
  "fontFamily": { "sans": { "$value": "Inter" }, "mono": { "$value": "JetBrains Mono" } },
  "fontSize":   { "h1": { "$value": "36px" }, "h2": { "$value": "28px" }, "base": { "$value": "16px" }, "sm": { "$value": "14px" } },
  "spacing":    { "2": { "$value": "8px" }, "4": { "$value": "16px" }, "6": { "$value": "24px" }, "8": { "$value": "32px" } },
  "borderRadius": { "md": { "$value": "6px" } },
  "shadow": {
    "sm": { "$value": "0 1px 2px rgba(0,0,0,0.05)" },
    "md": { "$value": "0 4px 6px rgba(0,0,0,0.07)" }
  }
}
```

`.harn/design/UI-CONTEXT.md` (Design Direction excerpt):
```
Mood: Clean, professional, trustworthy. Built for B2B finance operators.
Inspiration: Linear's density + Stripe's warmth.
Device focus: Desktop-first; mobile is secondary.
```

`.harn/design/COMPONENTS.md` (Button excerpt):
```
## Button — Primary
Fill: color.primary.default (#2563EB)
Text: #FFFFFF, 14px, weight 600
Radius: borderRadius.md (6px)
Padding: 8px 16px
States: hover → #1D4ED8; disabled → 50% opacity
```

`.harn/design/UI-PATTERNS.md` (Do excerpt):
```
Pattern: Always label icon-only buttons with tooltips or aria-label.
Status: recommended
```

`.harn/design/UI-DECISIONS.md` (Don't excerpt):
```
Decision: Right-align numeric columns in tables.
Rejected option: Center-align numerics (considered; caused scanning fatigue).
```

### Output: `DESIGN.md`

```markdown
# DESIGN.md

> Visual design system for Acme Finance.
> Source of truth for AI agents generating UI consistent with the brand.

---

## 1. Visual Theme & Atmosphere

Clean, professional, trustworthy. The interface is built for B2B finance operators who spend hours inside it — density matters, but the surface stays warm enough to avoid fatigue. Visual inspiration draws from Linear's information density and Stripe's welcoming edges.

**Keywords:** clean, professional, trustworthy, dense, warm-minimal
**Inspiration:** Linear, Stripe
**Audience:** B2B finance operators (desktop, daily use)

---

## 2. Color Palette & Roles

**Mode:** Both (light default, dark available)

### Core Palette

| Role | Hex | Usage |
|------|-----|-------|
| Primary | `#2563EB` | CTAs, links, focus rings |
| Background (page) | `#FFFFFF` | Page canvas |
| Background (subtle) | `#F8FAFC` | Sectioned regions, disabled surfaces |
| Text primary | `#0F172A` | Body, headings |
| Text muted | `#64748B` | Captions, labels |
| Border | `#E2E8F0` | Dividers, input outlines |
| Destructive | `#DC2626` | Delete, danger confirmations |

### Dark Mode

| Role | Hex | Notes |
|------|-----|-------|
| Background (page) | `#0F172A` | Deep slate canvas |
| Background (subtle) | `#1E293B` | Card surfaces |

**Rules:**
- Body text maintains WCAG AA contrast (4.5:1) in both modes.
- Destructive stays red-family across modes — never recolored.

---

## 3. Typography Rules

**Font families:**
- Sans: `Inter` — used for all UI text
- Mono: `JetBrains Mono` — used for numerics, code, IDs

**Scale:**

| Role | Size | Weight | Line height | Use |
|------|------|--------|-------------|-----|
| H1 | 36px | 600 | 1.2 | Page title |
| H2 | 28px | 600 | 1.3 | Section title |
| Body | 16px | 400 | 1.5 | Paragraphs |
| Small | 14px | 400 | 1.4 | Captions, labels |

**Rules:**
- Headings never uppercase; weight 600 is the heading convention.
- Body text never below 14px.

---

## 4. Component Stylings

### Buttons

**Primary:** Primary buttons fill with `#2563EB`, display white 14px semibold text, have 6px rounded corners, and 8px/16px padding. On hover, fill shifts to `#1D4ED8`. Disabled state reduces opacity to 50%.

### Inputs

Text inputs have a `#E2E8F0` border, 6px corners, 8px/12px padding, and white fill. Focus shows a 2px `#2563EB` ring. Labels sit above in `#64748B` at 14px.

### Cards

Cards are white on the `#F8FAFC` page background, with `0 1px 2px rgba(0,0,0,0.05)` elevation and 6px corners. Internal padding is 24px.

---

## 5. Layout Principles

**Spacing scale:** 8, 16, 24, 32

**Containers:**
- Page max-width: 1440px
- Content max-width: 1200px

**Rhythm rules:**
- Section padding 32px vertical on desktop, 16px on mobile.
- Related form fields grouped with 16px; distinct sections separated by 32px.

**Alignment:** Left-aligned content; centered only for empty states and modals.

---

## 6. Depth & Elevation

**Philosophy:** Subtle. Cards rest with barely-there shadows; dialogs rely on the backdrop, not depth, for focus.

**Elevation scale:**

| Level | Token | Value | Used for |
|-------|-------|-------|----------|
| 1 | `shadow.sm` | `0 1px 2px rgba(0,0,0,0.05)` | Resting cards |
| 2 | `shadow.md` | `0 4px 6px rgba(0,0,0,0.07)` | Hover, dropdowns |

**Rules:**
- Dark mode relies on borders and background contrast rather than shadows.
- Never stack more than two elevation levels.

---

## 7. Do's and Don'ts

### Do

- Always label icon-only buttons with tooltips or `aria-label`.
- Right-align numeric columns in tables.

### Don't

- Don't center-align numeric table columns — it causes scanning fatigue.

---

## 8. Responsive Behavior

**Breakpoints:**

| Name | Min width | Target device |
|------|-----------|---------------|
| sm | 640 | Large phones |
| md | 768 | Tablets |
| lg | 1024 | Small laptops |
| xl | 1280 | Desktops |

**Strategy:** Desktop-first.

**Device focus:** Desktop-first; mobile is secondary.

---

## 9. Agent Prompt Guide

### General brief

```
You are designing UI for Acme Finance. The system feels clean, professional, trustworthy, dense, warm-minimal.
Use the palette in §2 exactly — primary is #2563EB, backgrounds are #FFFFFF / #F8FAFC, text is #0F172A.
Typography: Inter for UI, JetBrains Mono for code/numerics. Body size: 16px.
Spacing scale: 8, 16, 24, 32. Corner radius: 6px. Shadows: subtle (1–2px blur).
Always follow the Do/Don't rules in §7.
```

### Building a new screen

```
Generate a [screen type] for Acme Finance at desktop (1440px).
Layout: max-width 1200px, left-aligned, 32px section padding.
Colors: primary #2563EB for CTAs, text #0F172A on #FFFFFF, muted #64748B for labels.
Components: use the button and input treatments from §4.
Elevation: resting cards use shadow.sm; never exceed shadow.md.
Follow Do's in §7; avoid Don'ts.
```

### Adding a component

```
Design a new [component] for Acme Finance.
Match the visual treatment in §4 — 6px radius, Inter font, same color roles.
If interactive, define hover/active/disabled using the palette in §2.
Respect elevation in §6; don't introduce a new shadow level.
```
```

</example_transformation>

<reverse_sync>

## Importing DESIGN.md → Harness Artifacts

DESIGN.md is bidirectional. The `/ui:import-design-md` command consumes a DESIGN.md (from VoltAgent catalog, arbitrary URL, or local path) and populates harness artifacts. This section is the authoritative transformation guide for the import side.

### Parse strategy

1. Read the file (fetch for URLs, Read for local paths).
2. Split into 9 sections by `## N. <Title>` headings (tolerant to minor heading variations — match by number prefix or by known title keywords).
3. For each section, run the extraction rules below.

### Section-by-section extraction

#### §1 Visual Theme & Atmosphere → `UI-CONTEXT.md`

- Extract the prose paragraphs and write them into the "Design Direction" / "Mood" subsection.
- Pull `**Keywords:**` line → `tags` field.
- Pull `**Inspiration:**` line → `inspiration` field (also seed `UI-INSPIRATION.md` if present).
- Pull `**Audience:**` line → `audience` field.

#### §2 Color Palette & Roles → `design-tokens.json` (`color.*`)

- For each row in the core palette table:
  - Map role name → token path (Primary → `color.primary.default`, Background → `color.background.default`, etc. — use the inverse of `<token_mapping>`).
  - Write `$value: "#HEX"` and `$type: "color"`.
- If a Dark Mode table is present, set `$extensions.mode.dark = "#HEX"` on the corresponding role.
- Roles not recognized → write to `color.extras.<slug>` and warn the user.
- Rules (text below the table) → append to `UI-DECISIONS.md` as color-usage decisions.

#### §3 Typography Rules → `design-tokens.json` (`fontFamily.*`, `fontSize.*`, `fontWeight.*`, `lineHeight.*`)

- Each "Font families" bullet → `fontFamily.sans|serif|mono.$value`.
- Each row of the Scale table → `fontSize.<role>`, `fontWeight.<role>`, `lineHeight.<role>`.
- Rules → append to `UI-DECISIONS.md` as typography rules.

#### §4 Component Stylings → `COMPONENTS.md`

- Each sub-heading (Buttons, Inputs, Cards, etc.) becomes a component spec section.
- Parse the prose for visual attributes (fill, radius, padding, states) — emit as the `## Component Name` entry in `COMPONENTS.md`.
- Where the prose uses hex values, cross-link to token names resolved from §2.
- Where prose mentions a radius or padding value not in `design-tokens.json`, add it to the tokens file (`borderRadius.*`, `spacing.*`) and flag as auto-added.

#### §5 Layout Principles → `design-tokens.json` (`spacing.*`) + `UI-CONTEXT.md`

- Spacing scale list → populate `spacing.*` tokens (use indices matching the scale: `spacing.1 = 4`, `spacing.2 = 8`, etc. — or preserve any existing naming convention).
- Grid / container / alignment rules → write to UI-CONTEXT.md "Layout" section.

#### §6 Depth & Elevation → `design-tokens.json` (`shadow.*`)

- Each row of the elevation table → `shadow.<role>.$value`.
- Philosophy sentence → append to `UI-DECISIONS.md` as an elevation-philosophy note.

#### §7 Do's and Don'ts → `UI-PATTERNS.md` + `UI-DECISIONS.md`

- Each Do bullet → `UI-PATTERNS.md` entry with `status: recommended`.
- Each Don't bullet → `UI-DECISIONS.md` entry with `chosen: false` (or `section: rejected`), paraphrased as the considered-and-rejected option.

#### §8 Responsive Behavior → `UI-CONTEXT.md`

- Breakpoints table → Viewport Requirements / Breakpoint System section of UI-CONTEXT.md.
- Strategy + Device focus → corresponding UI-CONTEXT.md fields.
- Rules → UI-PATTERNS.md as responsive patterns with `status: recommended`.

#### §9 Agent Prompt Guide → (nothing written — reference only)

- §9 is a derived artifact. Do NOT write it back to any spec file on import.
- Instead, record in `UI-DECISIONS.md` that a DESIGN.md was imported, with a pointer to the source (URL, voltagent name, or local path) and the date — so that the next `/ui:export design-md` can re-emit §9 from the freshly populated specs.

### Conflict resolution (import)

When a field already exists in the harness:

1. Compute the diff (existing value vs imported value).
2. If identical → silent no-op.
3. If different → prompt the user with 3 options:
   - Keep existing (skip import for this field)
   - Replace with imported value
   - Merge (rare — only sensible for lists like keywords, patterns)
4. Log every conflict resolution to `UI-DECISIONS.md` with date, field, chosen action.

Reuse the same pattern as `/ui:import-tokens` conflict resolution.

### VoltAgent catalog shortcut

When `/ui:import-design-md voltagent:<name>` is called, resolve to:

```
https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/<name>/DESIGN.md
```

If 404, fall back to listing known catalog entries and asking the user to pick. The catalog is versioned upstream; the adapter should not hardcode the list of entries beyond a cached snapshot used for "Like [Product]" matching in `/ui:init`.

### Post-import verification

After writing artifacts, run the same consistency checks that `/ui:import-tokens` uses:
- All referenced tokens exist.
- Color contrast still meets stated rules (from §2 "Rules" block).
- Components reference only defined tokens.

Flag any inconsistency as a warning, not a hard failure — the user chose to import and may intend to resolve later.

</reverse_sync>

<best_practices>

**Do:**
- Emit all 9 sections on export, even if a section is sparse — use "*Not yet defined — see [source-file].*" placeholder.
- Use exact hex values from `design-tokens.json` — no rounding, re-naming, or re-palletting.
- Keep §1 Visual Theme in prose (paragraphs), not bullets — mood reads better as sentences.
- Write §4 Component Stylings in present-tense descriptive voice ("Buttons fill with blue"), not imperative ("Buttons should fill with blue").
- In §9 Agent Prompt Guide, reference concrete values from §§2–6 so the prompts are self-contained.
- On import, always produce a diff and ask before overwriting — never silently replace.
- Preserve dark mode as a parallel palette in §2 (same section, second table), not as a separate file or section.
- Log every import to `UI-DECISIONS.md` with source + date for provenance.

**Don't:**
- Don't include per-screen detail in DESIGN.md — screens live in `SCR-*.md` and `UI-REGISTRY.md`. DESIGN.md is system-level only.
- Don't emit framework-specific code (React, Tailwind classes, Vue SFC) in any section.
- Don't emit internal token paths like `color.primary.500` — translate to human roles ("Primary, the mid-scale tint").
- Don't invent values on import. If a DESIGN.md is missing a typography scale, leave tokens untouched and flag to user.
- Don't skip sections on export because they feel redundant (e.g. skipping §8 because you're desktop-only) — emit with stated scope.
- Don't mix light and dark values in a single table row — always use the dual-table pattern.
- Don't treat §9 Agent Prompt Guide as a source on import — it is derived, not authoritative.
- Don't modify harness artifacts silently on import — all writes must be announced, with a before/after diff.

</best_practices>

<references>

- VoltAgent/awesome-design-md repo: https://github.com/VoltAgent/awesome-design-md
- Canonical DESIGN.md location in consumer projects: `./DESIGN.md` (project root), `./docs/DESIGN.md`, or `./design/DESIGN.md`
- Harness-generated output path: `.harn/design/ui-exports/DESIGN.md` (user may move to project root after review)
- Sibling adapters: `generic.md`, `stitch.md`, `v0.md`, `figma.md`, `pencil.md`
- Import command: `/ui:import-design-md` (see `commands/ui/import-design-md.md`)
- Export service: `/ui:export design-md` (see `commands/ui/export.md`)

</references>
