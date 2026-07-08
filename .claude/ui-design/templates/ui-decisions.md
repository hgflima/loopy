# UI-DECISIONS.md Template

Template for `.harn/design/UI-DECISIONS.md` — records design decisions and their rationale.

---

<template>

```markdown
# UI Decisions: [Project Name]

> Design decision log for tracking rationale and context.
> Total Decisions: [N] | Last Updated: YYYY-MM-DD

---

## Overview

This document captures significant UI/UX decisions made during the design process. Each decision records the context, options considered, final choice, and rationale.

### Decision Index

| ID | Decision | Category | Status | Date |
|----|----------|----------|--------|------|
| DEC-001 | Primary color selection | Visual | Approved | 2024-01-10 |
| DEC-002 | Component library choice | Technical | Approved | 2024-01-10 |
| DEC-003 | Mobile navigation pattern | UX | Approved | 2024-01-12 |
| DEC-004 | Form validation timing | UX | Approved | 2024-01-15 |
| DEC-005 | Dark mode strategy | Technical | Pending | - |

---

## DEC-001: Primary Color Selection

**Category:** Visual Design
**Status:** Approved
**Date:** 2024-01-10
**Decided By:** [Name/Team]

### Context

Need to select primary brand color for buttons, links, and interactive elements. Must work in both light and dark modes and meet accessibility requirements.

### Options Considered

```
┌────────────────────────────────────────────────────────────┐
│  Option A: Blue (#2563EB)                                  │
│  ████████████████                                          │
│                                                            │
│  ✓ Professional, trustworthy                               │
│  ✓ WCAG AA compliant on white                              │
│  ✓ Works in dark mode                                      │
│  ✗ Common (less distinctive)                               │
├────────────────────────────────────────────────────────────┤
│  Option B: Purple (#7C3AED)                                │
│  ████████████████                                          │
│                                                            │
│  ✓ Distinctive, modern                                     │
│  ✓ WCAG AA compliant                                       │
│  ✗ May feel less professional                              │
│  ✗ Harder to pair with other colors                        │
├────────────────────────────────────────────────────────────┤
│  Option C: Teal (#0D9488)                                  │
│  ████████████████                                          │
│                                                            │
│  ✓ Fresh, modern                                           │
│  ✓ Distinctive                                             │
│  ✗ Contrast issues in some contexts                        │
│  ✗ Limited color scale                                     │
└────────────────────────────────────────────────────────────┘
```

### Decision

**Selected: Option A — Blue (#2563EB)**

### Rationale

1. Best accessibility scores across all contexts
2. Aligns with professional B2B target audience
3. Extensive color scale available (50-950)
4. Proven to work in dark mode without adjustment
5. Familiar pattern reduces cognitive load

### Consequences

- Primary buttons will use blue
- Links will use blue (lighter variant for visited)
- Need secondary accent color for emphasis
- Dark mode will use same hue, adjusted lightness

### Related

- DEC-005: Dark mode strategy
- `.harn/design/design-tokens.json`: color.primary.*

---

## DEC-002: Component Library Choice

**Category:** Technical
**Status:** Approved
**Date:** 2024-01-10
**Decided By:** [Name/Team]

### Context

Need to select a component library foundation for the UI. Requirements:
- React/Next.js compatible
- Accessible by default
- Customizable to match brand
- Active maintenance
- Good TypeScript support

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **shadcn/ui** | Customizable, copy-paste, Radix-based | Manual updates, no npm package |
| **Radix Primitives** | Unstyled, accessible, composable | Need to build all styling |
| **MUI** | Comprehensive, well-documented | Heavy, harder to customize |
| **Chakra UI** | Good DX, accessible | Styling opinions may conflict |
| **Custom** | Full control | Time-intensive, a11y burden |

### Decision

**Selected: shadcn/ui**

### Rationale

1. **Ownership**: Components live in our codebase, full control
2. **Accessibility**: Built on Radix primitives, excellent a11y
3. **Customization**: Tailwind-based, matches our stack
4. **Learning curve**: Familiar patterns, good documentation
5. **Performance**: No extra runtime, tree-shakeable
6. **Community**: Active development, growing ecosystem

### Consequences

- Components will be in `src/components/ui/`
- Use `npx shadcn-ui@latest add [component]` to add new components
- Customize via CSS variables in globals.css
- Update components manually when improvements released

### Related

- `.harn/design/COMPONENTS.md`: Component specifications
- `src/components/ui/`: Implementation location

---

## DEC-003: Mobile Navigation Pattern

**Category:** UX
**Status:** Approved
**Date:** 2024-01-12
**Decided By:** [Name/Team]

### Context

Need to determine navigation pattern for mobile viewport (<640px). App has 5 main sections: Dashboard, Projects, Messages, Settings, Profile.

### Options Considered

```
Option A: Bottom Tab Bar          Option B: Hamburger Menu
┌───────────────────────┐        ┌───────────────────────┐
│                       │        │ ☰               [👤]  │
│                       │        ├───────────────────────┤
│      Content          │        │                       │
│                       │        │      Content          │
│                       │        │                       │
├───────────────────────┤        │                       │
│ 🏠  📁  💬  ⚙️  👤   │        │                       │
└───────────────────────┘        └───────────────────────┘

Option C: Hybrid (Bottom + Hamburger)
┌───────────────────────┐
│ ☰               [👤]  │
├───────────────────────┤
│                       │
│      Content          │
│                       │
├───────────────────────┤
│ 🏠  📁  💬  ⋯        │ (overflow to hamburger)
└───────────────────────┘
```

### Decision

**Selected: Option A — Bottom Tab Bar**

### Rationale

1. **Discoverability**: All options visible, no hidden menus
2. **Reachability**: Thumb-friendly zone on mobile
3. **App-like feel**: Matches native app conventions
4. **Context**: User always knows where they are
5. **Simplicity**: 5 items fits comfortably

### Consequences

- Bottom nav fixed to viewport bottom on mobile
- Tab bar hidden on desktop (top nav instead)
- Need clear active state indication
- Consider "more" overflow if adding 6+ items

### Related

- SCR-*: All screens (mobile variants)
- PAT-XX: Mobile navigation pattern

---

## DEC-004: Form Validation Timing

**Category:** UX
**Status:** Approved
**Date:** 2024-01-15
**Decided By:** [Name/Team]

### Context

Determine when to show validation errors on forms to balance helpfulness with user annoyance.

### Options Considered

| Timing | Experience | Pros | Cons |
|--------|------------|------|------|
| **On blur** | Error shows when leaving field | Non-intrusive, natural | May miss errors until later |
| **On change** | Error shows while typing | Immediate feedback | Annoying, premature errors |
| **On submit** | Errors show after submit | Clean experience | Delayed feedback, frustrating |
| **Hybrid** | Blur first, then change | Best of both | More complex logic |

### Decision

**Selected: Hybrid approach**

1. **Initial validation**: On blur (when leaving field)
2. **After error shown**: On change (to clear error immediately when fixed)
3. **On submit**: Re-validate all fields

### Rationale

1. Users get feedback at natural pause point (blur)
2. Once error is shown, immediate feedback helps fix it
3. Submit validation catches any missed fields
4. Balances helpfulness with non-intrusiveness

### Implementation Notes

```
Field State Machine:
┌──────────┐  blur   ┌───────────┐
│ pristine │───────▶ │ validated │
└──────────┘         └─────┬─────┘
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
        ┌─────────┐              ┌─────────┐
        │  valid  │              │  error  │
        └─────────┘              └────┬────┘
                                      │
                              on change: re-validate
                                      │
                              ┌───────┴───────┐
                              ▼               ▼
                         [still error]   [now valid]
```

### Related

- PAT-06: Form with validation
- All form screens

---

## DEC-005: Dark Mode Strategy

**Category:** Technical
**Status:** Pending
**Date:** -
**Decided By:** -

### Context

Determine how to implement dark mode support. Need to decide on:
1. Whether to support dark mode
2. Detection method (system preference, user toggle, both)
3. Implementation approach (CSS variables, Tailwind dark:, etc.)

### Options Considered

| Approach | Pros | Cons |
|----------|------|------|
| **System-only** | Automatic, no UI needed | No user control |
| **Toggle-only** | User control | May not match system |
| **Both (system default + toggle)** | Best flexibility | More complex |
| **No dark mode** | Simpler | User expectation, accessibility |

### Status: Pending Decision

Need to gather:
- [ ] User research on dark mode preference
- [ ] Assessment of color system readiness
- [ ] Technical spike on implementation effort

### Tentative Direction

Leaning toward "Both" approach:
1. Default to system preference
2. Allow manual toggle
3. Persist user preference
4. Use CSS custom properties for theming

---

## Decision Template

Use this template when adding new decisions:

```markdown
## DEC-XXX: [Decision Title]

**Category:** [Visual | UX | Technical | Content]
**Status:** [Pending | Approved | Superseded]
**Date:** YYYY-MM-DD
**Decided By:** [Name/Team]

### Context

[What situation or problem led to this decision?]

### Options Considered

[List options with pros/cons]

### Decision

**Selected: [Option]**

### Rationale

[Why this option? List reasons.]

### Consequences

[What are the implications? What needs to change?]

### Related

[Links to related decisions, files, screens]
```

---

## Categories

| Category | Scope |
|----------|-------|
| Visual | Colors, typography, spacing, imagery |
| UX | Patterns, flows, interactions, behaviors |
| Technical | Libraries, architecture, implementation |
| Content | Copy, terminology, tone, messaging |

## Statuses

| Status | Meaning |
|--------|---------|
| Pending | Under discussion, not yet decided |
| Approved | Decision made, implementing |
| Superseded | Replaced by newer decision |

---

*Updated after each design decision | Template version 1.0*
```

</template>

---

<guidelines>

## Purpose

Decision logs help:
1. **Remember why** — Future you forgets context
2. **Onboard others** — New team members understand rationale
3. **Avoid rehashing** — Don't re-debate settled decisions
4. **Track evolution** — See how design evolved
5. **Enable reversal** — Know what to reconsider if context changes

## What to Document

Document decisions that:
- Affect multiple screens/components
- Have multiple valid options
- Require discussion or trade-offs
- May be questioned later
- Set precedent for future work

## When to Add

- During design discussions
- After research concludes
- When changing existing patterns
- When establishing new conventions

## Best Practices

1. **Write it down immediately** — Context fades fast
2. **List all options** — Even rejected ones
3. **Be specific** — Vague decisions are useless
4. **Link related work** — Connect to screens, components, patterns
5. **Update status** — Mark superseded when things change

</guidelines>
