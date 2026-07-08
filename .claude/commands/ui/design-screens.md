---
name: ui:design-screens
description: Create comprehensive screen specifications with wireframes and component mapping
allowed-tools: [Read, Write, Edit, AskUserQuestion, Glob, Grep, Task]
agent: ui-specifier (for complex specs), ui-researcher (for pattern research)
---

<objective>
Create detailed screen specifications following the 10-section format with ASCII wireframes. Extract screen inventory from requirements or through guided conversation. Produces specification files ready for export to any design tool.
</objective>

<context>
@./.claude/ui-design/templates/ui-spec.md
@./.claude/ui-design/templates/screen.md
@./.claude/ui-design/references/design-systems.md
@.harn/design/UI-CONTEXT.md (if exists)
@.harn/design/design-tokens.json (if exists)
@.harn/design/UI-INSPIRATION.md (if exists)
</context>

<ux_principles>
## Interactive Questioning

Every question must offer:
1. **Specific options** — Common choices relevant to the question
2. **"You decide"** — Let Claude choose smart defaults based on context
3. **Free text (Other)** — Always available via the AskUserQuestion tool

## Adaptive Flow
- Infer screens from requirements when available
- Ask fewer questions when context is clear
- Ask more when complexity is detected
- Spawn UI Specifier for complex multi-screen specifications
</ux_principles>

<process>

<step name="check_prerequisites">
## Check Prerequisites

1. **Check for UI-CONTEXT.md:**
   - If missing, suggest running `/ui:init` first
   - Or proceed with minimal context

2. **Check for design-tokens.json:**
   - If exists, reference tokens in specs
   - If missing, use placeholder references

3. **Check for existing screens:**
   - Glob `.harn/design/screens/SCR-*.md`
   - If found, offer to extend vs. replace

If screens exist:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► EXISTING SCREENS DETECTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Found [N] existing screen specifications:
  • SCR-01: Login
  • SCR-02: Signup
  ...

What would you like to do?
```

Options:
- Add new screens to existing inventory
- Update specific screens
- Start fresh (archive existing)
</step>

<step name="load_context">
## Load Project Context

**If UI-INSPIRATION.md exists:**
1. Read inspiration analysis
2. Note suggested patterns
3. Apply similar screen structures
</step>

<step name="identify_screens">
## Identify Screens

**Question: What screens does this application need?**

**Question: What kind of application is this?**

Options:
- SaaS application (auth, dashboard, settings)
- E-commerce (products, cart, checkout)
- Content/Blog (articles, categories)
- Dashboard/Admin (data, reports, management)
- Social/Community (profiles, feeds, messaging)
- You decide based on project context

**Question: What are the main user actions?**

Options (multi-select):
- Sign up / Sign in
- Browse/Search content
- Create/Edit items
- View analytics/reports
- Manage settings
- Other (specify)
</step>

<step name="define_screen_inventory">
## Define Screen Inventory

Create structured screen list with categories:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► SCREEN INVENTORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Authentication Flow:
  ○ SCR-01: Login (/login)
  ○ SCR-02: Signup (/signup)
  ○ SCR-03: Forgot Password (/forgot-password)

Main Application:
  ○ SCR-04: Dashboard (/dashboard)
  ○ SCR-05: [Feature] List (/features)
  ○ SCR-06: [Feature] Detail (/features/:id)

Settings:
  ○ SCR-07: Settings (/settings)
  ○ SCR-08: Profile (/profile)

Total: 8 screens

Shall I proceed with specifications?
───────────────────────────────────────────────────────
```
</step>

<step name="spawn_specifier_or_handle">
## Create Specifications

**For 5+ screens or complex requirements:**
- Spawn UI Specifier agent with full context
- Agent creates all specs in parallel
- Returns comprehensive specifications

**For 1-4 screens:**
- Handle directly without spawning
- Create each spec sequentially
</step>

<step name="screen_spec_format">
## Screen Specification Format (10 Sections)

Each screen follows this comprehensive format:

