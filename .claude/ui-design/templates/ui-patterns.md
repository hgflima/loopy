# UI-PATTERNS.md Template

Template for `.harn/design/UI-PATTERNS.md` — documents reusable UI patterns across the application.

---

<template>

```markdown
# UI Patterns: [Project Name]

> Reusable UI patterns and their implementations.
> Version: 1.0.0 | Last Updated: YYYY-MM-DD

---

## Overview

Patterns are reusable solutions to common UI problems. They combine components, layout, and behavior into consistent, tested solutions.

### Pattern Index

| ID | Pattern | Category | Screens Used | Status |
|----|---------|----------|--------------|--------|
| PAT-01 | Auth Form Layout | Layout | SCR-01, SCR-02 | Documented |
| PAT-02 | Dashboard Grid | Layout | SCR-03 | Documented |
| PAT-03 | Settings Sections | Layout | SCR-04 | Documented |
| PAT-04 | Empty State | Feedback | SCR-03, SCR-05 | Documented |
| PAT-05 | List with Actions | Data | SCR-03, SCR-06 | Draft |
| PAT-06 | Form with Validation | Form | SCR-01, SCR-02, SCR-04 | Documented |

---

## PAT-01: Auth Form Layout

**Category:** Layout
**Used In:** SCR-01 (Login), SCR-02 (Signup), SCR-08 (Forgot Password)

### Description

Centered form card with optional branding, social login options, and footer links. Creates a focused, trustworthy authentication experience.

### Wireframe

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                         [Logo]                              │
│                                                             │
│              ┌─────────────────────────────┐                │
│              │                             │                │
│              │         [Heading]           │                │
│              │         [Subtext]           │                │
│              │                             │                │
│              │  ┌─────────────────────┐    │                │
│              │  │ [Input Field]       │    │                │
│              │  └─────────────────────┘    │                │
│              │                             │                │
│              │  ┌─────────────────────┐    │                │
│              │  │ [Input Field]       │    │                │
│              │  └─────────────────────┘    │                │
│              │                             │                │
│              │  [ Primary Button          ]│                │
│              │                             │                │
│              │  ─────── or ───────         │                │
│              │                             │                │
│              │  [ Social Login ][ Social ] │                │
│              │                             │                │
│              │  [Footer Link]              │                │
│              │                             │                │
│              └─────────────────────────────┘                │
│                                                             │
│                     [Legal Links]                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Structure

| Element | Component | Props/Config |
|---------|-----------|--------------|
| Container | Page | centered, minHeight="100vh" |
| Card | Card | maxWidth="400px", padding="lg" |
| Heading | Heading | level="h1", size="2xl" |
| Form inputs | Input | fullWidth, with labels |
| Submit | Button | variant="primary", fullWidth |
| Divider | Separator | text="or" |
| Social buttons | Button | variant="outline", icon |
| Footer link | Link | variant="text" |

### Responsive Behavior

| Breakpoint | Changes |
|------------|---------|
| Mobile | Full-width card, reduced padding |
| Tablet+ | Fixed-width centered card (400px) |

### Accessibility

- [ ] Form has accessible name
- [ ] Inputs have visible labels
- [ ] Error messages linked to inputs
- [ ] Focus trapped in form when modal
- [ ] Submit via Enter key supported

### Variants

| Variant | Difference |
|---------|------------|
| Login | Email + Password + Forgot link |
| Signup | Email + Password + Confirm + Terms |
| Forgot Password | Email only + Back link |
| Reset Password | New password + Confirm |

---

## PAT-02: Dashboard Grid

**Category:** Layout
**Used In:** SCR-03 (Dashboard)

### Description

Responsive grid layout for dashboard with stat cards, primary content area, and sidebar widgets. Adapts from single column on mobile to multi-column on desktop.

### Wireframe

```
┌─────────────────────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [Header / Navigation Bar]                               │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│ │ Stat 1   │ │ Stat 2   │ │ Stat 3   │ │ Stat 4   │        │
│ │ [Value]  │ │ [Value]  │ │ [Value]  │ │ [Value]  │        │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
│                                                             │
│ ┌───────────────────────────────────┐ ┌──────────────────┐ │
│ │                                   │ │                  │ │
│ │                                   │ │   [Widget 1]     │ │
│ │       [Main Content Area]         │ │                  │ │
│ │                                   │ ├──────────────────┤ │
│ │       (List, Table, Cards)        │ │                  │ │
│ │                                   │ │   [Widget 2]     │ │
│ │                                   │ │                  │ │
│ └───────────────────────────────────┘ └──────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Grid Structure

