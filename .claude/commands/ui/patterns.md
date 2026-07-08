---
name: ui:patterns
description: Document and manage reusable UI patterns
argument-hint: "[add|view|extract] [pattern-id]"
allowed-tools: [Read, Write, Edit, Glob, Grep, AskUserQuestion, Task]
agent: ui-specifier (for pattern extraction)
---

<objective>
Document, manage, and extract reusable UI patterns from screen specifications. Patterns capture common structures that appear across multiple screens, enabling consistency and faster specification.
</objective>

<context>
@.harn/design/UI-PATTERNS.md (if exists)
@.harn/design/screens/*.md (required for extraction)
@.harn/design/COMPONENTS.md (if exists)
</context>

<ux_principles>
## Pattern Discovery

Patterns emerge from:
- Similar structures across screens
- Common interaction models
- Repeated component combinations
- Established design conventions

## Pattern Documentation

Each pattern should include:
- Visual representation (ASCII)
- Component list
- Usage guidelines
- Variations
- Examples
</ux_principles>

<process>

<step name="parse_arguments">
## Parse Arguments

```
/ui:patterns              → View pattern inventory
/ui:patterns view         → View all patterns
/ui:patterns add          → Add new pattern manually
/ui:patterns extract      → Auto-extract from screens
/ui:patterns PAT-01       → View specific pattern
```
</step>

<step name="view_patterns">
## View Patterns

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► PATTERN LIBRARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Documented Patterns: 5

PAT-01  Auth Card              Used in: SCR-01, SCR-02, SCR-03
        Centered card with form, logo, and footer links

PAT-02  Data Table             Used in: SCR-04, SCR-05
        Sortable table with filters and pagination

PAT-03  Detail View            Used in: SCR-06
        Header with back button, content sections, action footer

PAT-04  Settings Section       Used in: SCR-07, SCR-08
        Grouped settings with labels and controls

PAT-05  Empty State            Used in: SCR-04, SCR-05, SCR-06
        Illustration, message, and action button

───────────────────────────────────────────────────────

View specific: /ui:patterns PAT-01
Add pattern:   /ui:patterns add
Auto-extract:  /ui:patterns extract

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
</step>

<step name="view_specific_pattern">
## View Specific Pattern

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► PATTERN: PAT-01 Auth Card
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Description
A centered card containing an authentication form with
logo, heading, form fields, primary action, and footer links.

## Used In
- SCR-01: Login
- SCR-02: Signup
- SCR-03: Forgot Password

## Structure

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│              ┌─────────────────────┐               │
│              │       Logo          │               │
│              ├─────────────────────┤               │
│              │                     │               │
│              │      Heading        │               │
│              │      Subheading     │               │
│              │                     │               │
│              │  ┌───────────────┐  │               │
│              │  │  Form Field   │  │               │
│              │  └───────────────┘  │               │
│              │                     │               │
│              │  ┌───────────────┐  │               │
│              │  │  Form Field   │  │               │
│              │  └───────────────┘  │               │
│              │                     │               │
│              │  [Primary Action ]  │               │
│              │                     │               │
│              │   Secondary Link    │               │
│              │                     │               │
│              └─────────────────────┘               │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Components
| Component | Role | Required |
|-----------|------|----------|
| Container | Page background | ✓ |
| Card | Form container | ✓ |
| Logo/Icon | Brand element | Optional |
| Heading | Primary text | ✓ |
| Subheading | Secondary text | Optional |
| Form Fields | User inputs | ✓ |
| Button | Primary action | ✓ |
| Link | Secondary actions | ✓ |

## Variations

### With Social Login
```
│  [Primary Action ]  │
│                     │
│ ────── or ──────── │
│                     │
│ [Google] [GitHub]   │
```

### With Progress
```
│  Step 1 of 3        │
│  ━━━━━░░░░░░        │
```

## Guidelines
- Card max-width: 400px
- Center vertically and horizontally
- Background: color.background.subtle
- Card shadow: shadow.md
- Form gap: spacing.4
- Button: full width

## Token References
| Property | Token |
|----------|-------|
| Background | color.background.subtle |
| Card background | color.background.default |
| Card shadow | shadow.md |
| Card radius | border.radius.lg |
| Heading size | typography.fontSize.2xl |
| Form gap | spacing.4 |

## Decision
DEC-004: Auth card pattern established

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
</step>

<step name="extract_patterns">
## Auto-Extract Patterns

Spawn UI Specifier agent to analyze screens for patterns:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► EXTRACTING PATTERNS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Analyzing 8 screen specifications...

Similarity Analysis:
  SCR-01, SCR-02, SCR-03 → 85% similar structure
  SCR-04, SCR-05 → 78% similar structure
  SCR-07, SCR-08 → 72% similar structure

Detected Potential Patterns:

1. ✓ Auth Card (existing PAT-01)
   Matches: SCR-01, SCR-02, SCR-03
   Status: Already documented

2. ? Dashboard Header
   Matches: SCR-04, SCR-05, SCR-06
   Structure: Title + actions + breadcrumb
   → Document as new pattern?

3. ? Form Section
   Matches: SCR-07, SCR-08
   Structure: Label, description, control
   → Document as new pattern?

───────────────────────────────────────────────────────
```

**Question: Which patterns to document?**

Options (multi-select):
- Document Dashboard Header (PAT-06)
- Document Form Section (PAT-07)
- Skip pattern extraction
- Review manually first
</step>

<step name="add_pattern">
## Add Pattern Manually

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► ADD PATTERN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Creating pattern PAT-06

───────────────────────────────────────────────────────
```

**Question: Pattern name?**

(Free text, e.g., "Dashboard Header")

**Question: Which screens use this pattern?**

Options (multi-select):
- SCR-01: Login
- SCR-02: Signup
- ...

**Question: Provide ASCII representation?**

Options:
- Yes, I'll describe it
- Generate from first screen
- Skip for now

**Generate pattern documentation:**

```markdown
## PAT-06: Dashboard Header

**Added:** 2026-01-19
**Used in:** SCR-04, SCR-05, SCR-06

### Description
[Generated from input]

### Structure
[ASCII from input or generated]

### Components
[Extracted from matching screens]

### Guidelines
[Inferred from specs]

### Token References
[Extracted from specs]
```
</step>

<step name="write_patterns_file">
## Write Patterns File

Create or update `.harn/design/UI-PATTERNS.md`:

```markdown
# UI Patterns

Last updated: [date]
Patterns: [N] documented

## Pattern Index

| ID | Name | Used In | Status |
|----|------|---------|--------|
| PAT-01 | Auth Card | SCR-01, SCR-02, SCR-03 | Documented |
| PAT-02 | Data Table | SCR-04, SCR-05 | Documented |
| PAT-03 | Detail View | SCR-06 | Documented |
| PAT-04 | Settings Section | SCR-07, SCR-08 | Documented |
| PAT-05 | Empty State | Multiple | Documented |

---

## PAT-01: Auth Card

[Full pattern documentation...]

---

## PAT-02: Data Table

[Full pattern documentation...]

---

[Continue for each pattern...]
```
</step>

<step name="update_specs">
## Update Screen Specs

Add pattern references to screen specs:

```markdown
## 2. Purpose
This screen implements the **Auth Card** pattern (PAT-01)
for user authentication.

## See Also
- Pattern: PAT-01 Auth Card
```
</step>

<step name="completion">
## Completion Summary

**For view:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► PATTERNS DISPLAYED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Showing [N] patterns

Quick Actions:
  /ui:patterns add          Add new pattern
  /ui:patterns extract      Auto-extract from screens
  /ui:patterns PAT-XX       View specific pattern

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**For extract:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► PATTERNS EXTRACTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Analyzed: 8 screens
New patterns: 2

Added:
  ✓ PAT-06: Dashboard Header (3 screens)
  ✓ PAT-07: Form Section (2 screens)

Files Updated:
  ✓ .harn/design/UI-PATTERNS.md
  ✓ .harn/design/screens/SCR-04-dashboard.md (pattern reference)
  ✓ .harn/design/screens/SCR-05-items.md (pattern reference)
  [...]

───────────────────────────────────────────────────────

## ▶ Next Steps

Review extracted patterns for accuracy:
  /ui:patterns PAT-06
  /ui:patterns PAT-07

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
</step>

</process>

<success_criteria>
- Patterns viewable and searchable
- New patterns can be added manually
- Patterns auto-extracted from screen specs
- Each pattern has ASCII representation
- Component lists documented
- Token references included
- Screen specs updated with pattern references
</success_criteria>
