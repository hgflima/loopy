# UI-SPEC.md Template

Template for `.harn/design/UI-SPEC.md` — the master UI specification document that serves as the central hub for all UI documentation.

---

<template>

```markdown
# UI Specification: [Project Name]

> Master specification for the [Project Name] user interface.
> Version: 1.0.0 | Last Updated: YYYY-MM-DD

## Overview

[2-3 sentences describing the application's UI. What does the user see and do? What is the primary user journey?]

### Key Metrics

| Metric | Target |
|--------|--------|
| Screens | [N] total |
| Components | [N] unique |
| Breakpoints | 3 (mobile, tablet, desktop) |
| Theme Modes | Light, Dark |

---

## Design System

**Tokens:** `.harn/design/design-tokens.json`
**Components:** `.harn/design/COMPONENTS.md`
**Patterns:** `.harn/design/UI-PATTERNS.md`
**Decisions:** `.harn/design/UI-DECISIONS.md`

### Target Stack

| Aspect | Choice | Notes |
|--------|--------|-------|
| Component Library | [shadcn/ui \| MUI \| Custom] | - |
| Styling | [Tailwind \| CSS-in-JS \| CSS Modules] | - |
| Icons | [Lucide \| Heroicons \| Custom] | - |
| Animation | [Framer Motion \| CSS \| None] | - |

### Token Quick Reference

```
Colors                          Typography
─────────────────────────────   ──────────────────────────
Primary:    #2563EB  ████       Font:    Inter, system-ui
Secondary:  #64748B  ████       Base:    16px / 1.5
Accent:     #8B5CF6  ████       Scale:   1.25 (major third)
Success:    #22C55E  ████
Warning:    #F59E0B  ████       Spacing
Error:      #EF4444  ████       ──────────────────────────
                                Base:    4px
                                Scale:   4, 8, 12, 16, 24, 32, 48, 64
```

---

## Screen Inventory

### Summary

```
┌────────────────────────────────────────────────────────────┐
│  Screens Overview                                          │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Total: [N] screens                                        │
│                                                            │
│  ■■■■■■■■░░  Specified: [N] (80%)                         │
│  ■■■■■■░░░░  Exported:  [N] (60%)                         │
│  ■■■■░░░░░░  Realized:  [N] (40%)                         │
│  ■■░░░░░░░░  Implemented: [N] (20%)                       │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Screen List

| ID | Screen | Route | Status | Priority | Requirements |
|----|--------|-------|--------|----------|--------------|
| SCR-01 | Login | /login | Specified | Core | REQ-03 |
| SCR-02 | Signup | /signup | Specified | Core | REQ-04 |
| SCR-03 | Dashboard | /dashboard | Specified | Core | REQ-05, REQ-06 |
| SCR-04 | Settings | /settings | Specified | Standard | REQ-12 |
| SCR-05 | Profile | /profile | Draft | Standard | REQ-13 |

**Status Legend:**
- `Draft` — Initial wireframe only
- `Specified` — Full 10-section spec complete
- `Exported` — Prompts generated for external tool
- `Realized` — Visual design created in external tool
- `Implemented` — Code implemented in application

### Screen Details

| ID | File | Components | Complexity |
|----|------|------------|------------|
| SCR-01 | `screens/SCR-01-login.md` | 8 | Simple |
| SCR-02 | `screens/SCR-02-signup.md` | 10 | Simple |
| SCR-03 | `screens/SCR-03-dashboard.md` | 15 | Complex |
| SCR-04 | `screens/SCR-04-settings.md` | 12 | Medium |

---

## Navigation Architecture

### Site Map

