---
name: ui:setup-tokens
description: Initialize design token system with colors, typography, and spacing
allowed-tools: [Read, Write, Edit, AskUserQuestion, Glob, Grep, WebFetch, Task]
agent: ui-researcher (for inspiration), ui-designer (for coordination)
---

<objective>
Establish the foundational design token system for the project. Gather user preferences through adaptive questioning, analyze inspiration if provided, then create a W3C-compatible design-tokens.json file.
</objective>

<context>
@./.claude/ui-design/templates/design-tokens.json
@./.claude/ui-design/templates/style-presets.json
@./.claude/ui-design/references/design-systems.md
@.harn/design/UI-CONTEXT.md (if exists)
@.harn/design/UI-INSPIRATION.md (if exists)
</context>

<ux_principles>
## Interactive Questioning

Every question must offer:
1. **Specific options** — Common choices with visual indicators
2. **"You decide"** — Smart defaults based on context/inspiration
3. **Free text (Other)** — Always available

## Adaptive Flow
- If inspiration was provided in /ui:init, pre-fill suggestions
- If existing tokens detected, offer to extend vs. replace
- Ask fewer questions when context is clear
- Ask more when user chooses "Custom"
</ux_principles>

<process>

<step name="style_direction">
## Choose Your Starting Point

Before diving into individual token choices, offer a style direction. Frame it clearly: picking a preset gives you a **coherent, complete starting point** — not a locked-in choice. Every token can be tweaked here, and the full design is freely editable later in Pencil, Figma, V0, or any tool they export to.

**Question: How would you like to set up your design tokens?**

*Each preset is just a starting point — a complete, coherent set of tokens you can customize. Everything remains fully editable when you export to Pencil, Figma, V0, or any other design tool.*

Options:
- **Precision Dark** — Engineered for focus: high-contrast dark interface for speed and deep work. *Inspired by Linear, Vercel, Raycast.* (Indigo primary, Inter font, compact 14px base, small radii, minimal shadows)
- **Soft Bloom** — Warm and welcoming: rounded, friendly aesthetic that feels human. *Inspired by Airbnb, Notion, Cal.com.* (Rose/coral primary, DM Sans font, spacious 16px base, large radii, soft shadows)
- **Sharp Finance** — Polished authority: clean professional system that communicates trust. *Inspired by Stripe, Mercury, Plaid.* (Blue primary, system fonts, standard 16px base, crisp radii, defined shadows)
- **Bold Punch** — Unapologetically loud: thick borders, hard shadows, maximum visual impact. *Inspired by Gumroad, Figma, Lemon Squeezy.* (Fuchsia primary, Space Grotesk font, chunky 16px base, hard-offset shadows, 2px borders)
- **Customize from scratch** — Full control over every token (7 questions)

If user picks a preset:
1. Read the matching preset from `./.claude/ui-design/templates/style-presets.json`
2. Deep-merge preset tokens over the base template from `./.claude/ui-design/templates/design-tokens.json`
3. Generate the complete `.harn/design/design-tokens.json`
4. Show a summary of what was generated
5. Ask: **"Want to adjust anything?"**
   - If yes: ask ONLY about what they want to change (targeted, not all 7 questions)
   - If no: proceed to record_decisions step

If user picks "Customize from scratch":
- Continue with the existing flow (check_existing → inspiration_check → gather_colors → gather_typography → gather_spacing → gather_effects)
</step>

<step name="check_existing">
## Check Existing Context

**Note:** This step is skipped if user selected a style preset above.

1. **Check for UI-CONTEXT.md:**
   - Platform constraints (iOS needs specific colors, web is flexible)
   - Inspiration references (extract suggested colors)
   - Component library target (use their defaults as base)

2. **Check for existing tokens:**
   - `.harn/design/design-tokens.json` — Offer update vs. fresh start
   - `tailwind.config.*` — Can extract existing theme
   - `figma-tokens.json` — Can import directly

3. **Check for brand assets:**
   - Logo files → Extract primary color
   - Brand guidelines → Extract palette

If tokens exist:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► EXISTING TOKENS DETECTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Found: .harn/design/design-tokens.json

Colors:      [X] defined
Typography:  [X] defined
Spacing:     [X] defined

