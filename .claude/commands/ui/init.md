---
name: ui:init
description: Initialize UI design context for a project
allowed-tools: [Read, Write, Edit, AskUserQuestion, Glob, Grep, WebFetch, Task]
agent: ui-researcher
---

<objective>
Establish foundational UI context for the project. Discover platform, framework, constraints, and gather inspiration. Creates UI-CONTEXT.md as the starting point for all UI design work.
</objective>

<context>
@./.claude/ui-design/references/design-systems.md
</context>

<ux_principles>
## Interactive Questioning

Every question must offer:
1. **Specific options** — Common choices relevant to the question
2. **"You decide"** — Let Claude choose smart defaults based on context
3. **Free text (Other)** — Always available via the AskUserQuestion tool

Questions are **adaptive**:
- Ask as many as needed based on context
- Skip questions when answers can be inferred
- Probe deeper when complexity is detected
</ux_principles>

<process>

<step name="detect_context">
## Automatic Context Detection

Before asking questions, analyze:

1. **Check for existing files:**
   - package.json → Detect framework (Next.js, React, Vue, etc.)
   - Podfile/Package.swift → iOS project
   - build.gradle → Android project
   - pubspec.yaml → Flutter project
   - Cargo.toml, go.mod, etc. → Backend (may have frontend)

2. **Check for existing UI code:**
   - src/components/, components/ → Existing component structure
   - styles/, css/, scss/ → Styling approach
   - tailwind.config.* → Tailwind CSS
   - .storybook/ → Component documentation exists

3. **Check for existing design files:**
   - .harn/design/design-tokens.json → Tokens already defined
   - .harn/design/UI-SPEC.md → Specs already started
   - figma-tokens.json, tokens.json → Design system exists

4. **Check for existing DESIGN.md (VoltAgent/awesome-design-md format):**
   - Glob in this order, first match wins but continue collecting all to offer choice if multiple:
     - `./DESIGN.md` (canonical VoltAgent location — project root)
     - `./docs/DESIGN.md`
     - `./design/DESIGN.md`
     - `./.harn/design/DESIGN.md` (previously copied here)
   - For each match, verify it looks like a DESIGN.md by checking for the first 2–3 canonical headings (`## 1.`, `## 2.`, `## 3.`) within the first 200 lines.

Report what was detected before asking questions:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► CONTEXT DETECTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Framework:    [detected or unknown]
Styling:      [Tailwind / CSS Modules / styled-components / unknown]
Components:   [N found in src/components/ or "none detected"]
Existing specs: [.harn/design/... if any]

✓ DESIGN.md found at <path>   (if applicable)