```
Desktop (1024px+):
┌────────────────────────────────────────────────────────────┐
│  Stats Row: 4 columns, gap-4                               │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                          │
│  │ 1/4 │ │ 1/4 │ │ 1/4 │ │ 1/4 │                          │
│  └─────┘ └─────┘ └─────┘ └─────┘                          │
│                                                            │
│  Main Area: 2 columns (2fr + 1fr)                         │
│  ┌─────────────────────────┐ ┌───────────┐                │
│  │                         │ │           │                │
│  │          2fr            │ │    1fr    │                │
│  │                         │ │           │                │
│  └─────────────────────────┘ └───────────┘                │
└────────────────────────────────────────────────────────────┘

Tablet (640-1023px):
┌────────────────────────────────────────────────────────────┐
│  Stats Row: 2 columns                                      │
│  ┌───────────┐ ┌───────────┐                              │
│  │    1/2    │ │    1/2    │                              │
│  └───────────┘ └───────────┘                              │
│  ┌───────────┐ ┌───────────┐                              │
│  │    1/2    │ │    1/2    │                              │
│  └───────────┘ └───────────┘                              │
│                                                            │
│  Main Area: Full width, widgets below                      │
│  ┌─────────────────────────────────────┐                  │
│  │              Main                    │                  │
│  └─────────────────────────────────────┘                  │
│  ┌─────────────────────────────────────┐                  │
│  │              Widgets                 │                  │
│  └─────────────────────────────────────┘                  │
└────────────────────────────────────────────────────────────┘

Mobile (<640px):
┌───────────────────────────┐
│  Stats: Horizontal scroll │
│  ←[1][2][3][4]→          │
│                           │
│  Main: Full width         │
│  ┌───────────────────┐    │
│  │       Main        │    │
│  └───────────────────┘    │
│  ┌───────────────────┐    │
│  │     Widget 1      │    │
│  └───────────────────┘    │
│  ┌───────────────────┐    │
│  │     Widget 2      │    │
│  └───────────────────┘    │
└───────────────────────────┘
```

### Components Used

| Element | Component | Config |
|---------|-----------|--------|
| Stat card | Card | variant="stat", padding="md" |
| Main area | Card | padding="lg" |
| Widget | Card | padding="md" |
| Data display | Table or List | - |

---

## PAT-03: Settings Sections

**Category:** Layout
**Used In:** SCR-04 (Settings)

### Description

Organized settings page with navigation sidebar and content sections. Each section is a self-contained form or display area.

### Wireframe

```
┌─────────────────────────────────────────────────────────────┐
│ [Navbar]                                                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌────────────┐  ┌────────────────────────────────────────┐│
│  │            │  │                                        ││
│  │  [Nav]     │  │  Section Heading                       ││
│  │  ○ Profile │  │  Description text                      ││
│  │  ○ Account │  │                                        ││
│  │  ○ Prefs   │  │  ┌────────────────────────────────────┐││
│  │  ○ Billing │  │  │ Setting 1                          │││
│  │  ○ Team    │  │  │ [Input or Toggle]                  │││
│  │            │  │  └────────────────────────────────────┘││
│  │            │  │                                        ││
│  │            │  │  ┌────────────────────────────────────┐││
│  │            │  │  │ Setting 2                          │││
│  │            │  │  │ [Input or Toggle]                  │││
│  │            │  │  └────────────────────────────────────┘││
│  │            │  │                                        ││
│  │            │  │  [ Save Changes ]                      ││
│  │            │  │                                        ││
│  └────────────┘  └────────────────────────────────────────┘│
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Structure

| Element | Component | Notes |
|---------|-----------|-------|
| Side nav | Vertical Tabs or List | Sticky on scroll |
| Section title | Heading | level="h2" |
| Description | Text | color="muted" |
| Setting row | Custom | Label + Input/Toggle |
| Divider | Separator | Between sections |
| Save button | Button | variant="primary" |

### Responsive

| Breakpoint | Behavior |
|------------|----------|
| Mobile | Tabs at top, content below |
| Tablet+ | Side nav (240px) + content |

---

## PAT-04: Empty State

**Category:** Feedback
**Used In:** Any screen with potentially empty content

### Description

Friendly empty state with illustration, message, and action. Helps users understand what to do when there's no content.

### Wireframe

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                                                             │
│                     ┌───────────────┐                       │
│                     │               │                       │
│                     │  [Illustration│                       │
│                     │   or Icon]    │                       │
│                     │               │                       │
│                     └───────────────┘                       │
│                                                             │
│                    [Heading Message]                        │
│                                                             │
│                 [Supportive description                     │
│                  explaining the situation]                  │
│                                                             │
│                   [ Primary Action ]                        │
│                                                             │
│                    [Secondary Link]                         │
│                                                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Variants

| Context | Heading | Action |
|---------|---------|--------|
| No projects | "No projects yet" | "Create your first project" |
| No results | "No results found" | "Clear filters" |
| Error loading | "Something went wrong" | "Try again" |
| No notifications | "All caught up!" | (no action needed) |
| No permissions | "Access restricted" | "Request access" |

### Components

| Element | Component | Props |
|---------|-----------|-------|
| Illustration | Image or Icon | size="lg" (64-120px) |
| Heading | Heading | level="h3", align="center" |
| Description | Text | align="center", color="muted" |
| Primary action | Button | variant="primary" |
| Secondary | Link | variant="text" |

---

## PAT-05: List with Actions

**Category:** Data
**Used In:** Project lists, user lists, item lists

### Description

Scrollable list with items that have inline actions. Supports selection, bulk actions, and individual item actions.

### Wireframe

```
┌─────────────────────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [Search]                    [Filter] [Sort] [+ Add New] │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ □  Item Title                      [Edit] [Delete]  ⋮   │ │
│ │    Description or metadata                              │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ □  Item Title                      [Edit] [Delete]  ⋮   │ │
│ │    Description or metadata                              │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ □  Item Title                      [Edit] [Delete]  ⋮   │ │
│ │    Description or metadata                              │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ □  Item Title                      [Edit] [Delete]  ⋮   │ │
│ │    Description or metadata                              │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Showing 1-10 of 50            [◀ Prev] [1][2][3] [Next ▶]│ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Features

