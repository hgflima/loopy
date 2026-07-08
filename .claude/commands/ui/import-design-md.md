---
name: ui:import-design-md
description: Import a DESIGN.md (VoltAgent/awesome-design-md format) into harness specs — from local path, URL, or VoltAgent catalog
argument-hint: "[source: voltagent:<name> | https://... | ./path/to/DESIGN.md]"
allowed-tools: [Read, Write, Edit, AskUserQuestion, WebFetch, Glob, Grep]
---

<objective>
Import a single-file DESIGN.md written in VoltAgent/awesome-design-md format and populate the corresponding harness artifacts: `.harn/design/design-tokens.json`, `COMPONENTS.md`, `UI-CONTEXT.md`, `UI-INSPIRATION.md`, `UI-PATTERNS.md`, and `UI-DECISIONS.md`. Detect conflicts with existing specs and resolve per user preference. Log the import for provenance so that `/ui:export design-md` can re-emit a consistent DESIGN.md later.
</objective>

<context>
@./.claude/ui-design/adapters/design-md.md
@.harn/design/design-tokens.json (if exists)
@.harn/design/UI-CONTEXT.md (if exists)
@.harn/design/UI-INSPIRATION.md (if exists)
@.harn/design/COMPONENTS.md (if exists)
@.harn/design/UI-PATTERNS.md (if exists)
@.harn/design/UI-DECISIONS.md (if exists)
</context>

<ux_principles>
## Three Source Types

The command accepts three forms of source:

1. **VoltAgent catalog shortcut** — `voltagent:<name>` resolves to the canonical raw URL in the VoltAgent/awesome-design-md repo.
2. **Arbitrary HTTPS URL** — any raw-file URL pointing to a DESIGN.md.
3. **Local path** — relative or absolute path on disk (including the harness's own output at `.harn/design/ui-exports/DESIGN.md`).

## Conflict Resolution

When an imported field collides with an existing spec value:
- Show a before/after diff.
- Offer: Keep existing, Use imported, or Merge (for list-shaped fields only).
- Log every resolution to `UI-DECISIONS.md`.

Reuse the same UX pattern as `/ui:import-tokens` (lines ~274–329).

## Drift / Provenance

Every import is recorded in `UI-DECISIONS.md` with source, date, and field-level actions. A subsequent `/ui:export design-md` should re-emit a DESIGN.md consistent with the freshly-populated specs.
</ux_principles>

<process>

<step name="parse_arguments">
## Parse Arguments

Parse the first positional argument as `<source>`. Classify it:

| Prefix / pattern | Source type | Resolution |
|------------------|-------------|------------|
| `voltagent:<name>` | VoltAgent catalog | Resolve to `https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/<name>/DESIGN.md` and fetch via WebFetch |
| `https://...` | Arbitrary URL | Fetch via WebFetch |
| `./...`, `../...`, `/...`, bare filename | Local path | Read directly |
| (no argument) | Interactive | Ask the user which source type to use (see `<step name="interactive_source">`) |

Examples:

- `/ui:import-design-md voltagent:claude`
- `/ui:import-design-md voltagent:stripe`
- `/ui:import-design-md https://example.com/DESIGN.md`
- `/ui:import-design-md ./DESIGN.md`
- `/ui:import-design-md /Users/me/Downloads/DESIGN.md`
- `/ui:import-design-md .harn/design/ui-exports/DESIGN.md` (round-trip)
</step>

<step name="interactive_source">
## Interactive Source Selection (when no argument provided)

**Question: Where is the DESIGN.md you want to import?**

Options:
- Local file — I'll provide the path
- Remote URL — I'll paste the HTTPS URL
- VoltAgent catalog — I'll name a brand (Claude, Stripe, Linear, Vercel, Notion, etc.)
- You decide — Show me what's available locally first

If "You decide" is selected, run Glob for `./DESIGN.md`, `./docs/DESIGN.md`, `./design/DESIGN.md`, `./.harn/design/DESIGN.md`, `./.harn/design/ui-exports/DESIGN.md` and offer any matches.
</step>

<step name="fetch_or_read">
## Fetch or Read the DESIGN.md

**Local path:**
- Use Read to load the file.
- If the file does not exist, abort with a clear error and suggest the three source types.

**HTTPS URL (including voltagent: resolution):**
- Use WebFetch with the prompt: "Return the raw Markdown contents of this DESIGN.md file, unmodified. Do not summarize."
- If the response is a 404 or the content does not look like a DESIGN.md (no `## 1.` heading within the first 100 lines), treat as error.

**VoltAgent 404 fallback:**

When `voltagent:<name>` returns 404, do NOT hardcode the catalog list in this command — it evolves upstream. Instead:

1. Report the 404 and the attempted URL.
2. Offer to try a short list of well-known brands as suggestions: `claude`, `stripe`, `linear`, `vercel`, `notion`, `github`, `airbnb`, `figma`, `shopify`, `spotify`.
3. Allow the user to retry with a corrected name, or fall back to manual URL entry.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► DESIGN.md FETCH FAILED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Tried: https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/<name>/DESIGN.md
Result: 404 Not Found

Known brands you can try:
  • voltagent:claude
  • voltagent:stripe
  • voltagent:linear
  • voltagent:vercel
  • voltagent:notion
  • voltagent:github
  • voltagent:airbnb
  • voltagent:figma
  • voltagent:shopify
  • voltagent:spotify

Or paste an arbitrary URL, or provide a local path.
───────────────────────────────────────────────────────
```
</step>

<step name="parse_sections">
## Parse the 9 Canonical Sections

Split the Markdown by top-level `## N. <Title>` headings. The adapter at `./.claude/ui-design/adapters/design-md.md` section `<reverse_sync>` is authoritative — follow its section-by-section extraction rules.

**Tolerant matching:**
- Match by leading number (`## 1.`, `## 2.`, …) primarily.
- Fall back to keyword match in the heading: "Visual Theme", "Color Palette", "Typography", "Component Styl", "Layout", "Depth", "Elevation", "Do's", "Don't", "Responsive", "Agent Prompt".
- If a section is entirely missing, record it in a `missing_sections` list and continue — do NOT abort.
- If a section contains only the placeholder `*Not yet defined — see [source-file].*`, record it as `placeholder` and skip extraction.

Report the parse result:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► DESIGN.md PARSED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Source:    [path or URL]
Size:      [N] bytes
Sections detected:
  ✓ §1 Visual Theme & Atmosphere
  ✓ §2 Color Palette & Roles       (light + dark)
  ✓ §3 Typography Rules
  ✓ §4 Component Stylings          (6 components)
  ✓ §5 Layout Principles
  ✓ §6 Depth & Elevation           (4 levels)
  ✓ §7 Do's and Don'ts             (5 do, 3 don't)
  ✓ §8 Responsive Behavior         (6 breakpoints)
  ○ §9 Agent Prompt Guide          (skipped — derived, not a source)

Missing / placeholder:
  [none]

───────────────────────────────────────────────────────
```
</step>

<step name="extract_color_tokens">
## §2 → `design-tokens.json` (color.*)

For each row in the Core Palette table, map the role name to a token path (inverse of the adapter `<token_mapping>`):

| Role in DESIGN.md | Token path |
|-------------------|------------|
| Primary | `color.primary.default` |
| Secondary | `color.secondary.default` |
| Background (page) | `color.background.default` |
| Background (subtle) | `color.background.subtle` |
| Surface (cards) | `color.surface.default` |
| Text primary | `color.text.default` |
| Text muted | `color.text.muted` |
| Border | `color.border.default` |
| Success | `color.success.default` |
| Warning | `color.warning.default` |
| Error / Destructive | `color.destructive.default` |

Emit each as:

```json
{
  "$value": "#HEX",
  "$type": "color",
  "$extensions": {
    "imported_from": "<source>"
  }
}
```

**Dark mode:** if a "Dark Mode" table is present, set `$extensions.mode.dark = "#HEX"` on the corresponding role (do NOT create a parallel `color.dark.*` tree).

**Unknown roles:** write to `color.extras.<slug>` and emit a warning in the summary.

**Rules block below the table:** append each rule to `UI-DECISIONS.md` as a color-usage decision (see `<step name="document_import">`).

Apply the W3C token transformation conventions from `/ui:import-tokens` (commands/ui/import-tokens.md lines ~185–271) — same hex / rgb / rgba parsing, same `$type: "color"` envelope, same `$metadata` block at the root.
</step>

<step name="extract_typography_tokens">
## §3 → `design-tokens.json` (fontFamily.*, fontSize.*, fontWeight.*, lineHeight.*)

**Font families** — each bullet maps to:

| Bullet label | Token path |
|--------------|------------|
| Sans | `fontFamily.sans.$value` |
| Serif | `fontFamily.serif.$value` |
| Mono | `fontFamily.mono.$value` |

**Scale table** — each row produces:

- `fontSize.<role>.$value` (value from Size column)
- `fontWeight.<role>.$value` (value from Weight column)
- `lineHeight.<role>.$value` (value from Line height column)

Where `<role>` is the lowercased heading name (`display`, `h1`, `h2`, `h3`, `body` → stored as `base`, `small` → `sm`, `code`).

**Rules block:** append each to `UI-DECISIONS.md` as a typography decision.

Reuse the W3C transformation logic from `/ui:import-tokens` (commands/ui/import-tokens.md lines ~211–232).
</step>

<step name="extract_spacing_shadow_tokens">
## §5 + §6 → `design-tokens.json` (spacing.*, shadow.*, borderRadius.*)

**§5 Spacing scale list:**
- Parse the comma-separated values in "Spacing scale:" (e.g. `8, 16, 24, 32`).
- Populate `spacing.1, spacing.2, …` in order, each as `{ "$value": "<value>px", "$type": "dimension" }`.
- If the file preserves a named index (e.g. `4: 16px`), use that index verbatim.

**§5 Grid / container / alignment rules:**
- Write to `UI-CONTEXT.md` under a "## Layout" section (create if missing).

**§6 Elevation table:**
- For each row, write `shadow.<role>.$value` (role from the Token column — `shadow.none`, `shadow.sm`, `shadow.md`, `shadow.lg`, `shadow.xl`).
- Use the CSS value from the Value column verbatim.

**§6 Philosophy sentence:**
- Append to `UI-DECISIONS.md` as an elevation-philosophy note.

Reuse the W3C shadow transformation from `/ui:import-tokens` (commands/ui/import-tokens.md lines ~255–271).
</step>

<step name="extract_components">
## §4 → `COMPONENTS.md`

For each sub-heading in §4 (Buttons, Inputs, Cards & Surfaces, Navigation, Feedback, Data display, …), create or update a section in `COMPONENTS.md`:

```markdown
## Button — Primary

**Source:** Imported from DESIGN.md (<source>) on <date>

**Visual treatment:**
[prose copied verbatim from §4 Buttons → Primary bullet]

**Attributes (parsed):**
- Fill: <color token if resolvable from §2>
- Text: <color>
- Radius: <value>
- Padding: <value>
- Hover: <change>
- Active: <change>
- Disabled: <change>
```

**Hex → token cross-linking:**
- Where §4 prose mentions a hex value, attempt to resolve it against the §2 palette and annotate the parsed attributes with the token name (e.g. `Fill: color.primary.default (#2563EB)`).
- Hex values that do not match any §2 role should remain as raw hex, and the importer should warn in the summary.

**Missing tokens:**
- If §4 prose mentions a radius or padding value not already present in `design-tokens.json` (`borderRadius.*`, `spacing.*`), add it and flag as auto-added in the summary.

Do NOT invent attributes. If the prose does not specify a field (e.g. no hover state), leave that attribute blank in the parsed block rather than fabricating.
</step>

<step name="extract_context_inspiration">
## §1 + §8 → `UI-CONTEXT.md` and `UI-INSPIRATION.md`

**§1 Visual Theme & Atmosphere:**
- Copy the prose paragraphs into `UI-CONTEXT.md` under a "## Design Direction" / "## Mood" subsection (create if missing).
- Pull `**Keywords:**` line → `tags` field in UI-CONTEXT.
- Pull `**Inspiration:**` line → `inspiration` field in UI-CONTEXT; also seed `UI-INSPIRATION.md` with a "## Imported from DESIGN.md" section listing the brands / references.
- Pull `**Audience:**` line → `audience` field in UI-CONTEXT.

**§8 Responsive Behavior:**
- Breakpoints table → `UI-CONTEXT.md` under "## Viewport Requirements" / "## Breakpoint System".
- Strategy (mobile-first / desktop-first) → `UI-CONTEXT.md` `primary_viewport`.
- Device focus → `UI-CONTEXT.md` `device_focus`.
- Rules bullets → `UI-PATTERNS.md` as responsive patterns with `status: recommended`.

If `UI-CONTEXT.md` already exists, apply conflict resolution (see `<step name="resolve_conflicts">`) for each field before overwriting.
</step>

<step name="extract_patterns_decisions">
## §7 → `UI-PATTERNS.md` + `UI-DECISIONS.md`

**§7 Do's → `UI-PATTERNS.md`:**

For each Do bullet, append (or update) an entry:

```markdown
## PAT-XXX: [paraphrase the Do]

**Source:** Imported from DESIGN.md (<source>) on <date>
**Status:** recommended
**Scope:** [system | component-specific — infer from prose]

**Rule:** [Do bullet verbatim, with "Always" / "Use" / etc. preserved]
```

**§7 Don'ts → `UI-DECISIONS.md`:**

For each Don't bullet, append:

```markdown
## DEC-XXX: Rejected — [paraphrase]

**Date:** <date>
**Source:** Imported from DESIGN.md (<source>)
**Chosen:** false (rejected option)
**Rule:** [Don't bullet verbatim]
**Rationale:** [from surrounding text if present, otherwise: "Imported as anti-pattern from DESIGN.md; no explicit rationale provided."]
```
</step>

<step name="ignore_section_9">
## §9 → Do NOT Write Back

§9 Agent Prompt Guide is a derived artifact. Do not persist it to any spec file. The content is regenerated every time `/ui:export design-md` runs, from the newly populated specs.

Record in `UI-DECISIONS.md` that a DESIGN.md was imported, with a pointer to the source (URL, `voltagent:<name>`, or local path) and the date — so that a future `/ui:export design-md` can re-emit §9 from the freshly populated specs.
</step>

<step name="resolve_conflicts">
## Conflict Resolution

Before writing any file, compute diffs against the existing state:

1. For each scalar field (e.g. `color.primary.default.$value`): compare imported vs existing.
2. For each list-shaped field (e.g. `UI-CONTEXT.md` keywords, `UI-PATTERNS.md` entries): compute added / removed / changed entries.
3. Display a summary similar to `/ui:import-tokens` conflict prompt:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► IMPORT — EXISTING SPECS FOUND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The import affects the following fields:

Design tokens:
  ⚡ Modified:  color.primary.default (#2563EB → #3B82F6)
  ⚡ Modified:  color.background.default (#FFFFFF → #FAFAFA)
  ✚ Added:     color.destructive.default (new)
  ○ Unchanged: fontFamily.*, spacing.*, shadow.*

UI-CONTEXT.md:
  ⚡ Modified:  device_focus ("mobile-first" → "desktop-first")
  ○ Unchanged: tags, audience

COMPONENTS.md:
  ✚ Added:     Button / Primary
  ✚ Added:     Input / text
  ⚡ Modified:  Card (different radius value)

UI-PATTERNS.md:
  ✚ Added:     3 Do patterns from §7
UI-DECISIONS.md:
  ✚ Added:     2 Don't entries from §7
  ✚ Added:     1 import record

How would you like to proceed?
───────────────────────────────────────────────────────
```

**Question: How to handle conflicts?**

Options:
- Merge (imported values win on conflict)
- Merge (existing values win on conflict)
- Replace all (overwrite completely with imported)
- Review each conflict individually

**If "Review individually"** — for each conflicting field show:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► CONFLICT: color.primary.default
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Existing:  #2563EB  ████
Imported:  #3B82F6  ████

Which value to keep?
───────────────────────────────────────────────────────
```

Options: Keep existing / Use imported / Skip this field.

Same pattern as `/ui:import-tokens` (commands/ui/import-tokens.md lines ~308–329).

**Log every resolution** to `UI-DECISIONS.md` with date, field, chosen action.
</step>

<step name="write_artifacts">
## Write Artifacts

After conflict resolution, write all files:

1. `.harn/design/design-tokens.json` — updated tokens with root `$metadata`:
   ```json
   {
     "$metadata": {
       "source": "DESIGN.md",
       "imported": "<timestamp>",
       "original_source": "<path | URL | voltagent:name>"
     }
   }
   ```
2. `.harn/design/UI-CONTEXT.md` — updated with §1 + §8 data.
3. `.harn/design/UI-INSPIRATION.md` — new section seeded from §1 inspiration/keywords.
4. `.harn/design/COMPONENTS.md` — updated with §4 component sections.
5. `.harn/design/UI-PATTERNS.md` — appended §7 Do's.
6. `.harn/design/UI-DECISIONS.md` — appended §7 Don'ts, conflict resolutions, and import record.

**Post-write verification** (same as `/ui:import-tokens`):
- Valid JSON in tokens.
- All referenced tokens exist.
- Component prose references only tokens defined in §2 (warn on mismatches, do not fail).
- Color contrast still meets stated rules (from §2 "Rules" block); warn on violations.

Flag any inconsistency as a warning — the user chose to import and may intend to resolve later.
</step>

<step name="document_import">
## Document Import in UI-DECISIONS.md

Append a provenance record at the end of every import:

```markdown
## DEC-XXX: DESIGN.md Import

**Date:** <date>
**Source:** <source — verbatim argument: voltagent:claude | https://... | ./DESIGN.md>
**Resolved URL:** <final URL fetched, or "local file">
**File size:** <N> bytes
**Sections imported:** §1, §2 (10 roles, dark mode), §3, §4 (6 components), §5, §6 (4 levels), §7 (5 Do, 3 Don't), §8 (6 breakpoints)
**Sections skipped:** §9 (derived, not a source)
**Conflicts resolved:**
  - color.primary.default: Use imported (#3B82F6 replaced #2563EB)
  - UI-CONTEXT device_focus: Keep existing
**Auto-added tokens:** borderRadius.xl, spacing.20
**Warnings:** 1 hex in §4 prose (`#E2E8F0` in Input description) did not match any §2 role — left as raw hex
```

This record is what enables a subsequent `/ui:export design-md` to re-emit §9 Agent Prompt Guide consistent with the imported system.
</step>

<step name="update_state">
## Update State

Update `.harn/design/ui-state/coordinator-state.json` to record the import:

```json
{
  "project_status": {
    "imports": {
      "design_md": {
        "last_import": "<timestamp>",
        "source": "<source argument>",
        "sections_imported": 8,
        "conflicts_resolved": 2
      }
    }
  }
}
```
</step>

<step name="completion">
## Completion Summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► DESIGN.md IMPORTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Source:    [voltagent:claude | URL | ./path]
Sections:  8 imported, 1 skipped (§9 derived)

Tokens:
  Colors:       11 roles (light) + 4 (dark)
  Typography:   3 families, 7 scale steps
  Spacing:      4 values
  Shadows:      4 levels

Components:    6 populated in COMPONENTS.md
Patterns:      3 Do's added to UI-PATTERNS.md
Decisions:     2 Don'ts + 2 conflict resolutions logged

Files Updated:
  ✓ .harn/design/design-tokens.json
  ✓ .harn/design/UI-CONTEXT.md
  ✓ .harn/design/UI-INSPIRATION.md
  ✓ .harn/design/COMPONENTS.md
  ✓ .harn/design/UI-PATTERNS.md
  ✓ .harn/design/UI-DECISIONS.md
  ✓ .harn/design/ui-state/coordinator-state.json

Warnings:
  • 1 hex in §4 prose did not match §2 palette (left as raw)
  • §9 Agent Prompt Guide skipped (derived artifact)

───────────────────────────────────────────────────────

## ▶ Next Up

**Review tokens and context** — Verify the imported values

`/ui:status`

**Design screens** — Now that the visual system is seeded

`/ui:design-screens`

**Round-trip** — Re-emit a DESIGN.md consistent with the specs

`/ui:export design-md`

───────────────────────────────────────────────────────
```
</step>

</process>

<success_criteria>
- Source resolved correctly (voltagent: → URL, URL → fetched, local → read).
- All 9 sections parsed tolerantly (match by number or keyword; missing sections tracked, not fatal).
- Tokens transformed to W3C format and written to `design-tokens.json` with root `$metadata`.
- `UI-CONTEXT.md`, `UI-INSPIRATION.md`, `COMPONENTS.md`, `UI-PATTERNS.md`, `UI-DECISIONS.md` populated per the adapter's `<reverse_sync>` rules.
- §9 Agent Prompt Guide explicitly skipped and documented as derived.
- Conflicts surfaced with diff and resolved per user preference.
- Every resolution logged to `UI-DECISIONS.md` with field, action, date.
- Import record appended to `UI-DECISIONS.md` with source + resolved URL + sections + warnings.
- State file updated with import metadata.
- Round-trip works: `/ui:export design-md` after `/ui:import-design-md` produces a semantically equivalent DESIGN.md (modulo prose paraphrasing).
</success_criteria>