───────────────────────────────────────────────────────
```

### Sub-step: DESIGN.md import prompt (runs before `platform_discovery`)

If one or more DESIGN.md files were found:

**If multiple found,** ask which to use:

**Question: Multiple DESIGN.md files detected. Which should I use?**

Options (dynamic — one per detected path):
- `./DESIGN.md`
- `./docs/DESIGN.md`
- `./design/DESIGN.md`
- `./.harn/design/DESIGN.md`
- None — skip and continue with the normal flow

**Then, for the selected file (or the single match):**

**Question: Encontrei um DESIGN.md em `<path>`. Importar agora para popular tokens, contexto e patterns?**

Options:
- Yes — run `/ui:import-design-md <path>` now, then continue with the remaining init steps using the newly-populated specs
- No — continue normal flow (existing DESIGN.md will stay on disk untouched)

**On "Yes":**
- Dispatch `/ui:import-design-md <path>` (with the path verbatim — relative or absolute).
- After import completes, mark the following fields as **already answered** and skip their questions in subsequent steps:
  - `platform_discovery` — can still run if framework was not detected by step 1 (DESIGN.md does NOT encode framework).
  - `design_context` — **skip entirely** if DESIGN.md populated `UI-CONTEXT.md` with Mood / Direction / Inspiration / Audience (which it does). Report "Design context populated from DESIGN.md import".
  - `constraints_discovery` — still ask; DESIGN.md does not encode performance budget, RTL, or "must match existing brand colors" (brand is already set).
  - `users_discovery` — still ask; DESIGN.md encodes `audience` (seeded into UI-CONTEXT), but device / tech-level follow-ups are finer-grained.
- Record in the detection summary which fields were populated from the import (see `write_context` step).
</step>

<step name="platform_discovery">
## Platform Discovery

If not detected automatically, ask:

**Question: What are we building?**

Options:
- Web application (browser-based)
- iOS app (native Swift/SwiftUI)
- Android app (native Kotlin)
- Cross-platform mobile (React Native / Flutter)
- Desktop application (Electron / Tauri)
- You decide based on context

For web, follow up with framework if not detected:
- Next.js / React
- Vue / Nuxt
- Svelte / SvelteKit
- Plain HTML/CSS/JS
- Other (specify)
</step>

<step name="design_context">
## Design Context Discovery

**Question: Any design references or inspiration?**

Options:
- "Like [Product name]" — Will analyze the product's design
- URL to reference site — Will fetch and analyze
- Existing brand guidelines — Point to files
- Start fresh — No specific inspiration
- You decide — Use modern defaults

If user provides inspiration:
- Spawn UI Researcher agent if complex
- Analyze visual patterns
- Extract color direction
- Note typography and spacing
- Document in UI-INSPIRATION.md
</step>

<step name="constraints_discovery">
## Constraints Discovery

**Question: Any specific constraints?**

Options (multi-select):
- Must match existing brand colors
- Accessibility requirements (WCAG AA/AAA)
- Must work with existing component library
- Performance budget (lightweight)
- Must support dark mode
- Must support RTL languages
- No specific constraints
- You decide reasonable defaults

For each selected, ask follow-up if needed:
- Brand colors → What are they?
- Accessibility → AA or AAA?
- Component library → Which one?
</step>

<step name="users_discovery">
## User Context

**Question: Who are the primary users?**

Options:
- General consumers (B2C)
- Business professionals (B2B)
- Internal team (Enterprise)
- Developers/Technical users
- Mixed audience
- You decide based on project type

Follow-up:
- Device expectations (mobile-first, desktop-first, both)
- Technical sophistication (affects UI complexity)
</step>

<step name="spawn_researcher">
## Deep Research (If Needed)

Spawn UI Researcher agent when:
- User provided "like [Product]" inspiration
- URL analysis needed
- Existing codebase has components to analyze
- Complex requirements need interpretation

Provide researcher with:
- Detected context
- User responses
- Specific research questions

### VoltAgent catalog shortcut for "Like [Product]"

When the user picked "Like [Product name]" in `design_context` and cited a brand, the researcher agent should FIRST check whether the brand matches a known entry in the VoltAgent/awesome-design-md catalog, **before** performing its default WebFetch + pattern-extraction flow.

**Known brands (hardcoded snapshot — favor previsibilidade over freshness):**

```
airbnb, apple, airtable, anthropic-claude, basecamp, brave, canva, chatgpt,
claude, cloudflare, coda, discord, dribbble, dropbox, duolingo, figma,
firefox, framer, github, gitlab, glassdoor, gmail, google, grammarly,
headspace, hubspot, intercom, jira, kickstarter, linear, linkedin, loom,
mailchimp, medium, microsoft, miro, netflix, notion, obsidian, openai,
patreon, pinterest, postmates, product-hunt, quora, raycast, reddit,
replit, riot, shopify, slack, snapchat, soundcloud, spotify, square,
squarespace, stack-overflow, stripe, substack, supabase, tailwind-ui,
tiktok, trello, tumblr, twitch, twitter-x, typeform, uber, ubereats,
vercel, vimeo, vk, webflow, whatsapp, wikipedia, wise, wistia, wordpress,
yelp, youtube, zapier, zendesk, zoom
```

(Lista mantida como referência. Novos nomes podem aparecer upstream — o comando `/ui:import-design-md voltagent:<name>` trata 404 graciosamente com fallback interativo, então é seguro tentar um nome fora da lista se o usuário insistir.)

**Matching logic (slugify before compare):**
- Lowercase the brand name.
- Replace spaces with `-` (e.g. "Stack Overflow" → `stack-overflow`).
- Strip diacritics.
- Check membership in the snapshot above.

**If the brand matches:**

Offer a shortcut BEFORE starting the normal "Like [Product]" analysis:

**Question: A VoltAgent tem um DESIGN.md curado para `<brand>`. Quer importar como ponto de partida?**

Options:
- Sim — importar via `/ui:import-design-md voltagent:<name>` (recomendado para acelerar setup)
- Não, prefiro análise fresca — seguir o fluxo padrão de WebFetch + extração de padrões
- Importar E depois fazer análise — usar o VoltAgent como base e enriquecer com análise do site atual

**If "Sim":** dispatch `/ui:import-design-md voltagent:<name>` and use the resulting artifacts as the output of this step. Skip the default WebFetch analysis for this brand.

**If "Importar E depois fazer análise":** dispatch the import first, then run WebFetch on the brand's site to extract anything not in DESIGN.md (screenshots, interaction patterns, recent refreshes). Merge findings into `UI-INSPIRATION.md`.

**If no match (or user declined):** follow the existing flow — WebFetch + pattern extraction against the cited brand.

Record the shortcut usage (or the declined offer) in `UI-DECISIONS.md` for provenance.
</step>

<step name="write_context">
## Write UI-CONTEXT.md

Create `.harn/design/UI-CONTEXT.md`:

```markdown
# UI Context