```markdown
# SCR-XX: [Screen Name]

## 1. Meta
- **Route:** /path/to/screen
- **Requirements:** REQ-XX, REQ-YY (if applicable)
- **Status:** Draft | Review | Final
- **Last Updated:** YYYY-MM-DD

## 2. Purpose
[One paragraph describing what this screen does and why it exists]

## 3. Wireframe

```
┌─────────────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────────────┐ │
│ │ Logo                              [Login] [Sign]│ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│              ┌─────────────────────┐               │
│              │     Card Header     │               │
│              ├─────────────────────┤               │
│              │                     │               │
│              │  ┌───────────────┐  │               │
│              │  │ Email Input   │  │               │
│              │  └───────────────┘  │               │
│              │                     │               │
│              │  ┌───────────────┐  │               │
│              │  │ Password      │  │               │
│              │  └───────────────┘  │               │
│              │                     │               │
│              │  [  Submit Button ] │               │
│              │                     │               │
│              │  Forgot? │ Sign up  │               │
│              └─────────────────────┘               │
│                                                     │
│              ┌─────────────────────┐               │
│              │ Footer / Copyright  │               │
│              └─────────────────────┘               │
└─────────────────────────────────────────────────────┘
```

## 4. Layout Structure
- **Container:** Centered, max-width: 400px
- **Background:** color.background.subtle
- **Spacing:** spacing.8 padding
- **Alignment:** Vertical center, horizontal center

## 5. Components

| Component | Variant | Props | Notes |
|-----------|---------|-------|-------|
| Card | elevated | - | Main container |
| Input | default | label="Email", type="email", required | With validation |
| Input | default | label="Password", type="password", required | With show/hide |
| Button | primary | fullWidth, size="lg" | Submit action |
| Link | text | - | Forgot password |
| Link | text | - | Sign up redirect |
| Divider | with-text | text="or" | Social separator |
| SocialButton | google | - | Google OAuth |
| SocialButton | github | - | GitHub OAuth |

## 6. States

### Loading State
- Button shows spinner
- Inputs disabled
- "Signing in..." text

### Error State
- Error alert at top of card
- Invalid fields highlighted
- Error messages below inputs

### Success State
- Brief success message
- Redirect to dashboard

## 7. Interactions

| Trigger | Action | Feedback |
|---------|--------|----------|
| Submit (valid) | POST /api/auth/login | Loading → Success/Error |
| Submit (invalid) | Validate client-side | Show field errors |
| Forgot click | Navigate to /forgot-password | - |
| Signup click | Navigate to /signup | - |
| Social click | OAuth redirect | Loading state |

## 8. Responsive Behavior

| Breakpoint | Changes |
|------------|---------|
| Mobile (<640px) | Card full width, padding reduced |
| Tablet (640-1024px) | Card max-width: 400px |
| Desktop (>1024px) | Card max-width: 400px, larger margins |

## 9. Accessibility

- Focus management: First input on load
- Tab order: Email → Password → Submit → Links
- Error announcements via aria-live
- All inputs have visible labels
- Minimum contrast: WCAG AA

## 10. Content

| Element | Text | Notes |
|---------|------|-------|
| Title | "Welcome back" | Card header |
| Subtitle | "Sign in to your account" | Below title |
| Email label | "Email address" | Input label |
| Password label | "Password" | Input label |
| Submit | "Sign in" | Button text |
| Forgot link | "Forgot password?" | Link text |
| Signup text | "Don't have an account?" | Prefix |
| Signup link | "Sign up" | Link text |
| Error (generic) | "Invalid email or password" | Auth failure |
| Error (email) | "Please enter a valid email" | Validation |
| Error (password) | "Password is required" | Validation |
```
</step>

<step name="create_navigation_flows">
## Navigation Flows

Create flow documentation showing how screens connect:

```markdown
## Authentication Flow

```
        ┌─────────┐
        │  Start  │
        └────┬────┘
             │
             ▼
    ┌────────────────┐     success     ┌───────────────┐
    │    SCR-01      │────────────────▶│    SCR-04     │
    │     Login      │                 │   Dashboard   │
    └───────┬────────┘                 └───────────────┘
            │
    ┌───────┴───────┐
    │               │
    ▼               ▼
┌──────────┐  ┌──────────┐
│  SCR-02  │  │  SCR-03  │
│  Signup  │  │  Forgot  │
└────┬─────┘  └────┬─────┘
     │             │
     └──────┬──────┘
            │
            ▼
    ┌───────────────┐
    │    SCR-04     │
    │   Dashboard   │
    └───────────────┘
