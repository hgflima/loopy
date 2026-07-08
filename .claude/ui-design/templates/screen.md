# Screen Template

Template for `.harn/design/screens/SCR-XX-[name].md` — individual screen specifications using the 10-section format.

---

<template>

```markdown
# SCR-[XX]: [Screen Name]

## 1. Meta

- **Route:** /[path]
- **Requirements:** REQ-XX, REQ-XX (if applicable)
- **Pattern:** PAT-XX (if applicable)
- **Status:** Draft | Review | Final | Realized
- **Realized:** [Tool] v[N] ([date]) (when applicable)
- **Last Updated:** YYYY-MM-DD

## 2. Purpose

[One paragraph describing what this screen does and why it exists. What user goal does it serve? What can they accomplish here?]

## 3. Wireframe

```
┌─────────────────────────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ [Header / Navigation]                                       │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│                    ┌───────────────────────┐                   │
│                    │      [Card/Panel]     │                   │
│                    ├───────────────────────┤                   │
│                    │                       │                   │
│                    │   [Content Area]      │                   │
│                    │                       │                   │
│                    │   ┌───────────────┐   │                   │
│                    │   │   [Input]     │   │                   │
│                    │   └───────────────┘   │                   │
│                    │                       │                   │
│                    │   [ Primary Button ]  │                   │
│                    │                       │                   │
│                    │      [Footer]         │                   │
│                    └───────────────────────┘                   │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ [Footer]                                                    │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Wireframe Key
- `┌─┐` — Container/card boundaries
- `[ ]` — Buttons or clickable elements
- `───` — Dividers or separators
- `...` — Variable content area

## 4. Layout Structure

- **Page:** [Full-width | Centered | Sidebar | Split]
- **Container:** [max-width, alignment]
- **Background:** [token reference]
- **Spacing:** [padding, gaps - token references]
- **Alignment:** [vertical, horizontal]

### Grid/Structure
```
[Describe grid columns, flex layout, or positioning]
- Main: [12-col grid | flex-1 | etc.]
- Sidebar: [3-col | 280px fixed | etc.]
```

## 5. Components

| Component | Variant | Props | Notes |
|-----------|---------|-------|-------|
| [Name] | [variant] | [key props] | [context] |
| Navbar | default | - | Fixed top |
| Card | elevated | padding="lg" | Main container |
| Input | default | label="Email", type="email", required | With validation |
| Input | default | label="Password", type="password", required | Show/hide toggle |
| Button | primary | fullWidth, size="lg" | Submit action |
| Link | text | href="/forgot" | Secondary action |
| Separator | with-text | text="or" | Before social options |
| Button | outline | icon="google" | Social login |
| Button | outline | icon="github" | Social login |

### Component Hierarchy
```
Page
├── Navbar
│   ├── Logo
│   └── NavLinks
├── Main
│   └── Card
│       ├── CardHeader
│       │   ├── Heading
│       │   └── Subheading
│       ├── CardContent
│       │   ├── Form
│       │   │   ├── Input (email)
│       │   │   ├── Input (password)
│       │   │   └── Button (submit)
│       │   ├── Link (forgot)
│       │   ├── Separator
│       │   └── SocialButtons
│       └── CardFooter
│           └── SignupLink
└── Footer
```

## 6. States

### Default State
[Describe the initial appearance when the screen loads]

### Loading State
- [What shows loading spinner/skeleton]
- [Which elements are disabled]
- [Loading text if any]

### Error State
- **Validation errors:** [How field errors appear]
- **API errors:** [How server errors appear]
- **Error placement:** [Inline, toast, alert]

### Success State
- [What happens on success]
- [Redirect, message, animation]

### Empty State
- [If applicable - no data scenario]
- [Illustration, message, CTA]

### State Diagram
```
┌─────────┐    submit    ┌─────────┐
│ Default │─────────────▶│ Loading │
└─────────┘              └────┬────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
        ┌─────────┐    ┌─────────┐    ┌─────────┐
        │  Error  │    │ Success │    │ Timeout │
        └────┬────┘    └─────────┘    └────┬────┘
             │                              │
             └──────────────────────────────┘
                          │
                          ▼
                    ┌─────────┐
                    │ Default │
                    └─────────┘
```

## 7. Interactions

| Trigger | Action | Feedback | Navigation |
|---------|--------|----------|------------|
| Page load | Focus first input | - | - |
| Form submit (valid) | POST /api/auth/login | Loading → Success/Error | → /dashboard |
| Form submit (invalid) | Validate client-side | Show field errors | - |
| Forgot link click | - | - | → /forgot-password |
| Social button click | OAuth redirect | Loading state | → OAuth provider |
| Signup link click | - | - | → /signup |

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| Enter | Submit form (when focused) |
| Tab | Next field |
| Escape | [If modal, close] |