```
┌─────────────────────────────────────────────────────────────┐
│                        SITE MAP                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐                                               │
│  │ Landing  │ (/)                                           │
│  └────┬─────┘                                               │
│       │                                                     │
│       ├────────────────┬────────────────┐                   │
│       ▼                ▼                ▼                   │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │  Login   │    │  Signup  │    │  About   │              │
│  │ (/login) │    │(/signup) │    │ (/about) │              │
│  └────┬─────┘    └────┬─────┘    └──────────┘              │
│       │               │                                     │
│       └───────┬───────┘                                     │
│               ▼                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                 AUTHENTICATED                        │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │                                                      │   │
│  │  ┌──────────┐    ┌──────────┐    ┌──────────┐       │   │
│  │  │Dashboard │←──→│ Projects │←──→│ Settings │       │   │
│  │  │(/dashboard)   │(/projects)│   │(/settings)│       │   │
│  │  └────┬─────┘    └────┬─────┘    └──────────┘       │   │
│  │       │               │                              │   │
│  │       │               ▼                              │   │
│  │       │          ┌──────────┐                        │   │
│  │       │          │ Project  │                        │   │
│  │       │          │ Detail   │                        │   │
│  │       │          └────┬─────┘                        │   │
│  │       │               │                              │   │
│  │       └───────────────┤                              │   │
│  │                       ▼                              │   │
│  │                  ┌──────────┐                        │   │
│  │                  │  Editor  │                        │   │
│  │                  └──────────┘                        │   │
│  │                                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### User Flows

#### Authentication Flow
```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌───────────┐
│ Landing │───▶│  Login  │───▶│ Verify  │───▶│ Dashboard │
└─────────┘    └────┬────┘    └─────────┘    └───────────┘
                    │
                    ▼
              ┌─────────┐    ┌─────────┐
              │ Forgot  │───▶│  Reset  │───▶ Login
              │Password │    │Password │
              └─────────┘    └─────────┘
```

#### Onboarding Flow
```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌───────────┐
│ Signup  │───▶│ Profile │───▶│  Prefs  │───▶│ Dashboard │
└─────────┘    │  Setup  │    │  Setup  │    └───────────┘
               └─────────┘    └─────────┘
```

### Modal/Overlay Inventory

| ID | Trigger | Type | Content | Screen Context |
|----|---------|------|---------|----------------|
| OVL-01 | "New Project" button | Modal | Project creation form | Dashboard |
| OVL-02 | User avatar | Dropdown | User menu | Global (Navbar) |
| OVL-03 | Settings gear | Drawer | Quick settings | Global |
| OVL-04 | Delete button | Dialog | Confirmation | Project Detail |
| OVL-05 | Share button | Modal | Share options | Project Detail |

---

## Component Summary

### Overview

**Total:** [N] components across [M] categories

```
┌────────────────────────────────────────────────────────────┐
│  Component Distribution                                    │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Primitives   ████████░░░░░░░░  12 (30%)                  │
│  Form         ██████░░░░░░░░░░   8 (20%)                  │
│  Layout       ████░░░░░░░░░░░░   5 (12%)                  │
│  Navigation   ████░░░░░░░░░░░░   5 (12%)                  │
│  Feedback     ██████░░░░░░░░░░   6 (15%)                  │
│  Data         ██░░░░░░░░░░░░░░   2 (5%)                   │
│  Composite    ██░░░░░░░░░░░░░░   2 (5%)                   │
│                                                            │
│  Total: 40 components                                      │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### By Category

| Category | Count | Core Components |
|----------|-------|-----------------|
| Primitives | 12 | Button, Link, Icon, Badge, Avatar |
| Form | 8 | Input, Select, Checkbox, Radio, Switch |
| Layout | 5 | Card, Container, Divider, Stack, Grid |
| Navigation | 5 | Navbar, Sidebar, Tabs, Breadcrumb, Menu |
| Feedback | 6 | Modal, Toast, Alert, Dialog, Progress, Skeleton |
| Data | 2 | Table, List |
| Composite | 2 | LoginForm, UserCard |

### Component Usage Matrix

| Component | SCR-01 | SCR-02 | SCR-03 | SCR-04 | Total Uses |
|-----------|--------|--------|--------|--------|------------|
| Button | ● | ● | ● | ● | 4 |
| Input | ● | ● | ○ | ● | 3 |
| Card | ● | ● | ● | ● | 4 |
| Navbar | ○ | ○ | ● | ● | 2 |
| Modal | ○ | ○ | ● | ○ | 1 |

**Legend:** ● = Used, ○ = Not used

See: `.harn/design/COMPONENTS.md` for full specifications.

---

## Export Status

### Service Exports

| Service | Status | Last Export | File | Screens |
|---------|--------|-------------|------|---------|
| Stitch | ✓ Exported | 2024-01-15 | `ui-exports/stitch-prompts.md` | All |
| V0 | ✓ Exported | 2024-01-15 | `ui-exports/v0-prompts.md` | SCR-01, SCR-02 |
| Figma | ○ Pending | - | `ui-exports/figma-tokens.json` | - |
| Generic | ○ Pending | - | `ui-exports/generic-prompts.md` | - |