What would you like to do?
```

Options:
- Update existing tokens
- Start fresh (replace)
- Import from another source
</step>

<step name="inspiration_check">
## Check for Inspiration

If UI-INSPIRATION.md exists or user provides "like [Product]":

1. **Spawn UI Researcher** if URL/product analysis needed
2. Extract suggested:
   - Primary color direction
   - Typography feel
   - Spacing density
   - Overall mood

Use as defaults in questions:
```
Based on [inspiration], suggesting:
- Primary: [color] (like [Product])
- Font: [family] (similar feel)
```
</step>

<step name="gather_colors">
## Color Preferences

**Question 1: Primary Brand Color**

"What's your primary brand color?"

Options:
- Blue (#2563EB) — Trust, professional
- Green (#10B981) — Growth, success
- Purple (#8B5CF6) — Creative, premium
- Orange (#F97316) — Energy, friendly
- Red (#EF4444) — Bold, urgent
- Neutral (#6B7280) — Minimal, sophisticated
- [Suggested from inspiration] (Recommended)
- You decide based on context
- Custom hex code

**Question 2: Color Mood**

"What feeling should the colors convey?"

Options:
- Vibrant & Bold — High saturation, strong contrast
- Soft & Muted — Lower saturation, gentle
- Dark & Moody — Dark backgrounds, light text
- Light & Airy — White space, subtle colors
- You decide based on inspiration
- Match existing brand

Based on response, generate:
- Primary scale (50-950)
- Secondary color (complementary or analogous)
- Semantic colors (success, warning, error, info)
- Neutral scale (for backgrounds, text, borders)
</step>

<step name="gather_typography">
## Typography Preferences

**Question 3: Font Family**

"What font family should we use?"

Options:
- Inter — Modern, clean, great for UI
- System UI — Native feel, fast loading
- Plus Jakarta Sans — Friendly, geometric
- DM Sans — Approachable, readable
- Space Grotesk — Technical, distinctive
- [Suggested from inspiration]
- You decide based on platform
- Custom (specify)

**Question 4: Typography Scale**

"How should text sizes scale?"

Options:
- Compact — Smaller sizes, more content density
- Comfortable — Standard sizes, balanced
- Generous — Larger sizes, more readability
- You decide based on platform

Generate based on selection:
- Size scale (xs through 5xl)
- Weight scale (normal, medium, semibold, bold)
- Line heights (tight, normal, relaxed)
</step>

<step name="gather_spacing">
## Spacing & Shape

**Question 5: Spacing Density**

"How dense should the interface be?"

Options:
- Compact — Tight spacing, data-dense (dashboards)
- Comfortable — Standard spacing (most apps)
- Spacious — Generous spacing (marketing, content)
- You decide based on use case

**Question 6: Corner Radius**

"What corner style do you prefer?"

Options:
- Sharp — 0-2px radius, crisp edges
- Subtle — 4-6px radius, slightly rounded
- Rounded — 8-12px radius, friendly feel
- Pill — Full radius on buttons, very rounded
- You decide based on mood

Generate:
- Spacing scale (0.5 through 16)
- Border radius scale (none, sm, md, lg, xl, full)
- Border widths
</step>

<step name="gather_effects">
## Effects (Quick)

**Question 7: Shadow Style**

"How should elevation/shadows appear?"

Options:
- Flat — No shadows, use borders instead
- Subtle — Light shadows, hint of depth
- Elevated — Clear shadows, layered feel
- Dramatic — Strong shadows, floating elements
- You decide

Generate:
- Shadow scale (sm, md, lg, xl)
- Or border alternatives if flat
</step>

<step name="component_library_alignment">
## Component Library Alignment

If UI-CONTEXT.md specifies a component library:

**For shadcn/ui:**
- Use CSS variable naming convention
- Align with their color semantics
- Match their radius/spacing scale

**For Tailwind:**
- Use Tailwind naming conventions
- Generate tailwind.config.js extension

**For Material UI:**
- Use MUI naming conventions
- Map to their theme structure
</step>

<step name="generate_tokens">
## Generate Design Tokens

Create `.harn/design/design-tokens.json` in W3C Design Tokens format:

```json
{
  "$schema": "https://design-tokens.org/schema.json",
  "color": {
    "primary": {
      "50": { "$value": "#eff6ff", "$type": "color" },
      "100": { "$value": "#dbeafe", "$type": "color" },
      "500": { "$value": "#3b82f6", "$type": "color" },
      "600": { "$value": "#2563eb", "$type": "color" },
      "700": { "$value": "#1d4ed8", "$type": "color" },
      "foreground": { "$value": "#ffffff", "$type": "color" }
    },
    "secondary": { ... },
    "background": {
      "default": { "$value": "#ffffff", "$type": "color" },
      "subtle": { "$value": "#f8fafc", "$type": "color" },
      "muted": { "$value": "#f1f5f9", "$type": "color" }
    },
    "text": {
      "default": { "$value": "#0f172a", "$type": "color" },
      "muted": { "$value": "#64748b", "$type": "color" },
      "inverse": { "$value": "#ffffff", "$type": "color" }
    },
    "border": {
      "default": { "$value": "#e2e8f0", "$type": "color" },
      "muted": { "$value": "#f1f5f9", "$type": "color" }
    },
    "success": { ... },
    "warning": { ... },
    "error": { ... },
    "info": { ... }
  },
  "typography": {
    "fontFamily": {
      "sans": { "$value": "Inter, system-ui, sans-serif", "$type": "fontFamily" },
      "mono": { "$value": "JetBrains Mono, monospace", "$type": "fontFamily" }
    },
    "fontSize": {
      "xs": { "$value": "0.75rem", "$type": "dimension" },
      "sm": { "$value": "0.875rem", "$type": "dimension" },
      "base": { "$value": "1rem", "$type": "dimension" },
      "lg": { "$value": "1.125rem", "$type": "dimension" },
      "xl": { "$value": "1.25rem", "$type": "dimension" },
      "2xl": { "$value": "1.5rem", "$type": "dimension" },
      "3xl": { "$value": "1.875rem", "$type": "dimension" },
      "4xl": { "$value": "2.25rem", "$type": "dimension" }
    },
    "fontWeight": { ... },
    "lineHeight": { ... }
  },
  "spacing": {
    "0.5": { "$value": "0.125rem", "$type": "dimension" },
    "1": { "$value": "0.25rem", "$type": "dimension" },
    "2": { "$value": "0.5rem", "$type": "dimension" },
    "3": { "$value": "0.75rem", "$type": "dimension" },
    "4": { "$value": "1rem", "$type": "dimension" },
    "6": { "$value": "1.5rem", "$type": "dimension" },
    "8": { "$value": "2rem", "$type": "dimension" },
    "12": { "$value": "3rem", "$type": "dimension" },
    "16": { "$value": "4rem", "$type": "dimension" }
  },
  "border": {
    "radius": {
      "none": { "$value": "0", "$type": "dimension" },
      "sm": { "$value": "0.125rem", "$type": "dimension" },
      "md": { "$value": "0.375rem", "$type": "dimension" },
      "lg": { "$value": "0.5rem", "$type": "dimension" },
      "xl": { "$value": "0.75rem", "$type": "dimension" },
      "full": { "$value": "9999px", "$type": "dimension" }
    },
    "width": { ... }
  },
  "shadow": { ... },
  "transition": { ... }
}
```

Also generate dark mode values if requested:
```json
{
  "color": {
    "background": {
      "default": {
        "$value": "#ffffff",
        "$type": "color",
        "$extensions": {
          "mode": {
            "dark": "#0f172a"
          }
        }
      }
    }
  }
}
```
</step>

<step name="record_decisions">
## Record Decisions

Append to `.harn/design/UI-DECISIONS.md`:

```markdown
## DEC-001: Primary Color
**Date:** [date]
**Decision:** [color] (#hex)
**Rationale:** [User choice / Based on inspiration / Default for platform]

## DEC-002: Font Family
**Date:** [date]
**Decision:** [font]
**Rationale:** [reason]

[Continue for key decisions...]
```
</step>

<step name="update_state">
## Update State

Update `.harn/design/ui-state/coordinator-state.json`:
```json
{
  "project_status": {
    "phase": "tokens-defined",
    "tokens_defined": true
  }
}
```
</step>

<step name="completion">
## Completion Summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► DESIGN TOKENS CREATED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Colors
  Primary:     ████ [name] (#hex)
  Secondary:   ████ [name] (#hex)
  Background:  ████ (#hex)
  Text:        ████ (#hex)

Typography
  Font:        [family]
  Scale:       [compact/comfortable/generous]

Spacing
  Density:     [compact/comfortable/spacious]
  Radius:      [sharp/subtle/rounded/pill]

Effects
  Shadows:     [flat/subtle/elevated/dramatic]

Dark Mode:    [Yes / No]

File:         .harn/design/design-tokens.json
Decisions:    .harn/design/UI-DECISIONS.md

───────────────────────────────────────────────────────

## ▶ Next Up

**Design screens** — Create screen specifications

`/ui:design-screens`

───────────────────────────────────────────────────────
```
</step>

</process>

<success_criteria>
- `.harn/design/design-tokens.json` exists with valid W3C format
- All core token categories defined (colors, typography, spacing, borders, shadows)
- Tokens align with user's stated preferences or smart defaults
- Style preset applied correctly (if selected)
- Decisions documented in UI-DECISIONS.md
- State file updated
</success_criteria>
