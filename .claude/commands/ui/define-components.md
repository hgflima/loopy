---
name: ui:define-components
description: Extract and define comprehensive component inventory from screen specifications
allowed-tools: [Read, Write, Edit, Glob, Grep, AskUserQuestion, Task]
agent: ui-specifier (for complex extraction)
---

<objective>
Analyze all screen specifications to extract unique UI components. Create a comprehensive COMPONENTS.md inventory with props, variants, states, accessibility requirements, and usage patterns. Produces component definitions ready for implementation or export.
</objective>

<context>
@./.claude/ui-design/templates/component.md
@./.claude/ui-design/references/design-systems.md
@.harn/design/UI-CONTEXT.md (if exists)
@.harn/design/design-tokens.json (if exists)
@.harn/design/screens/*.md (required)
</context>

<ux_principles>
## Automatic Extraction

Components are extracted automatically from screen specs:
- Parse all screen component tables
- Identify unique components
- Consolidate variants and props
- Build usage matrix

## Adaptive Flow
- Ask clarifying questions only when ambiguity exists
- Offer to add components not in screens
- Suggest standard components that might be missing
</ux_principles>

<process>

<step name="verify_prerequisites">
## Verify Prerequisites

1. **Check for screen specifications:**
   - Glob `.harn/design/screens/SCR-*.md`
   - If none found, prompt to run `/ui:design-screens` first

2. **Check for existing COMPONENTS.md:**
   - If exists, offer update vs. replace

3. **Check for UI-CONTEXT.md:**
   - Determine component library target (shadcn, MUI, etc.)
   - Align component naming

If screens missing:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► NO SCREENS FOUND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Cannot extract components without screen specifications.

Please run: /ui:design-screens

───────────────────────────────────────────────────────
```

If COMPONENTS.md exists:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► EXISTING COMPONENTS DETECTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Found [N] components in COMPONENTS.md

What would you like to do?
```

Options:
- Update from current screens (merge new)
- Replace completely (fresh extraction)
- Add specific components manually
</step>

<step name="extract_from_screens">
## Extract Components from Screens

Read all screen specification files and extract:

```markdown
## Extraction Process

1. **Parse component tables** from each screen
2. **Collect all components** with their usage context
3. **Merge duplicates** consolidating variants/props
4. **Track usage locations** for each component
```

Build extraction map:
```json
{
  "Button": {
    "usedIn": ["SCR-01", "SCR-02", "SCR-04", "SCR-07"],
    "variants": ["primary", "secondary", "ghost", "destructive"],
    "sizes": ["sm", "md", "lg"],
    "props": {
      "label": "string",
      "loading": "boolean",
      "disabled": "boolean",
      "icon": "string",
      "fullWidth": "boolean"
    }
  },
  "Input": {
    "usedIn": ["SCR-01", "SCR-02", "SCR-03", "SCR-08"],
    "types": ["text", "email", "password", "search"],
    "props": {
      "label": "string",
      "type": "enum",
      "required": "boolean",
      "error": "string",
      "placeholder": "string"
    }
  }
}
```
</step>

<step name="detect_existing_components">
## Detect Existing Components

Check if project already has components implemented:

1. **Check for component files:**
   - `src/components/` or `components/`
   - `src/ui/` or similar

2. **Check package.json for libraries:**
   - shadcn/ui → Map to their components
   - Radix UI → Map primitives
   - Material UI → Map MUI components

3. **Present findings:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► EXISTING CODE DETECTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Found shadcn/ui components installed:
  ✓ Button (has 4 variants)
  ✓ Input
  ✓ Card
  ○ Select (not installed)
  ○ Dialog (not installed)

Spec will reference existing + recommend additions.
───────────────────────────────────────────────────────
```
</step>

<step name="categorize_components">
## Categorize Components

Organize extracted components:

```markdown
## Component Categories

**Primitives** (atomic building blocks):
- Button, Link, Icon, Badge, Avatar, Separator

**Form Elements** (user input):
- Input, TextArea, Select, Checkbox, Radio, Switch
- DatePicker, TimePicker, Slider, FileUpload

**Layout** (structure):
- Card, Container, Stack, Grid, Divider
- AspectRatio, ScrollArea

**Navigation** (wayfinding):
- Navbar, Sidebar, Tabs, Breadcrumb
- Pagination, Menu, DropdownMenu

**Feedback** (communication):
- Alert, Toast, Dialog, Modal
- Tooltip, Popover, Progress, Skeleton

**Data Display** (information):
- Table, DataTable, List, Tree
- Chart, Stat, Badge, Avatar

**Composite** (app-specific):
- LoginForm, UserCard, FeatureCard
- SearchBar, NotificationBell
```
</step>

<step name="suggest_missing">
## Suggest Missing Components

Based on screens and patterns, suggest commonly needed components:

**Question: Any additional components needed?**

```
Based on your screens, you might also need:

Recommended:
  ○ Toast — For success/error feedback
  ○ Dialog — For confirmations
  ○ Skeleton — For loading states
  ○ EmptyState — For no-data scenarios

Common additions:
  ○ Avatar — For user displays
  ○ Badge — For status indicators
  ○ Tooltip — For help text
```

Options:
- Add all recommended
- Select specific additions
- None needed
- You decide based on screens
</step>

<step name="create_component_specs">
## Create Component Specifications

For each component, create detailed specification:

```markdown
---

## CMP-01: Button

**Category:** Primitive
**Priority:** Core
**Library Match:** shadcn/ui Button

### Usage
| Screen | Context |
|--------|---------|
| SCR-01 | Login submit |
| SCR-02 | Signup submit |
| SCR-04 | Dashboard actions |
| SCR-07 | Settings save |

### Variants

```
┌──────────────────────────────────────────────────────┐
│  Variants                                            │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │   Primary   │  │  Secondary  │  │    Ghost    │  │
│  │  (#2563EB)  │  │  (outlined) │  │   (text)    │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
│                                                      │
│  ┌─────────────┐  ┌─────────────┐                   │
│  │ Destructive │  │   Loading   │                   │
│  │  (#EF4444)  │  │  (spinner)  │                   │
│  └─────────────┘  └─────────────┘                   │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Sizes

```
┌──────────────────────────────────────────────────────┐
│  Sizes                                               │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌───────┐    ┌──────────┐    ┌─────────────┐       │
│  │  sm   │    │    md    │    │     lg      │       │
│  │ 32px  │    │   40px   │    │    48px     │       │
│  └───────┘    └──────────┘    └─────────────┘       │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Props

| Prop | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| children | ReactNode | - | Yes | Button content |
| variant | "primary" \| "secondary" \| "ghost" \| "destructive" | "primary" | No | Visual style |
| size | "sm" \| "md" \| "lg" | "md" | No | Size preset |
| loading | boolean | false | No | Shows loading spinner |
| disabled | boolean | false | No | Prevents interaction |
| icon | ReactNode | null | No | Leading icon |
| iconPosition | "left" \| "right" | "left" | No | Icon placement |
| fullWidth | boolean | false | No | Fills container width |
| asChild | boolean | false | No | Render as child element |
| onClick | () => void | - | No | Click handler |

### States

| State | Visual Change | Token Reference |
|-------|---------------|-----------------|
| Default | Base appearance | color.primary.default |
| Hover | Slightly darker | color.primary.600 |
| Active | Darker still | color.primary.700 |
| Focus | Ring outline | ring.primary |
| Disabled | 50% opacity | opacity.disabled |
| Loading | Spinner + disabled | - |

### Accessibility

- [ ] Keyboard: Enter/Space activates
- [ ] Focus: Visible focus ring
- [ ] Disabled: aria-disabled="true"
- [ ] Loading: aria-busy="true"
- [ ] Icon-only: Must have aria-label

### Token References

| Property | Token |
|----------|-------|
| Background | color.primary.default |
| Text | color.primary.foreground |
| Border radius | border.radius.md |
| Padding (horizontal) | spacing.4 |
| Padding (vertical) | spacing.2 |
| Font size | typography.fontSize.sm |
| Font weight | typography.fontWeight.medium |

### Code Hint

```typescript
interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}
```

---
```
</step>

<step name="create_usage_matrix">
## Create Usage Matrix

Show which components are used where:

```markdown
## Component Usage Matrix

| Component | SCR-01 | SCR-02 | SCR-03 | SCR-04 | SCR-05 | SCR-06 | SCR-07 | SCR-08 |
|-----------|--------|--------|--------|--------|--------|--------|--------|--------|
| Button    | ●      | ●      | ●      | ●      | ●      | ●      | ●      | ●      |
| Input     | ●      | ●      | ●      |        |        |        | ●      | ●      |
| Card      | ●      | ●      | ●      | ●      | ●      | ●      |        |        |
| Table     |        |        |        | ●      | ●      |        |        |        |
| Avatar    |        |        |        | ●      |        | ●      |        | ●      |
| Dialog    |        |        |        |        | ●      | ●      | ●      |        |
| Toast     | ●      | ●      |        | ●      | ●      | ●      | ●      |        |

Legend: ● = Used in screen
```
</step>

<step name="create_component_briefs">
## Create Component Briefs

For export purposes, create condensed briefs:

```markdown
## Component Brief: Button

**One-liner:** Primary action trigger with loading and variant support

**Variants:** primary (solid blue), secondary (outlined), ghost (text-only), destructive (red)

**Key States:** default → hover → active → focus → disabled → loading

**Must Have:**
- Visible focus ring
- Loading spinner replacement
- Icon support (left/right)
- Full-width option

**Token Dependencies:** color.primary.*, border.radius.md, spacing.2-4

**Similar To:** shadcn Button, MUI Button, Chakra Button
```
</step>

<step name="write_components_file">
## Write COMPONENTS.md

Create `.harn/design/COMPONENTS.md`:

```markdown
# Component Inventory

Last updated: [date]
Generated by: /ui:define-components

## Overview

- **Total Components:** [N]
- **Primitives:** [N]
- **Form Elements:** [N]
- **Layout:** [N]
- **Navigation:** [N]
- **Feedback:** [N]
- **Data Display:** [N]
- **Composite:** [N]

## Quick Reference

| ID | Component | Category | Variants | Screens |
|----|-----------|----------|----------|---------|
| CMP-01 | Button | Primitive | 4 | 8 |
| CMP-02 | Input | Form | 4 types | 5 |
| CMP-03 | Card | Layout | 2 | 6 |
| ... | ... | ... | ... | ... |

## Usage Matrix

[Matrix table]

## Detailed Specifications

[Full specs for each component]

## Component Briefs

[Condensed briefs for export]
```
</step>

<step name="update_ui_spec">
## Update UI-SPEC.md

Add component summary to master spec:

```markdown
## Component Summary

Total: [N] components extracted from [M] screens

### By Category
- Primitives: Button, Link, Icon, Badge, Avatar
- Form: Input, TextArea, Select, Checkbox, Switch
- Layout: Card, Container, Divider, Stack
- Navigation: Navbar, Tabs, Breadcrumb
- Feedback: Alert, Toast, Dialog, Tooltip
- Data: Table, List, Stat
- Composite: LoginForm, UserCard

### Most Used
1. Button (8 screens)
2. Card (6 screens)
3. Input (5 screens)

See: `.harn/design/COMPONENTS.md` for full specifications
```
</step>

<step name="update_state">
## Update State

Update `.harn/design/ui-state/coordinator-state.json`:
```json
{
  "project_status": {
    "components_total": [N],
    "components_specified": [N]
  }
}
```
</step>

<step name="completion">
## Completion Summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► COMPONENTS DEFINED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Extracted [N] components from [M] screens:

Primitives (6):
  ✓ CMP-01: Button        4 variants, 3 sizes
  ✓ CMP-02: Link          2 variants
  ✓ CMP-03: Icon          library: lucide
  ✓ CMP-04: Badge         4 variants
  ✓ CMP-05: Avatar        3 sizes
  ✓ CMP-06: Separator     2 orientations

Form Elements (5):
  ✓ CMP-07: Input         4 types
  ✓ CMP-08: TextArea      -
  ✓ CMP-09: Select        searchable option
  ✓ CMP-10: Checkbox      -
  ✓ CMP-11: Switch        -

Layout (3):
  ✓ CMP-12: Card          2 variants
  ✓ CMP-13: Container     responsive
  ✓ CMP-14: Divider       with-text option

[Additional categories...]

Library Alignment: shadcn/ui (12/[N] matching)

Files:
  ✓ .harn/design/COMPONENTS.md (full inventory)
  ✓ .harn/design/UI-SPEC.md (updated summary)

───────────────────────────────────────────────────────

## ▶ Next Up

**Export to design tools** — Generate optimized prompts

`/ui:export stitch`    Visual design generation
`/ui:export v0`        React component generation
`/ui:export figma`     Figma setup + tokens

**Or document patterns** — Extract reusable patterns

`/ui:patterns`

───────────────────────────────────────────────────────
```
</step>

</process>

<success_criteria>
- `.harn/design/COMPONENTS.md` exists with full inventory
- All components from screen specs are documented
- Each component has: props, variants, states, accessibility, tokens
- Components categorized appropriately
- Usage matrix shows component-to-screen mapping
- Component briefs ready for export
- UI-SPEC.md updated with component summary
- State file updated
</success_criteria>
