# CODE-ANALYSIS.md Template

Template for `.harn/design/CODE-ANALYSIS.md` — the output document from `/ui:scan` that inventories all discovered UI elements from an existing codebase.

---

<template>

```markdown
# Code Analysis: [Project Name]

> Reverse-engineered UI inventory from existing codebase.
> Generated: YYYY-MM-DD | Scanner Version: 1.0.0

## Executive Summary

| Metric | Count | Status |
|--------|-------|--------|
| Framework | [Name + Version] | Detected |
| Components | [N] | Discovered |
| Screens/Pages | [N] | Mapped |
| Design Tokens | [N] | Extracted |
| Patterns | [N] | Detected |

**Quick Assessment:**
[1-2 sentences summarizing the codebase UI health, consistency, and readiness for design export]

---

## Framework & Stack

### Detection Results

| Aspect | Detected | Source |
|--------|----------|--------|
| Framework | [Next.js 14] | package.json |
| Language | [TypeScript] | tsconfig.json |
| Styling | [Tailwind CSS] | tailwind.config.ts |
| Component Library | [shadcn/ui] | components/ui/ |
| State Management | [Zustand] | package.json |
| Routing | [App Router] | app/ directory |

### Directory Structure

```
[project]/
├── app/                    # Next.js App Router pages
│   ├── (auth)/            # Auth route group
│   │   ├── login/
│   │   └── signup/
│   ├── (dashboard)/       # Dashboard route group
│   │   ├── dashboard/
│   │   ├── settings/
│   │   └── profile/
│   └── layout.tsx         # Root layout
├── components/            # Shared components
│   ├── ui/               # Base UI components (shadcn)
│   ├── forms/            # Form components
│   └── layout/           # Layout components
├── lib/                  # Utilities
└── styles/               # Global styles
```

### Tech Stack Summary

```
┌─────────────────────────────────────────────────────────────┐
│  DETECTED STACK                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Framework:     Next.js 14 (App Router)                     │
│  Language:      TypeScript 5.x                              │
│  Styling:       Tailwind CSS 3.x                            │
│  Components:    shadcn/ui + Custom                          │
│  Icons:         Lucide React                                │
│  Animation:     Framer Motion                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Component Inventory

### Summary

```
┌────────────────────────────────────────────────────────────┐
│  Components by Category                                     │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Primitives   ████████████████  16 (36%)                  │
│  Form         ██████████░░░░░░  10 (22%)                  │
│  Layout       ██████░░░░░░░░░░   6 (13%)                  │
│  Navigation   ████░░░░░░░░░░░░   4 (9%)                   │
│  Feedback     ████████░░░░░░░░   6 (13%)                  │
│  Data         ██░░░░░░░░░░░░░░   2 (4%)                   │
│  Composite    ██░░░░░░░░░░░░░░   1 (2%)                   │
│                                                            │
│  Total: 45 components                                      │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Full Component Catalog

#### Primitives (Base UI)

| Component | Path | Props | Variants | Usage |
|-----------|------|-------|----------|-------|
| Button | `components/ui/button.tsx` | 6 | 5 (default, destructive, outline, secondary, ghost) | 47 |
| Badge | `components/ui/badge.tsx` | 3 | 4 (default, secondary, destructive, outline) | 12 |
| Avatar | `components/ui/avatar.tsx` | 4 | - | 8 |
| Icon | `components/ui/icon.tsx` | 3 | - | 89 |
| Link | `components/ui/link.tsx` | 4 | 2 (default, muted) | 23 |
| Separator | `components/ui/separator.tsx` | 2 | - | 15 |

**Button Props Detail:**
```typescript
interface ButtonProps {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost'
  size?: 'default' | 'sm' | 'lg' | 'icon'
  asChild?: boolean
  disabled?: boolean
  loading?: boolean  // Custom extension
  leftIcon?: ReactNode
}
```

#### Form Components

| Component | Path | Props | Validation | Usage |
|-----------|------|-------|------------|-------|
| Input | `components/ui/input.tsx` | 8 | - | 32 |
| Textarea | `components/ui/textarea.tsx` | 6 | - | 5 |
| Select | `components/ui/select.tsx` | 7 | - | 14 |
| Checkbox | `components/ui/checkbox.tsx` | 5 | - | 8 |
| Switch | `components/ui/switch.tsx` | 4 | - | 6 |
| RadioGroup | `components/ui/radio-group.tsx` | 5 | - | 3 |
| Form | `components/ui/form.tsx` | - | react-hook-form | 7 |
| FormField | `components/ui/form.tsx` | 4 | zod | 28 |

**Form Pattern Detected:**
```typescript
// Uses react-hook-form + zod pattern
const form = useForm<FormValues>({
  resolver: zodResolver(schema),
  defaultValues: { ... }
})
```

#### Layout Components

| Component | Path | Children | Usage |
|-----------|------|----------|-------|
| Card | `components/ui/card.tsx` | CardHeader, CardContent, CardFooter | 18 |
| Container | `components/layout/container.tsx` | - | 12 |
| Stack | `components/layout/stack.tsx` | - | 34 |
| Grid | `components/layout/grid.tsx` | - | 8 |
| Sidebar | `components/layout/sidebar.tsx` | SidebarItem, SidebarGroup | 2 |
| PageHeader | `components/layout/page-header.tsx` | - | 6 |

#### Navigation Components

| Component | Path | Type | Usage |
|-----------|------|------|-------|
| Navbar | `components/layout/navbar.tsx` | Fixed | 1 |
| Tabs | `components/ui/tabs.tsx` | Compound | 4 |
| Breadcrumb | `components/ui/breadcrumb.tsx` | - | 3 |
| DropdownMenu | `components/ui/dropdown-menu.tsx` | Radix | 5 |

#### Feedback Components

| Component | Path | Type | Usage |
|-----------|------|------|-------|
| Modal | `components/ui/modal.tsx` | Dialog | 6 |
| Toast | `components/ui/toast.tsx` | Sonner | 12 |
| Alert | `components/ui/alert.tsx` | Static | 4 |
| Skeleton | `components/ui/skeleton.tsx` | Loading | 8 |
| Progress | `components/ui/progress.tsx` | - | 2 |
| Spinner | `components/ui/spinner.tsx` | - | 15 |

#### Data Display Components

| Component | Path | Features | Usage |
|-----------|------|----------|-------|
| Table | `components/ui/table.tsx` | Sortable, Pagination | 3 |
| DataList | `components/ui/data-list.tsx` | - | 2 |

#### Composite Components

| Component | Path | Composition | Usage |
|-----------|------|-------------|-------|
| UserCard | `components/composite/user-card.tsx` | Avatar + Badge + Text | 4 |

---

## Screen Inventory

### Summary

```
┌────────────────────────────────────────────────────────────┐
│  Screens Overview                                          │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Total: 12 screens across 4 route groups                   │
│                                                            │
│  Auth:        ██░░░░░░░░░░░░░░   2 screens                │
│  Dashboard:   ████████░░░░░░░░   4 screens                │
│  Settings:    ████░░░░░░░░░░░░   3 screens                │
│  Public:      ████░░░░░░░░░░░░   3 screens                │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Route Map

