---
name: ui:import-design
description: Import design from external tools back into specifications (reverse sync)
allowed-tools: [Read, Write, Edit, AskUserQuestion, Glob, Grep, Task]
agent: ui-researcher (for design analysis)
---

<objective>
Import design outputs from external tools (Stitch, V0, Figma) back into the specification system. Analyze designs for drift from original specs, extract new patterns, and update specifications to reflect implemented reality.
</objective>

<context>
@.harn/design/UI-SPEC.md (if exists)
@.harn/design/screens/*.md (if exists)
@.harn/design/design-tokens.json (if exists)
@.harn/design/COMPONENTS.md (if exists)
</context>

<ux_principles>
## Import Sources

Support multiple import methods:
- Screenshot/image analysis
- URL to generated design
- Code export from V0
- Figma file analysis (via description)

## Drift Detection

Compare imported design against existing specs:
- Identify intentional changes
- Flag unintentional drift
- Suggest spec updates
</ux_principles>

<process>

<step name="identify_source">
## Identify Import Source

**Question: What are you importing?**

Options:
- Screenshot/image of generated design
- V0 generated code (paste or file path)
- Figma design description
- Live implementation URL
- Stitch export files

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► IMPORT DESIGN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Import a realized design back into your specifications.

This helps you:
  • Capture design decisions made in external tools
  • Update specs to match implementation
  • Detect drift between spec and reality
  • Extract new patterns

Select your import source.
───────────────────────────────────────────────────────
```
</step>

<step name="identify_screen">
## Identify Target Screen

**Question: Which screen does this design correspond to?**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► SELECT SCREEN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Which screen specification does this design match?

Existing screens:
  ○ SCR-01: Login
  ○ SCR-02: Signup
  ○ SCR-03: Dashboard
  ○ SCR-04: Settings

Or:
  ○ New screen (not yet specified)
───────────────────────────────────────────────────────
```

If new screen:
- Create specification from the design
- Assign next SCR-XX ID
</step>

<step name="analyze_design">
## Analyze Imported Design

**For Screenshot/Image:**
Spawn UI Researcher agent to analyze:
- Layout structure
- Components used
- Color values (approximate)
- Typography (font family, sizes)
- Spacing patterns
- States visible

**For V0 Code:**
Parse the React/TypeScript code:
- Extract component structure
- Identify shadcn/ui components used
- Parse Tailwind classes for styling
- Extract color values
- Map to existing components

**For Figma Description:**
Interpret the textual description:
- Layout details
- Component list
- Style specifications
- Interaction notes

Report analysis:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► DESIGN ANALYZED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Screen: SCR-01 Login

Detected:
  Layout:      Centered card on gray background
  Components:  Card, Input (2), Button (3), Separator, Link (2)
  Colors:      Primary #2563EB, Background #F8FAFC
  Typography:  Sans-serif (Inter-like)
  Spacing:     Comfortable (16-24px gaps)

Comparing to specification...
───────────────────────────────────────────────────────
```
</step>

<step name="detect_drift">
## Detect Drift from Specification

Compare analyzed design against existing spec:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► DRIFT DETECTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Comparing design to SCR-01 specification...

✓ Match: Layout (centered card)
✓ Match: Primary color (#2563EB)
✓ Match: Input components (2)

⚡ Drift: Button count
   Spec: 1 primary button
   Design: 3 buttons (primary + 2 social)
   → Social buttons added

⚡ Drift: New component
   Spec: No separator
   Design: Has "or continue with" separator
   → Separator added

⚡ Drift: Color addition
   Spec: No explicit background
   Design: #F8FAFC page background
   → Background color specified

○ New: Google icon
○ New: GitHub icon

───────────────────────────────────────────────────────
```
</step>

<step name="categorize_changes">
## Categorize Changes

For each drift, determine:

**Intentional Enhancements:**
- New components added for better UX
- Color refinements
- Spacing adjustments
- Additional states

**Unintentional Drift:**
- Missing required components
- Wrong colors
- Incorrect layout
- Missing accessibility features

**New Patterns:**
- Reusable patterns discovered
- New component variants
- Interaction patterns

Present categorization:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► CHANGE CATEGORIZATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Please categorize each change:

1. Social login buttons (Google, GitHub)
   ○ Intentional enhancement — Add to spec
   ○ Unintentional — Revert in next iteration
   ○ New pattern — Document for reuse

2. "Or continue with" separator
   ○ Intentional enhancement — Add to spec
   ○ Unintentional — Revert
   ○ New pattern — Document

3. Background color #F8FAFC
   ○ Intentional — Add to tokens
   ○ Unintentional — Revert
───────────────────────────────────────────────────────
```
</step>

<step name="update_specification">
## Update Specification

For intentional enhancements, update the screen spec:

```markdown
## Changes Applied to SCR-01-login.md

### 5. Components (updated)
Added:
- SocialButton | google | - | Google OAuth
- SocialButton | github | - | GitHub OAuth
- Separator | with-text | text="or continue with" | Social divider

### 4. Layout Structure (updated)
Added:
- **Background:** color.background.subtle (#F8FAFC)
```

For new tokens, update design-tokens.json:
```json
{
  "color": {
    "background": {
      "subtle": { "$value": "#F8FAFC", "$type": "color" }
    }
  }
}
```
</step>

<step name="extract_patterns">
## Extract New Patterns

If social login pattern is new:

```markdown
## PAT-XX: Social Authentication

**Used in:** SCR-01 Login, SCR-02 Signup

**Structure:**
1. Primary action button
2. Separator with "or" text
3. Social provider buttons (horizontal row)

**Components:**
- Separator (with-text variant)
- SocialButton (google, github, etc.)

**Visual:**
```
[     Primary Action     ]
────────── or ──────────
[Google] [GitHub] [Apple]
```

**Guidelines:**
- Primary action should be above social options
- Use "or continue with" for sign-in
- Use "or sign up with" for registration
```

Add to `.harn/design/UI-PATTERNS.md`.
</step>

<step name="update_registry">
## Update Registry

Update `.harn/design/UI-REGISTRY.md`:

```markdown
## Screen Realization Status

| Screen | Specified | Exported | Realized | Last Sync |
|--------|-----------|----------|----------|-----------|
| SCR-01 | ✓ | Stitch | ✓ v1.1 | 2026-01-19 |
| SCR-02 | ✓ | V0 | ○ | - |

## SCR-01 History

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | 2026-01-18 | Initial specification |
| v1.1 | 2026-01-19 | Added social login from Stitch output |
```
</step>

<step name="document_decision">
## Document Decisions

Append to `.harn/design/UI-DECISIONS.md`:

```markdown
## DEC-XXX: Social Login Addition
**Date:** [date]
**Screen:** SCR-01 Login
**Source:** Imported from Stitch generation
**Decision:** Add Google and GitHub social login options
**Rationale:** Improves user experience, reduces friction
**Pattern:** PAT-XX Social Authentication

## DEC-XXX: Background Color
**Date:** [date]
**Source:** Imported from Stitch generation
**Decision:** Use #F8FAFC as subtle background
**Token added:** color.background.subtle
```
</step>

<step name="completion">
## Completion Summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► DESIGN IMPORTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Screen: SCR-01 Login
Source: [Stitch screenshot / V0 code / etc.]

Changes Applied:
  ✓ Added social login buttons
  ✓ Added separator component
  ✓ Added background color token
  ✓ Updated component list

New Patterns:
  ✓ PAT-XX: Social Authentication

Files Updated:
  ✓ .harn/design/screens/SCR-01-login.md
  ✓ .harn/design/design-tokens.json
  ✓ .harn/design/UI-PATTERNS.md
  ✓ .harn/design/UI-REGISTRY.md
  ✓ .harn/design/UI-DECISIONS.md

───────────────────────────────────────────────────────

## ▶ Next Steps

**Regenerate exports** — Update prompts with new spec

`/ui:export [service] SCR-01`

**Update components** — Refresh component inventory

`/ui:define-components`

**Check sync** — Verify all screens are aligned

`/ui:sync`

───────────────────────────────────────────────────────
```
</step>

</process>

<success_criteria>
- Design analyzed and compared to specification
- Drift detected and categorized
- Intentional changes incorporated into spec
- New patterns extracted and documented
- Tokens updated if needed
- Registry updated with realization status
- Decisions documented
</success_criteria>
