---
name: ui:generate-specs
description: Auto-generate UI specs from code analysis (after /ui:scan)
allowed-tools: [Read, Write, Edit, Glob, Grep, AskUserQuestion, Task]
agent: ui-specifier
---

<objective>
Generate UI specifications from the CODE-ANALYSIS.md created by `/ui:scan`. Auto-creates screen specs, COMPONENTS.md, and UI-SPEC.md based on discovered components and screens. This bridges the gap between codebase analysis and design tool export.

**Use case:** After reviewing `/ui:scan` results, auto-generate formal specs ready for export.
</objective>

<context>
@./.claude/ui-design/templates/screen.md
@./.claude/ui-design/templates/component.md
@./.claude/ui-design/templates/ui-spec.md
@.harn/design/CODE-ANALYSIS.md (required)
@.harn/design/design-tokens.json (if exists)
</context>

<ux_principles>
## Smart Defaults

- Generate complete specs from analysis data
- Infer missing details where reasonable
- Mark inferred sections as [INFERRED]

## Selective Generation

- Allow generating all or specific screens
- Skip already-specified screens
- Offer to enhance existing specs

## Quality Over Speed

- Generate proper 10-section screen specs
- Include all discovered states
- Map all component relationships
</ux_principles>

<process>

<step name="check_prerequisites">
## Check Prerequisites

1. **Require CODE-ANALYSIS.md:**
   ```
   if not exists .harn/design/CODE-ANALYSIS.md:
     "No code analysis found. Run /ui:scan first."
     exit
   ```

2. **Check for existing specs:**
   - If `.harn/design/UI-SPEC.md` exists, ask:
     - "Enhance existing specs with analysis"
     - "Regenerate all specs (overwrites)"
     - "Generate only missing specs"

   - If `screens/*.md` exist, note which screens are specified

3. **Load analysis data:**
   - Parse CODE-ANALYSIS.md
   - Load design-tokens.json if exists
</step>

<step name="generation_scope">
## Determine Generation Scope

Ask user:

**Question: What do you want to generate?**

Options:
- Everything (UI-SPEC.md + all screens + COMPONENTS.md)
- Screen specs only
- COMPONENTS.md only
- UI-SPEC.md shell only
- Specific screens (will prompt for selection)

**For specific screens:**
Show list from CODE-ANALYSIS.md:
- [ ] SCR-01: Login (/login)
- [ ] SCR-02: Signup (/signup)
- [ ] SCR-03: Dashboard (/dashboard)
- ...

</step>

<step name="generate_ui_spec">
## Generate UI-SPEC.md

Create master spec document:

```markdown
# UI Specification: [Project Name]

> Auto-generated from code analysis
> Version: 1.0.0 | Generated: YYYY-MM-DD

## Overview

[Project name] is a [framework] application with [N] screens and [N] components.
[Brief description inferred from route structure and components]

### Key Metrics

| Metric | Count |
|--------|-------|
| Screens | [from analysis] |
| Components | [from analysis] |
| Breakpoints | [inferred] |
| Theme Modes | [from token extraction] |

## Design System

**Tokens:** `.harn/design/design-tokens.json`
**Components:** `.harn/design/COMPONENTS.md`
**Analysis:** `.harn/design/CODE-ANALYSIS.md`

### Target Stack

| Aspect | Detected | Notes |
|--------|----------|-------|
| Component Library | [from analysis] | - |
| Styling | [from analysis] | - |
| Icons | [from analysis] | - |

[Continue with full UI-SPEC template structure...]
```
</step>

<step name="generate_components">
## Generate COMPONENTS.md

Transform component inventory from analysis:

```markdown
# Component Inventory

> Auto-generated from code analysis
> Source: .harn/design/CODE-ANALYSIS.md

## Overview

Total: [N] components across [N] categories

## Components by Category

### Primitives

#### Button

**Source:** `[path from analysis]`
**Status:** Discovered

| Prop | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| [extracted props from analysis] |

**Variants:**
[from analysis]

**Usage:** [N] instances across [N] screens

---

[Continue for all components...]
```
</step>

<step name="generate_screens">
## Generate Screen Specs

For each screen in CODE-ANALYSIS.md, create full 10-section spec:

**File:** `.harn/design/screens/SCR-XX-[name].md`