### Export Freshness

```
Stitch:   ████████████████  Fresh (exported today)
V0:       ████████████░░░░  Recent (3 days old)
Figma:    ░░░░░░░░░░░░░░░░  Not exported
Generic:  ░░░░░░░░░░░░░░░░  Not exported
```

### Export Recommendations

- [ ] Re-export Stitch if tokens changed since 2024-01-15
- [ ] Export remaining screens to V0
- [ ] Generate Figma Variables export for designer handoff

---

## Realization Tracking

### Summary

```
┌────────────────────────────────────────────────────────────┐
│  Realization Progress                                      │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Specified  → → →  Realized  → → →  Implemented            │
│                                                            │
│     [8]     → → →    [4]     → → →     [2]                │
│                                                            │
│  ████████████████░░░░░░░░  50% Realized                   │
│  ████████░░░░░░░░░░░░░░░░  25% Implemented                │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Realization Log

| Screen | Tool | Link/Reference | Realized | Implemented |
|--------|------|----------------|----------|-------------|
| SCR-01: Login | Stitch | [Figma link] | 2024-01-15 | 2024-01-18 |
| SCR-02: Signup | V0 | src/app/signup/page.tsx | 2024-01-16 | - |
| SCR-03: Dashboard | Stitch | [Figma link] | 2024-01-17 | - |
| SCR-04: Settings | - | - | - | - |

See: `.harn/design/UI-REGISTRY.md` for detailed tracking.

---

## Patterns

Reusable UI patterns documented in this project:

| ID | Pattern | Screens Used |
|----|---------|--------------|
| PAT-01 | Auth Form Layout | SCR-01, SCR-02 |
| PAT-02 | Dashboard Grid | SCR-03 |
| PAT-03 | Settings Sections | SCR-04 |
| PAT-04 | Empty State | SCR-03, SCR-05 |

See: `.harn/design/UI-PATTERNS.md` for full pattern documentation.

---

## References

### Related Documents

- **Context:** `.harn/design/UI-CONTEXT.md` — Platform, constraints, inspiration
- **Components:** `.harn/design/COMPONENTS.md` — Full component specs
- **Patterns:** `.harn/design/UI-PATTERNS.md` — Reusable patterns
- **Tokens:** `.harn/design/design-tokens.json` — Design tokens (W3C format)
- **Decisions:** `.harn/design/UI-DECISIONS.md` — Design decision log
- **Registry:** `.harn/design/UI-REGISTRY.md` — Realization tracking

### External Resources

- [Design Inspiration] — [Link]
- [Brand Guidelines] — [Link]
- [Accessibility Standards] — WCAG 2.1 AA

---

*Generated by /ui:design-screens | Last updated: YYYY-MM-DD*
```

</template>

---

<guidelines>

## Section Purpose

| Section | Purpose | When Updated |
|---------|---------|--------------|
| Overview | Project context and key metrics | Initial setup, major changes |
| Design System | Token/component file links, stack choices | Setup, stack changes |
| Screen Inventory | All screens with status tracking | Screen add/status change |
| Navigation | Site map, user flows, overlays | Route changes |
| Component Summary | Category counts, usage matrix | Component changes |
| Export Status | Export tracking per service | After exports |
| Realization | External tool work tracking | After realization |
| Patterns | Pattern references | Pattern changes |
| References | Document links | New documents |

## Best Practices

1. **Keep metrics current** — Update counts when adding/removing screens/components
2. **Track status accurately** — Move screens through the pipeline as work progresses
3. **Link everything** — Every reference should link to actual file
4. **ASCII diagrams** — Use ASCII for navigation flows (copy-pasteable)
5. **Usage matrix** — Helps identify high-impact components
6. **Export freshness** — Track when re-exports are needed

## Status Progression

```
Draft → Specified → Exported → Realized → Implemented
  │         │          │          │           │
  │         │          │          │           └── Code in codebase
  │         │          │          └── Visual design exists
  │         │          └── Prompts generated
  │         └── Full 10-section spec
  └── Initial wireframe only
```

## Maintenance Triggers

Update UI-SPEC.md when:
- New screen added
- Screen status changes
- Components added/removed
- Exports generated
- Screens realized
- Tokens modified

</guidelines>