Last updated: [date]
Generated by: /ui:init

## Platform
- **Type:** [web/iOS/Android/cross-platform/desktop]
- **Framework:** [detected or specified]
- **Primary viewport:** [mobile-first/desktop-first/responsive]

## Tech Stack
- **Component library:** [if any]
- **Styling:** [Tailwind/CSS Modules/styled-components/etc]
- **State management:** [if detected]

## Existing Design System
- **Status:** [none/partial/complete]
- **Tokens:** [path if exists]
- **Components:** [count if detected]

## Constraints
- **Accessibility:** [WCAG level]
- **Brand:** [guidelines or "none"]
- **Dark mode:** [required/optional/no]
- **RTL:** [required/no]
- **Performance:** [notes]

## Users
- **Primary audience:** [description]
- **Device focus:** [mobile/desktop/both]
- **Technical level:** [low/medium/high]

## Inspiration
- **References:** [list or "none"]
- **Direction:** [modern minimal/bold/playful/etc]
- **See:** UI-INSPIRATION.md (if created)

## Integration
- **Requirements:** [path if exists]

## Provenance
- **Seeded from DESIGN.md:** [path or voltagent:<name> | "no"]
- **Imported at:** [timestamp if applicable]
```

**If the init flow imported a DESIGN.md** (either via auto-detection in `detect_context` or via the VoltAgent shortcut in `spawn_researcher`), the fields for Mood / Inspiration / Direction / Audience will already be populated in `UI-CONTEXT.md` by `/ui:import-design-md`. In that case, this step should only add the init-specific fields (Platform, Tech Stack, Constraints, Integration, Provenance) and preserve the imported content.
</step>

<step name="initialize_state">
## Initialize State Files

Create `.harn/design/ui-state/` directory and initialize:

**coordinator-state.json:**
```json
{
  "last_run": "[timestamp]",
  "project_status": {
    "phase": "initialized",
    "tokens_defined": false,
    "screens_total": 0,
    "screens_specified": 0,
    "components_total": 0,
    "components_specified": 0
  },
  "agent_sessions": {
    "researcher": { "last_run": "[timestamp]", "status": "complete" }
  }
}
```
</step>

<step name="completion">
## Completion Summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► PROJECT INITIALIZED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Platform:     [type] ([framework])
Styling:      [approach]
Constraints:  [summary]
Users:        [audience]
Inspiration:  [summary or "None specified"]

Seeded from DESIGN.md: [path | voltagent:<name> | "no"]
[If yes, list what was populated:]
  ✓ Tokens populated from §2, §3, §5, §6
  ✓ Mood / Inspiration / Audience populated from §1
  ✓ Components populated from §4 into COMPONENTS.md
  ✓ Do's / Don'ts populated from §7 into UI-PATTERNS.md / UI-DECISIONS.md
  ✓ Breakpoints / device focus populated from §8

Files Created/Updated:
  ✓ .harn/design/UI-CONTEXT.md
  ✓ .harn/design/ui-state/coordinator-state.json
  [✓ .harn/design/UI-INSPIRATION.md (if applicable)]
  [✓ .harn/design/design-tokens.json (if DESIGN.md imported)]
  [✓ .harn/design/COMPONENTS.md (if DESIGN.md imported)]
  [✓ .harn/design/UI-PATTERNS.md (if DESIGN.md imported)]
  [✓ .harn/design/UI-DECISIONS.md (always, for import log)]

───────────────────────────────────────────────────────

## ▶ Next Up

**Set up design tokens** — Define colors, typography, spacing

`/ui:setup-tokens`

Or if you have requirements:

`/ui:design-screens` — Jump straight to screen specs

───────────────────────────────────────────────────────
```
</step>

</process>

<success_criteria>
- `.harn/design/UI-CONTEXT.md` created with platform/framework/constraints
- State files initialized in `.harn/design/ui-state/`
- User preferences documented
- Inspiration analyzed (if provided)
- Clear next step recommended
- DESIGN.md at `./DESIGN.md`, `./docs/DESIGN.md`, `./design/DESIGN.md`, or `./.harn/design/DESIGN.md` is detected and user is offered an import before `platform_discovery`
- If multiple DESIGN.md files exist, user is asked which to use
- When "Like [Product]" cites a known VoltAgent brand, researcher offers `/ui:import-design-md voltagent:<name>` as shortcut BEFORE default WebFetch analysis
- Menu of `design_context` is NOT polluted with a fixed "Import from VoltAgent catalog" option — VoltAgent shortcut only surfaces when user organically cites a known brand via "Like [Product]"
- Completion summary documents when tokens/context/patterns were populated from a DESIGN.md import (path or voltagent:<name>)
</success_criteria>