### Touch Gestures (Mobile)
| Gesture | Action |
|---------|--------|
| Tap | [Standard tap actions] |
| Swipe | [If applicable] |

## 8. Responsive Behavior

| Breakpoint | Width | Changes |
|------------|-------|---------|
| Mobile | <640px | Full-width card, reduced padding, stacked layout |
| Tablet | 640-1024px | Centered card max-w-md, standard padding |
| Desktop | >1024px | Centered card max-w-sm, generous margins |

### Mobile-Specific
- [Simplified navigation]
- [Touch-friendly targets (min 44px)]
- [Adjusted typography scale]

### Desktop-Specific
- [Hover states visible]
- [Keyboard navigation expected]
- [Wider content areas]

## 9. Accessibility

### Requirements
- [ ] All form fields have associated labels
- [ ] Focus order follows visual order
- [ ] Focus indicator visible (min 2px)
- [ ] Color contrast meets WCAG AA (4.5:1 text, 3:1 UI)
- [ ] Error messages linked via aria-describedby
- [ ] Loading state announced (aria-busy, aria-live)
- [ ] Required fields indicated (required, aria-required)

### Focus Management
- **On load:** Focus first interactive element (email input)
- **On error:** Focus first error field
- **On success:** [Announce success, redirect]

### Screen Reader Notes
- [Any content that needs aria-label]
- [Live regions for dynamic updates]
- [Hidden decorative elements]

### Motion
- [ ] Respects prefers-reduced-motion
- [List animations that should be disabled]

## 10. Content

| Element | Text | Token/Style | Notes |
|---------|------|-------------|-------|
| Page title | "Welcome back" | typography.2xl, fontWeight.semibold | Card header |
| Subtitle | "Sign in to your account" | typography.sm, color.text.muted | Below title |
| Email label | "Email address" | typography.sm, fontWeight.medium | Input label |
| Email placeholder | "you@example.com" | typography.sm, color.text.subtle | Optional |
| Password label | "Password" | typography.sm, fontWeight.medium | Input label |
| Forgot link | "Forgot password?" | typography.sm, color.primary.default | Link |
| Submit button | "Sign in" | typography.sm, fontWeight.medium | Button text |
| Separator | "or continue with" | typography.xs, color.text.muted | Divider text |
| Footer text | "Don't have an account?" | typography.sm, color.text.muted | Prefix |
| Footer link | "Sign up" | typography.sm, color.primary.default | Link |

### Error Messages
| Field | Error | Message |
|-------|-------|---------|
| Email | Empty | "Email is required" |
| Email | Invalid | "Please enter a valid email address" |
| Password | Empty | "Password is required" |
| Password | Too short | "Password must be at least 8 characters" |
| Form | Auth failed | "Invalid email or password" |
| Form | Rate limited | "Too many attempts. Please try again later." |

### Success Messages
| Context | Message |
|---------|---------|
| Login success | "Welcome back!" (brief, then redirect) |

---

## References

- **Pattern:** [PAT-XX if applicable]
- **Inspiration:** [Links to reference designs]
- **Figma:** [Link when designed]
- **Implementation:** [File path when coded]

---
*Generated by /ui:design-screens*
```

</template>

---

<guidelines>

## Section Purpose

| Section | Purpose | Required |
|---------|---------|----------|
| 1. Meta | Identification and tracking | Yes |
| 2. Purpose | User goal explanation | Yes |
| 3. Wireframe | Visual structure (ASCII) | Yes |
| 4. Layout | CSS/positioning details | Yes |
| 5. Components | Component inventory | Yes |
| 6. States | All screen states | Yes |
| 7. Interactions | User action mapping | Yes |
| 8. Responsive | Breakpoint behavior | Yes |
| 9. Accessibility | A11y requirements | Yes |
| 10. Content | All text/copy | Yes |

## ASCII Wireframe Characters

```
┌ ┐ └ ┘  — Corners
│ ─      — Lines
├ ┤ ┬ ┴  — T-junctions
┼        — Cross
[ ]      — Buttons/clickable
< >      — Dropdowns/selects
○ ●      — Radio buttons
□ ■      — Checkboxes
═ ║      — Double lines (emphasis)
```

## Complexity Levels

**Simple screen** (login, error, confirmation):
- 3-5 components
- 2-3 states
- Minimal interactions
- Single purpose

**Medium screen** (settings, profile, form):
- 5-10 components
- Multiple states
- Form validation
- Several interactions

**Complex screen** (dashboard, editor, list):
- 10+ components
- Many states
- Multiple interaction patterns
- Consider splitting into regions

## Tips

1. **Wireframe first** — Visual structure helps clarify everything else
2. **Components match inventory** — Use names from COMPONENTS.md
3. **Token references** — Always use tokens, not raw values
4. **States are crucial** — Cover all possible states
5. **Content is real** — Use actual copy, not "lorem ipsum"
6. **Accessibility always** — Not optional, always document

</guidelines>