| Feature | Implementation |
|---------|----------------|
| Search | Input with debounce |
| Filter | Dropdown or popover |
| Sort | Dropdown |
| Selection | Checkbox per row |
| Bulk actions | Toolbar appears when selected |
| Item actions | Icon buttons or overflow menu |
| Pagination | Page numbers or infinite scroll |

---

## PAT-06: Form with Validation

**Category:** Form
**Used In:** All forms throughout the application

### Description

Standard form pattern with real-time validation, error states, and submit handling.

### Validation States

```
┌─────────────────────────────────────────────────────────────┐
│  Field States                                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Default              Focused              Filled           │
│  ┌───────────────┐   ┌───────────────┐   ┌───────────────┐ │
│  │ Placeholder   │   │○ Typing...    │   │ Valid input   │ │
│  └───────────────┘   └───────────────┘   └───────────────┘ │
│  Label               Label               Label              │
│                                                             │
│  Error               Success             Disabled           │
│  ┌───────────────┐   ┌───────────────┐   ┌ ─ ─ ─ ─ ─ ─ ─┐ │
│  │ Bad input     │   │ Valid ✓       │   │ Disabled      │ │
│  └───────────────┘   └───────────────┘   └ ─ ─ ─ ─ ─ ─ ─┘ │
│  ⚠ Error message     ✓ Success msg       (no interaction)  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Validation Timing

| Trigger | Action |
|---------|--------|
| On blur | Validate field |
| On change (after error) | Re-validate to clear error |
| On submit | Validate all fields |
| Async validation | Debounce (300ms) |

### Error Display

| Level | Display |
|-------|---------|
| Field error | Below input, linked via aria-describedby |
| Form error | Alert at top of form |
| Toast | For submit errors |

---

## Adding New Patterns

When documenting a new pattern:

1. **Identify reuse** — Pattern should appear in 2+ screens
2. **Document wireframe** — ASCII diagram showing layout
3. **List components** — What components make it up
4. **Note variants** — Different configurations
5. **Define responsive** — How it adapts
6. **Add accessibility** — Keyboard, screen reader notes

### Pattern Template

```markdown
## PAT-XX: [Pattern Name]

**Category:** [Layout | Form | Data | Feedback | Navigation]
**Used In:** [Screen IDs]

### Description
[What problem does this solve? When to use it?]

### Wireframe
[ASCII diagram]

### Structure
[Components and configuration]

### Responsive
[Breakpoint behavior]

### Accessibility
[A11y considerations]

### Variants
[Different versions]
```

---

*Generated by /ui:patterns | Last updated: YYYY-MM-DD*
```

</template>

---

<guidelines>

## Pattern Categories

| Category | Purpose | Examples |
|----------|---------|----------|
| Layout | Page/section structure | Auth form, dashboard grid, settings |
| Form | Input and validation | Form validation, multi-step, inline edit |
| Data | Displaying data | List, table, cards, detail view |
| Feedback | User feedback | Empty state, error, loading, success |
| Navigation | Wayfinding | Tabs, sidebar, breadcrumb |

## When to Create a Pattern

- Used in 2+ screens
- Has consistent structure
- Solves a common problem
- Benefits from documentation

## Pattern vs Component

| Pattern | Component |
|---------|-----------|
| Combines multiple components | Single reusable element |
| Defines layout and behavior | Defines props and variants |
| Higher abstraction | Lower abstraction |
| Page/section level | Element level |

</guidelines>
