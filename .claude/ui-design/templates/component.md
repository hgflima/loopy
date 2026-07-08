# Component Template

Template for component specifications in `.harn/design/COMPONENTS.md`.

---

<template>

```markdown
---

## CMP-[XX]: [ComponentName]

**Category:** [Primitive | Form | Layout | Navigation | Feedback | Data | Composite]
**Priority:** [Core | Standard | Optional]
**Library Match:** [shadcn/ui Component | MUI Component | Custom]

### Description

[One sentence describing the component's purpose and primary use case.]

### Usage

| Screen | Context |
|--------|---------|
| SCR-01 | Login submit button |
| SCR-02 | Signup submit button |
| SCR-04 | Dashboard action buttons |

### Variants

```
┌──────────────────────────────────────────────────────────────┐
│  Variants                                                    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Primary   │  │  Secondary  │  │    Ghost    │         │
│  │  (#2563EB)  │  │  (outlined) │  │   (text)    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ Destructive │  │   Outline   │  │    Link     │         │
│  │  (#EF4444)  │  │  (border)   │  │ (underline) │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

| Variant | Description | Use Case |
|---------|-------------|----------|
| primary | Solid background, high contrast | Main actions, CTAs |
| secondary | Subtle background, lower contrast | Secondary actions |
| ghost | No background, text only | Tertiary actions, menus |
| destructive | Red/danger styling | Delete, remove actions |
| outline | Border only, no fill | Alternative secondary |
| link | Underlined text style | Inline links |

### Sizes

```
┌──────────────────────────────────────────────────────────────┐
│  Sizes                                                       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌───────┐      ┌───────────┐      ┌─────────────────┐      │
│  │  xs   │      │    sm     │      │       md        │      │
│  │ 24px  │      │   32px    │      │      40px       │      │
│  └───────┘      └───────────┘      └─────────────────┘      │
│                                                              │
│  ┌─────────────────────┐      ┌───────────────────────────┐ │
│  │         lg          │      │            xl             │ │
│  │        48px         │      │           56px            │ │
│  └─────────────────────┘      └───────────────────────────┘ │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

| Size | Height | Padding | Font Size | Icon Size |
|------|--------|---------|-----------|-----------|
| xs | 24px | spacing.1 spacing.2 | typography.xs | 12px |
| sm | 32px | spacing.1.5 spacing.3 | typography.sm | 14px |
| md | 40px | spacing.2 spacing.4 | typography.sm | 16px |
| lg | 48px | spacing.2.5 spacing.5 | typography.base | 18px |
| xl | 56px | spacing.3 spacing.6 | typography.lg | 20px |

### Props

| Prop | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| children | ReactNode | - | Yes | Button content |
| variant | "primary" \| "secondary" \| "ghost" \| "destructive" \| "outline" \| "link" | "primary" | No | Visual style |
| size | "xs" \| "sm" \| "md" \| "lg" \| "xl" | "md" | No | Size preset |
| disabled | boolean | false | No | Prevents interaction |
| loading | boolean | false | No | Shows loading spinner |
| icon | ReactNode | undefined | No | Leading icon element |
| iconPosition | "left" \| "right" | "left" | No | Icon placement |
| fullWidth | boolean | false | No | Expands to container width |
| type | "button" \| "submit" \| "reset" | "button" | No | HTML button type |
| asChild | boolean | false | No | Render as child element (Radix) |
| onClick | () => void | undefined | No | Click handler |
| className | string | undefined | No | Additional CSS classes |

### States

```
┌──────────────────────────────────────────────────────────────┐
│  States                                                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Default    Hover      Active     Focus      Disabled        │
│  ┌─────┐   ┌─────┐   ┌─────┐   ┌─────┐   ┌ ─ ─ ─┐          │
│  │     │   │░░░░░│   │▓▓▓▓▓│   │○────│   │      │          │
│  │     │   │░░░░░│   │▓▓▓▓▓│   │○────│   │      │          │
│  └─────┘   └─────┘   └─────┘   └─────┘   └ ─ ─ ─┘          │
│                                                              │
│  Loading                                                     │
│  ┌─────────┐                                                │
│  │ ◠ Loading│                                                │
│  └─────────┘                                                │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

| State | Visual Change | Trigger | Token Reference |
|-------|---------------|---------|-----------------|
| default | Base appearance | Initial | color.primary.default |
| hover | Slightly darker | Mouse enter | color.primary.hover |
| active | Darker, slight scale | Mouse down | color.primary.active |
| focus | Ring outline | Tab/click | border.focus + ring |
| disabled | Muted, no pointer | disabled=true | opacity.disabled |
| loading | Spinner, disabled | loading=true | - |

### Accessibility

**Keyboard Navigation:**
- [ ] Tab: Moves focus to/from button
- [ ] Enter/Space: Activates button
- [ ] Focus visible: 2px ring outline

**ARIA:**
- [ ] `aria-disabled="true"` when disabled (not just `disabled` attr)
- [ ] `aria-busy="true"` when loading
- [ ] `aria-label` required if icon-only
- [ ] `role="button"` if using `asChild` with non-button element

**Screen Reader:**
- [ ] Loading state announced
- [ ] Disabled state conveyed
- [ ] Button purpose clear from content

### Token References

| Property | Light Mode | Dark Mode |
|----------|------------|-----------|
| Background | color.primary.default | color.primary.default |
| Background (hover) | color.primary.hover | color.primary.hover |
| Text | color.primary.foreground | color.primary.foreground |
| Border radius | border.radius.md | border.radius.md |
| Padding H | spacing.4 | spacing.4 |
| Padding V | spacing.2 | spacing.2 |
| Font size | typography.fontSize.sm | typography.fontSize.sm |
| Font weight | typography.fontWeight.medium | typography.fontWeight.medium |
| Transition | transition.duration.150 | transition.duration.150 |
| Focus ring | border.focus (2px) | border.focus (2px) |

### Code Hint

```typescript
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive' | 'outline' | 'link';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  asChild?: boolean;
}
```

### Usage Examples

**Basic:**
```jsx
<Button>Click me</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="ghost">Learn more</Button>
```

**With icon:**
```jsx
<Button icon={<PlusIcon />}>Add item</Button>
<Button icon={<ArrowRightIcon />} iconPosition="right">Next</Button>
```

**States:**
```jsx
<Button loading>Saving...</Button>
<Button disabled>Unavailable</Button>
```

**Full width:**
```jsx
<Button fullWidth size="lg">Sign in</Button>
```

### Do's and Don'ts

**Do:**
- ✓ Use `primary` for the main action per section
- ✓ Keep button text short and action-oriented
- ✓ Use loading state for async operations
- ✓ Provide aria-label for icon-only buttons
- ✓ Use consistent sizing within a context

**Don't:**
- ✗ Don't use multiple `primary` buttons in same section
- ✗ Don't use `destructive` for non-destructive actions
- ✗ Don't disable without explaining why
- ✗ Don't use buttons for navigation (use links)
- ✗ Don't make buttons too small for touch (min 44px)

---
```

</template>

---

<categories>

## Component Categories

### Primitives
Basic building blocks used across the app.
- **Button** — Click trigger for actions
- **Link** — Navigation element
- **Icon** — Visual symbols
- **Badge** — Status/count indicators
- **Avatar** — User/entity representation
- **Separator** — Visual divider

### Form Elements
Input and selection components.
- **Input** — Text input field
- **TextArea** — Multi-line text input
- **Select** — Dropdown selection
- **Checkbox** — Boolean selection
- **Radio** — Single selection from group
- **Switch** — Toggle on/off
- **Slider** — Range selection
- **DatePicker** — Date selection
- **FileUpload** — File input

### Layout
Structural and spacing components.
- **Card** — Content container
- **Container** — Max-width wrapper
- **Divider** — Section separator
- **Stack** — Vertical/horizontal spacing
- **Grid** — Grid layout
- **AspectRatio** — Aspect ratio container

### Navigation
Wayfinding components.
- **Navbar** — Main navigation
- **Sidebar** — Side navigation
- **Tabs** — Tabbed content
- **Breadcrumb** — Location indicator
- **Pagination** — Page navigation
- **Menu** — Action menu
- **DropdownMenu** — Dropdown actions

### Feedback
User feedback and notifications.
- **Alert** — Inline message
- **Toast** — Temporary notification
- **Dialog** — Modal dialog
- **Modal** — Overlay modal
- **Progress** — Progress indicator
- **Skeleton** — Loading placeholder
- **Spinner** — Loading indicator

### Data Display
Showing data and content.
- **Table** — Tabular data
- **DataTable** — Interactive table
- **List** — List of items
- **Tree** — Hierarchical data
- **Stat** — Statistics display
- **Chart** — Data visualization

### Composite
App-specific combinations.
- **LoginForm** — Complete login
- **SearchBar** — Search interface
- **UserCard** — User display
- **FeatureCard** — Feature highlight

</categories>

---

<spec_depth>

## Specification Depth

### Minimal (Simple primitives)
- Props table
- Basic usage example
- Token references

### Standard (Most components)
- Variants visualization (ASCII)
- Sizes visualization (ASCII)
- Props table
- States table
- Token references
- Usage examples

### Comprehensive (Complex components)
- All of standard
- Accessibility checklist
- Keyboard navigation
- Do's and don'ts
- Edge cases
- Code hints

</spec_depth>
