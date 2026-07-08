---
name: ui:decisions
description: View and manage UI design decisions log
argument-hint: "[add|view|filter] [options]"
allowed-tools: [Read, Write, Edit, Glob, AskUserQuestion]
---

<objective>
View, search, and add to the UI design decisions log. Track the rationale behind design choices for future reference and team alignment.
</objective>

<context>
@.harn/design/UI-DECISIONS.md (if exists)
@.harn/design/UI-CONTEXT.md (if exists)
</context>

<ux_principles>
## Decision Tracking

Every significant UI decision should be documented:
- Color choices
- Typography selections
- Component library decisions
- Pattern establishments
- Import/export decisions
- Trade-offs made

## Easy Retrieval

Allow filtering by:
- Category (tokens, screens, components, patterns)
- Date range
- Screen ID
- Decision ID
</ux_principles>

<process>

<step name="parse_arguments">
## Parse Arguments

```
/ui:decisions              → View recent decisions
/ui:decisions view         → View all decisions
/ui:decisions add          → Add new decision
/ui:decisions filter       → Filter decisions
/ui:decisions DEC-005      → View specific decision
```
</step>

<step name="view_decisions">
## View Decisions

**Default view (recent):**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► DESIGN DECISIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Recent Decisions (last 10):

DEC-010  Jan 19  tokens     Primary color refinement
DEC-009  Jan 19  pattern    Social authentication pattern
DEC-008  Jan 19  import     Social login from Stitch
DEC-007  Jan 18  tokens     Background color addition
DEC-006  Jan 18  tokens     Typography scale: Comfortable
DEC-005  Jan 18  tokens     Font family: Inter
DEC-004  Jan 18  pattern    Auth card pattern established
DEC-003  Jan 17  component  Button variants finalized
DEC-002  Jan 17  context    Platform: Next.js + Tailwind
DEC-001  Jan 17  context    shadcn/ui as component base

Total: 10 decisions

───────────────────────────────────────────────────────

View specific: /ui:decisions DEC-005
Add new:       /ui:decisions add
Filter:        /ui:decisions filter --category=tokens

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**View specific decision:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► DECISION DEC-005
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## DEC-005: Font Family Selection

**Date:** 2026-01-18
**Category:** Tokens
**Impact:** High (affects all text)

### Decision
Use Inter as the primary font family.

### Alternatives Considered
1. **System UI** — Faster loading, native feel
   - Pro: Zero font loading
   - Con: Inconsistent across platforms

2. **Plus Jakarta Sans** — Friendly, geometric
   - Pro: Distinctive character
   - Con: Less versatile for data-heavy UIs

3. **DM Sans** — Approachable, readable
   - Pro: Good at small sizes
   - Con: Less suitable for headings

### Rationale
Inter was chosen because:
- Excellent legibility at all sizes
- Wide range of weights
- Great for both UI and content
- Similar to Linear/Vercel inspiration
- Open source, freely available

### Affected Files
- .harn/design/design-tokens.json (typography.fontFamily.sans)
- All screen specifications
- All exports

### Related Decisions
- DEC-006: Typography scale
- DEC-002: Platform context

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
</step>

<step name="filter_decisions">
## Filter Decisions

**By category:**
```
/ui:decisions filter --category=tokens

Results: 5 decisions

DEC-010  Primary color refinement
DEC-007  Background color addition
DEC-006  Typography scale: Comfortable
DEC-005  Font family: Inter
DEC-003  Button variants finalized
```

**By date:**
```
/ui:decisions filter --since=2026-01-18

Results: 4 decisions
```

**By screen:**
```
/ui:decisions filter --screen=SCR-01

Results: 3 decisions affecting SCR-01
DEC-008  Social login import
DEC-004  Auth card pattern
DEC-003  Button variants
```
</step>

<step name="add_decision">
## Add Decision

Interactive decision creation:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► ADD DECISION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Adding decision DEC-011

What category?
───────────────────────────────────────────────────────
```

**Question: Decision category?**

Options:
- Tokens — Color, typography, spacing choices
- Components — Component design decisions
- Patterns — Pattern establishment/changes
- Screens — Screen-specific decisions
- Context — Platform, framework, constraints
- Import — Design import decisions
- Other

**Question: Decision title?**

(Free text)

**Question: Alternatives considered?**

Options:
- Yes, document alternatives
- No alternatives considered
- Single option (no choice)

**Question: What was the rationale?**

(Free text)

**Generated decision:**

```markdown
## DEC-011: [Title]

**Date:** 2026-01-19
**Category:** [category]
**Impact:** [Low/Medium/High]

### Decision
[What was decided]

### Alternatives Considered
[If any]

### Rationale
[Why this choice]

### Affected Files
[List]

### Related Decisions
[If any]
```
</step>

<step name="decision_format">
## Decision File Format

`.harn/design/UI-DECISIONS.md`:

```markdown
# UI Design Decisions

This log tracks significant UI design decisions made during the project.

## Decision Index

| ID | Date | Category | Decision |
|----|------|----------|----------|
| DEC-010 | 2026-01-19 | tokens | Primary color refinement |
| DEC-009 | 2026-01-19 | pattern | Social authentication pattern |
| DEC-008 | 2026-01-19 | import | Social login from Stitch |
| ... | ... | ... | ... |

---

## DEC-010: Primary Color Refinement

**Date:** 2026-01-19
**Category:** Tokens
**Impact:** Medium

### Decision
Adjust primary-500 from #3B82F6 to #2563EB for better contrast.

### Rationale
The original blue was too light against white backgrounds,
failing WCAG AA contrast requirements for text.

### Affected Files
- .harn/design/design-tokens.json
- Requires export refresh for all services

---

## DEC-009: Social Authentication Pattern

[Continue...]
```
</step>

<step name="completion">
## Completion Summary

**For view:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► DECISIONS DISPLAYED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Showing [N] decisions

Quick Actions:
  /ui:decisions add          Add new decision
  /ui:decisions DEC-XXX      View specific decision
  /ui:decisions filter       Search decisions

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**For add:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► DECISION ADDED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Added: DEC-011: [Title]
Category: [category]
Impact: [level]

File Updated: .harn/design/UI-DECISIONS.md

───────────────────────────────────────────────────────

## ▶ Continue With

- `/ui:design-screens` — Update screens affected by this decision
- `/ui:sync` — Check if implementations need updating
- `/ui:export` — Regenerate exports reflecting the change
- `/ui:status` — Review overall spec coverage

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
</step>

</process>

<success_criteria>
- Decisions log viewable and searchable
- New decisions can be added
- Filter by category, date, screen
- Decision format is consistent
- Rationale and alternatives documented
- Related decisions linked
</success_criteria>