```
┌─────────────────────────────────────────────────────────────┐
│  ROUTE STRUCTURE                                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  /                        Landing (public)                  │
│  /about                   About (public)                    │
│  /pricing                 Pricing (public)                  │
│                                                             │
│  /login                   Login (auth)                      │
│  /signup                  Signup (auth)                     │
│                                                             │
│  /dashboard               Dashboard (protected)             │
│  /dashboard/projects      Projects list (protected)         │
│  /dashboard/projects/[id] Project detail (protected)        │
│  /dashboard/analytics     Analytics (protected)             │
│                                                             │
│  /settings                Settings overview (protected)     │
│  /settings/profile        Profile settings (protected)      │
│  /settings/billing        Billing settings (protected)      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Full Screen Catalog

| ID | Screen | Route | Layout | Components | Complexity |
|----|--------|-------|--------|------------|------------|
| SCR-01 | Landing | `/` | RootLayout | 8 | Medium |
| SCR-02 | About | `/about` | RootLayout | 4 | Simple |
| SCR-03 | Pricing | `/pricing` | RootLayout | 6 | Medium |
| SCR-04 | Login | `/login` | AuthLayout | 5 | Simple |
| SCR-05 | Signup | `/signup` | AuthLayout | 7 | Simple |
| SCR-06 | Dashboard | `/dashboard` | DashboardLayout | 12 | Complex |
| SCR-07 | Projects | `/dashboard/projects` | DashboardLayout | 9 | Medium |
| SCR-08 | Project Detail | `/dashboard/projects/[id]` | DashboardLayout | 14 | Complex |
| SCR-09 | Analytics | `/dashboard/analytics` | DashboardLayout | 8 | Medium |
| SCR-10 | Settings | `/settings` | DashboardLayout | 6 | Simple |
| SCR-11 | Profile | `/settings/profile` | DashboardLayout | 10 | Medium |
| SCR-12 | Billing | `/settings/billing` | DashboardLayout | 8 | Medium |

### Layout Hierarchy

```
RootLayout (app/layout.tsx)
├── AuthLayout (app/(auth)/layout.tsx)
│   ├── Login
│   └── Signup
├── DashboardLayout (app/(dashboard)/layout.tsx)
│   ├── Dashboard
│   ├── Projects
│   ├── Project Detail
│   ├── Analytics
│   └── Settings/*
└── [No Layout]
    ├── Landing
    ├── About
    └── Pricing
```

### Screen Details

#### SCR-06: Dashboard

**Path:** `app/(dashboard)/dashboard/page.tsx`
**Layout:** DashboardLayout (Sidebar + TopNav + Content)

**Components Used:**
- PageHeader (1)
- Card (4)
- Button (3)
- Chart (2) — recharts
- Table (1)
- Skeleton (4)

**Data Fetching:**
- `getStats()` — Server component
- `getRecentProjects()` — Server component

**States Detected:**
- Loading (Skeleton pattern)
- Empty (EmptyState component)
- Error (error.tsx boundary)

---

## Design Tokens

### Extraction Source

**Primary:** `tailwind.config.ts`
**Secondary:** CSS variables in `globals.css`
**Theme Provider:** `components/theme-provider.tsx`

### Token Summary

| Category | Tokens | Source |
|----------|--------|--------|
| Colors | 24 | Tailwind + CSS vars |
| Typography | 12 | Tailwind |
| Spacing | 16 | Tailwind default |
| Border Radius | 6 | Tailwind |
| Shadows | 5 | Tailwind |

### Color Tokens Extracted

```
┌────────────────────────────────────────────────────────────┐
│  COLOR PALETTE                                             │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Brand                                                     │
│  ─────────────────────────────────────────                 │
│  Primary:      #2563EB  ████  (blue-600)                  │
│  Secondary:    #64748B  ████  (slate-500)                 │
│                                                            │
│  Semantic                                                  │
│  ─────────────────────────────────────────                 │
│  Success:      #22C55E  ████  (green-500)                 │
│  Warning:      #F59E0B  ████  (amber-500)                 │
│  Error:        #EF4444  ████  (red-500)                   │
│  Info:         #3B82F6  ████  (blue-500)                  │
│                                                            │
│  Neutrals                                                  │
│  ─────────────────────────────────────────                 │
│  Background:   #FFFFFF  ████  (white)                     │
│  Foreground:   #0F172A  ████  (slate-900)                 │
│  Muted:        #F1F5F9  ████  (slate-100)                 │
│  Border:       #E2E8F0  ████  (slate-200)                 │
│                                                            │
│  Dark Mode Variants: ✓ Detected                           │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Typography Tokens

| Token | Value | Usage |
|-------|-------|-------|
| font-sans | Inter, system-ui | Body text |
| font-mono | JetBrains Mono, monospace | Code |
| text-xs | 0.75rem / 1rem | Captions |
| text-sm | 0.875rem / 1.25rem | Secondary |
| text-base | 1rem / 1.5rem | Body |
| text-lg | 1.125rem / 1.75rem | Lead |
| text-xl | 1.25rem / 1.75rem | H4 |
| text-2xl | 1.5rem / 2rem | H3 |
| text-3xl | 1.875rem / 2.25rem | H2 |
| text-4xl | 2.25rem / 2.5rem | H1 |

### Spacing Scale

```
4px  ▪ (1)    16px ████ (4)     48px ████████████ (12)
8px  ██ (2)   24px ██████ (6)   64px ████████████████ (16)
12px ███ (3)  32px ████████ (8)
```

### Token File Generated

Full tokens exported to: `.harn/design/design-tokens.json`

---

## Patterns Detected

### PAT-01: Auth Form Layout

**Used In:** Login, Signup
**Structure:**
```
┌─────────────────────────────────────────┐
│              [Logo]                      │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │         Card Container          │   │
│  │  ┌───────────────────────────┐  │   │
│  │  │ Heading                   │  │   │
│  │  │ Subtext                   │  │   │
│  │  └───────────────────────────┘  │   │
│  │  ┌───────────────────────────┐  │   │
│  │  │ Form Fields               │  │   │
│  │  └───────────────────────────┘  │   │
│  │  ┌───────────────────────────┐  │   │
│  │  │ Submit Button (full-width)│  │   │
│  │  └───────────────────────────┘  │   │
│  │  ┌───────────────────────────┐  │   │
│  │  │ Alt Action Link           │  │   │
│  │  └───────────────────────────┘  │   │
│  └─────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

### PAT-02: Dashboard Layout

**Used In:** All dashboard screens
**Structure:**
```
┌─────────────────────────────────────────────────────────┐
│  TopNav                                     [User Menu] │
├───────────┬─────────────────────────────────────────────┤
│           │                                             │
│  Sidebar  │  Main Content Area                          │
│           │  ┌─────────────────────────────────────┐   │
│  [Logo]   │  │ PageHeader                          │   │
│           │  │ Title + Actions                     │   │
│  [Nav]    │  └─────────────────────────────────────┘   │
│  - Item   │  ┌─────────────────────────────────────┐   │
│  - Item   │  │ Content                             │   │
│  - Item   │  │                                     │   │
│           │  │                                     │   │
│  [Footer] │  └─────────────────────────────────────┘   │
│           │                                             │
└───────────┴─────────────────────────────────────────────┘
```

### PAT-03: Settings Section

**Used In:** Settings, Profile, Billing
**Structure:**
```
┌─────────────────────────────────────────────────────────┐
│ Section Header                              [Action]     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Setting Item                                     │   │
│  │ ┌───────────────────────────────────────────┐   │   │
│  │ │ Label         [Input/Toggle/Select]       │   │   │
│  │ │ Description                               │   │   │
│  │ └───────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Setting Item 2                                   │   │
│  │ ...                                              │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  [Save Changes Button]                                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### PAT-04: Empty State

**Used In:** Dashboard, Projects, Analytics
**Components:** EmptyState → Icon + Heading + Description + CTA Button

### PAT-05: Data Table

**Used In:** Projects, Analytics
**Features:** Sorting, Pagination, Row actions

### PAT-06: Card Grid

**Used In:** Dashboard, Projects
**Layout:** responsive grid (1/2/3 columns)

---

## Dependency Graph

### Most Used Components

```
Usage Frequency (Top 10)
───────────────────────────────────────────────
Icon         ████████████████████████████  89
Button       ████████████████████          47
Stack        █████████████████             34
Input        ████████████████              32
Link         ███████████                   23
Card         █████████                     18
Spinner      ████████                      15
Separator    ████████                      15
Select       ███████                       14
Toast        ██████                        12
```

### Component Dependencies

```
Button
├── uses: Icon, Spinner
└── usedBy: Modal, Form, Card, PageHeader, Navbar (47 total)

Card
├── uses: -
└── usedBy: Dashboard, Projects, Settings (18 total)

Form
├── uses: Input, Select, Checkbox, Switch, Button
└── usedBy: Login, Signup, Settings, Profile (7 total)

Modal
├── uses: Button, Icon
└── usedBy: Projects, Settings (6 total)
```

---

## Recommendations

### For Design Export

1. **High-priority screens for design:**
   - SCR-06: Dashboard (most complex, establishes patterns)
   - SCR-04: Login (auth pattern template)
   - SCR-11: Profile (settings pattern template)

2. **Token export ready:**
   - Colors fully extracted with dark mode
   - Typography scale complete
   - Spacing uses standard Tailwind scale

3. **Pattern documentation:**
   - 6 patterns detected, document for consistency
   - Auth form pattern well-established
   - Dashboard layout is consistent

### Consistency Issues Found

| Issue | Severity | Location |
|-------|----------|----------|
| Button variant inconsistency | Low | Dashboard vs Settings |
| Spacing varies in cards | Medium | Projects page |
| Missing loading states | Medium | Analytics, Billing |

### Missing Elements

- [ ] No documented error states for forms
- [ ] No toast usage on some actions
- [ ] Dark mode incomplete on some custom components

---

## Metadata

```yaml
generated: YYYY-MM-DD HH:MM:SS
scanner_version: 1.0.0
scan_duration: 4.5s
files_scanned: 234
framework: Next.js 14.0.0
styling: Tailwind CSS 3.4.0
typescript: 5.2.0
```

---

*Generated by /ui:scan | Ready for /ui:generate-specs or /ui:export*
```

</template>

---

<guidelines>

## Section Purpose

| Section | Purpose | Key Data |
|---------|---------|----------|
| Executive Summary | Quick overview | Counts, health status |
| Framework & Stack | Tech detection | Framework, styling, routing |
| Component Inventory | Full component catalog | Name, path, props, variants, usage |
| Screen Inventory | All pages/routes | Route, layout, components, complexity |
| Design Tokens | Extracted values | Colors, typography, spacing |
| Patterns Detected | Reusable patterns | Structure, components, screens |
| Dependency Graph | Component relationships | Usage frequency, dependencies |
| Recommendations | Next steps | Priority, issues, gaps |

## Best Practices

1. **Be exhaustive** — Every component and screen must be cataloged
2. **Track sources** — Every value must reference its source file
3. **Show relationships** — Usage counts and dependencies matter
4. **Visual summaries** — ASCII charts help quick scanning
5. **Actionable recommendations** — End with clear next steps

## Complexity Classification

- **Simple:** < 5 components, no data fetching
- **Medium:** 5-10 components, basic data fetching
- **Complex:** > 10 components, multiple data sources, many states

## Pattern Detection Criteria

A pattern is detected when:
- Same structure appears in 2+ screens
- Component composition is repeated
- Layout structure is consistent

</guidelines>