```markdown
# SCR-XX: [Screen Name]

> Auto-generated from code analysis
> Source: [page file path]

## 1. Meta

| Field | Value |
|-------|-------|
| ID | SCR-XX |
| Route | [from analysis] |
| Layout | [from analysis] |
| Status | Generated |
| Source | `[file path]` |

## 2. Purpose

[INFERRED] This screen [inferred purpose from route and components].

## 3. Wireframe

[ASCII wireframe generated from component usage and layout]

```
[Generate ASCII based on detected layout pattern]
```

## 4. Layout Structure

[Inferred from layout analysis]

- **Layout:** [from analysis - e.g., DashboardLayout]
- **Grid:** [inferred]
- **Spacing:** [from tokens]

## 5. Components

| Component | Variant | Props | Count |
|-----------|---------|-------|-------|
| [from analysis - components used in this screen] |

**Hierarchy:**
```
[Page]
├── [Component 1]
│   └── [Subcomponent]
└── [Component 2]
```

## 6. States

[Inferred from detected patterns]

- **Default:** Normal display
- **Loading:** [if Skeleton/Spinner detected]
- **Error:** [if error.tsx detected]
- **Empty:** [if EmptyState component detected]

## 7. Interactions

| Trigger | Action | Feedback |
|---------|--------|----------|
| [Inferred from Button/Link usage] |

## 8. Responsive Behavior

[Inferred from Tailwind classes or detected breakpoints]

| Breakpoint | Changes |
|------------|---------|
| Mobile (<640px) | [inferred] |
| Desktop (>1024px) | [inferred] |

## 9. Accessibility

[Standard defaults]

- [ ] Keyboard navigation
- [ ] Screen reader labels
- [ ] Color contrast (tokens)
- [ ] Focus indicators

## 10. Content

[Extracted from component usage]

| Element | Content | Token |
|---------|---------|-------|
| [labels, headings from analysis] |

---

*Auto-generated by /ui:generate-specs | Review recommended*
```
</step>

<step name="mark_inferred">
## Mark Inferred Sections

All auto-generated content that required inference is marked:

```markdown
## 2. Purpose

[INFERRED] This screen allows users to...
```

This signals to the user that review is recommended.
</step>

<step name="cross_reference">
## Cross-Reference Everything

Ensure consistency:

1. **Screen → Component mapping:**
   - Every component in screen specs exists in COMPONENTS.md
   - Usage counts match

2. **Token references:**
   - All token references in specs match design-tokens.json

3. **Route consistency:**
   - All routes in UI-SPEC match individual screen specs

4. **Pattern references:**
   - Link screens to detected patterns
</step>

<step name="create_registry">
## Create UI-REGISTRY.md

Track realization status:

```markdown
# UI Registry

> Tracks screen realization and implementation status

## Status Overview

| Screen | Specified | Exported | Realized | Implemented |
|--------|-----------|----------|----------|-------------|
| SCR-01: Login | ✓ Generated | - | - | ✓ Exists |
| SCR-02: Signup | ✓ Generated | - | - | ✓ Exists |
...

**Note:** All screens marked "Implemented" because they were reverse-engineered from existing code.
```
</step>

<step name="completion">
## Completion Summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► SPECS GENERATED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Generated:
  ✓ UI-SPEC.md (master spec)
  ✓ COMPONENTS.md (45 components)
  ✓ screens/SCR-01-login.md
  ✓ screens/SCR-02-signup.md
  ✓ screens/SCR-03-dashboard.md
  ... [N more screens]
  ✓ UI-REGISTRY.md (tracking)

Sections requiring review:
  • 12 screens have [INFERRED] sections
  • Purpose sections need human validation
  • Wireframes are approximations

───────────────────────────────────────────────────────

## ▶ Next Steps

**Review generated specs:**
  Start with high-priority screens

**Export to design tool:**
  /ui:export stitch
  /ui:export v0
  /ui:export figma

**Refine specific screen:**
  /ui:design-screens SCR-03

───────────────────────────────────────────────────────
```
</step>

<step name="git_commit">
## Git Commit

```bash
git check-ignore -q .harn 2>/dev/null && COMMIT_HARN=false || COMMIT_HARN=true

if [ "$COMMIT_HARN" = "true" ]; then
    git add .harn/design/UI-SPEC.md
    git add .harn/design/COMPONENTS.md
    git add .harn/design/UI-REGISTRY.md
    git add .harn/design/screens/*.md

    git commit -m "docs(ui): generate specs from code analysis

- Screens: [N] specs generated
- Components: [N] documented
- Auto-generated from CODE-ANALYSIS.md
"

    if git remote | grep -q origin; then
        git push origin $(git branch --show-current) 2>/dev/null || true
    fi
fi
```
</step>

</process>

<success_criteria>
- UI-SPEC.md created with full structure
- COMPONENTS.md created with all discovered components
- Screen specs created for requested screens
- All [INFERRED] sections clearly marked
- Cross-references are consistent
- UI-REGISTRY.md tracks status
- Clear next steps for export
</success_criteria>