```

## Main Application Flow

[Similar diagrams for other flows]
```
</step>

<step name="create_ui_spec">
## Create Master UI-SPEC.md

Create or update `.harn/design/UI-SPEC.md`:

```markdown
# UI Specification

Last updated: [date]
Generated by: /ui:design-screens

## Overview

[Brief description of the application's UI]

## Design System

- **Tokens:** `.harn/design/design-tokens.json`
- **Platform:** [from UI-CONTEXT.md]
- **Framework:** [from UI-CONTEXT.md]

## Screen Inventory

| ID | Screen | Route | Status | Requirements |
|----|--------|-------|--------|--------------|
| SCR-01 | Login | /login | Draft | REQ-001 |
| SCR-02 | Signup | /signup | Draft | REQ-002 |
| ... | ... | ... | ... | ... |

## Navigation Flows

### Authentication
Login → Dashboard (on success)
Login → Signup (new user)
Login → Forgot Password (reset)

### Main Application
[Flow descriptions]

## Patterns Used

- **PAT-01:** Auth Card Pattern (Login, Signup, Forgot)
- **PAT-02:** Dashboard Layout (sidebar + main)
- **PAT-03:** Data Table Pattern (List views)

## Component Summary

Pending: Run `/ui:define-components` for full inventory

## Files

- `screens/SCR-01-login.md`
- `screens/SCR-02-signup.md`
- ...
```
</step>

<step name="identify_patterns">
## Identify Shared Patterns

While creating specs, identify reusable patterns:

```markdown
## Detected Patterns

**PAT-01: Auth Card**
- Used in: SCR-01, SCR-02, SCR-03
- Structure: Centered card, logo, form, footer links
- Consider: Create once, reuse

**PAT-02: Data List**
- Used in: SCR-05, SCR-10, SCR-12
- Structure: Header with actions, filterable table, pagination
- Consider: Extract to pattern

**PAT-03: Detail View**
- Used in: SCR-06, SCR-11
- Structure: Header with back, content sections, action footer
- Consider: Extract to pattern
```

Document patterns in `.harn/design/UI-PATTERNS.md` or note for `/ui:patterns` command.
</step>

<step name="update_state">
## Update State

Update `.harn/design/ui-state/coordinator-state.json`:
```json
{
  "project_status": {
    "phase": "specification",
    "screens_total": [N],
    "screens_specified": [N]
  }
}
```
</step>

<step name="completion">
## Completion Summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► SCREENS SPECIFIED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Created [N] screen specifications:

Authentication:
  ✓ SCR-01: Login           screens/SCR-01-login.md
  ✓ SCR-02: Signup          screens/SCR-02-signup.md
  ✓ SCR-03: Forgot Password screens/SCR-03-forgot-password.md

Main Application:
  ✓ SCR-04: Dashboard       screens/SCR-04-dashboard.md
  ✓ SCR-05: Items List      screens/SCR-05-items-list.md
  ✓ SCR-06: Item Detail     screens/SCR-06-item-detail.md

Settings:
  ✓ SCR-07: Settings        screens/SCR-07-settings.md
  ✓ SCR-08: Profile         screens/SCR-08-profile.md

Patterns Identified: 3
  • Auth Card (SCR-01, SCR-02, SCR-03)
  • Data List (SCR-05)
  • Detail View (SCR-06)

Files:
  .harn/design/UI-SPEC.md
  .harn/design/screens/*.md

───────────────────────────────────────────────────────

## ▶ Next Up

**Define components** — Extract component inventory from screens

`/ui:define-components`

**Or export directly** — Generate design tool prompts

`/ui:export stitch`    Visual designs
`/ui:export v0`        React components

───────────────────────────────────────────────────────
```
</step>

</process>

<success_criteria>
- `.harn/design/UI-SPEC.md` exists with screen inventory and navigation flows
- `.harn/design/screens/SCR-XX-*.md` files created for all screens
- Each screen has all 10 sections (wireframe, components, states, etc.)
- Navigation flows document how screens connect
- Patterns identified and documented
- State file updated
</success_criteria>
