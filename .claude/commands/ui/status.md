---
name: ui:status
description: Show comprehensive UI specification coverage and realization status
allowed-tools: [Read, Glob, Grep]
---

<objective>
Display the current state of UI specifications: what's defined, what's been realized in external tools, export coverage, and overall project health. Provide actionable recommendations for next steps.
</objective>

<context>
@.harn/design/UI-SPEC.md (if exists)
@.harn/design/design-tokens.json (if exists)
@.harn/design/COMPONENTS.md (if exists)
@.harn/design/screens/*.md (if exists)
@.harn/design/ui-exports/*.md (if exists)
@.harn/design/UI-REGISTRY.md (if exists)
@.harn/design/UI-PATTERNS.md (if exists)
@.harn/design/UI-DECISIONS.md (if exists)
@.harn/design/ui-state/coordinator-state.json (if exists)
</context>

<process>

<step name="check_all_artifacts">
## Check All Artifacts

Check for existence and content of all UI artifacts:

**Core Specifications:**
- `.harn/design/UI-CONTEXT.md` — Project context
- `.harn/design/UI-SPEC.md` — Master specification
- `.harn/design/design-tokens.json` — Design tokens
- `.harn/design/COMPONENTS.md` — Component inventory
- `.harn/design/UI-PATTERNS.md` — Pattern library
- `.harn/design/UI-DECISIONS.md` — Decision log

**Screen Specifications:**
- `.harn/design/screens/SCR-*.md` — Individual screens

**Exports:**
- `.harn/design/ui-exports/stitch-prompts.md`
- `.harn/design/ui-exports/v0-prompts.md`
- `.harn/design/ui-exports/figma-tokens.json`
- `.harn/design/ui-exports/DESIGN.md` — VoltAgent DESIGN.md export (report mtime if present)
- `.harn/design/ui-exports/generic-prompts.md`
- `.harn/design/ui-exports/handoffs/*.md`

**State:**
- `.harn/design/UI-REGISTRY.md` — Realization tracking
- `.harn/design/ui-state/coordinator-state.json`
</step>

<step name="calculate_metrics">
## Calculate Metrics

**Token Metrics:**
- Total tokens defined
- Tokens by category (colors, typography, spacing, etc.)
- Token usage count across specs

**Screen Metrics:**
- Total screens specified
- Screens with complete specs (all 10 sections)
- Screens with wireframes
- Screens realized

**Component Metrics:**
- Total components defined
- Components with full specs
- Component usage frequency
- Library alignment percentage

**Export Metrics:**
- Screens exported per service
- Export freshness (stale vs. current)
- Handoffs generated

**Realization Metrics:**
- Screens done
- Screens partial
- Screens blocked
- Screens pending
</step>

<step name="display_status">
## Display Status

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI Design System Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROJECT CONTEXT                              [✓ Defined]
───────────────────────────────────────────────────────
  Platform:    Web (Next.js)
  Styling:     Tailwind CSS
  Library:     shadcn/ui
  Inspiration: Linear, Vercel
  Phase:       Specification → Export

DESIGN TOKENS                                [✓ 45 tokens]
───────────────────────────────────────────────────────
  Colors:       24 values  ████████████████████████
  Typography:    8 values  ████████
  Spacing:      10 values  ██████████
  Borders:       3 values  ███
  Shadows:       4 values  ████

  Dark mode:    ✓ Supported

SCREENS                                      [6/8 specified]
───────────────────────────────────────────────────────
  ✓ SCR-01: Login              Complete  ✓ Realized
  ✓ SCR-02: Signup             Complete  ✓ Realized
  ✓ SCR-03: Forgot Password    Complete  ○ Pending
  ✓ SCR-04: Dashboard          Complete  ◆ Partial
  ◆ SCR-05: Items List         Partial   ○ Pending
  ◆ SCR-06: Item Detail        Partial   ○ Pending
  ○ SCR-07: Settings           Pending   ○ Pending
  ○ SCR-08: Profile            Pending   ○ Pending

  Specification: ██████████████░░░░░░ 75%
  Realization:   ████░░░░░░░░░░░░░░░░ 25%

COMPONENTS                                   [18 defined]
───────────────────────────────────────────────────────
  Primitives:     6  Button, Link, Icon, Badge, Avatar, Separator
  Form Elements:  5  Input, TextArea, Select, Checkbox, Switch
  Layout:         3  Card, Container, Divider
  Navigation:     2  Navbar, Tabs
  Feedback:       3  Alert, Toast, Dialog
  Composite:      2  LoginForm, DataTable

  Library match:  14/18 (78% shadcn/ui)
  Fully specified: 12/18 (67%)

PATTERNS                                     [3 documented]
───────────────────────────────────────────────────────
  PAT-01: Auth Card        Used in 3 screens
  PAT-02: Data Table       Used in 2 screens
  PAT-03: Detail View      Used in 2 screens

EXPORTS                                      [2 services]
───────────────────────────────────────────────────────
  Stitch:
    ✓ 4/6 screens exported
    ⚠ 1 stale (spec updated since export)

  V0:
    ✓ 3/6 screens exported
    ○ 3 pending

  Figma:
    ✓ Tokens exported

  DESIGN.md:
    ✓ present (last generated: 2026-04-15 18:32)
    [or] ○ Not generated

  Generic:
    ○ Not exported

REALIZATION PROGRESS                         [2/8 done]
───────────────────────────────────────────────────────
  ✓ Done:      2 screens  ████
  ◆ Partial:   1 screen   ██
  ✗ Blocked:   0 screens
  ○ Pending:   5 screens  ██████████████

DECISIONS                                    [8 recorded]
───────────────────────────────────────────────────────
  Recent:
    • DEC-008: Social login addition (Jan 19)
    • DEC-007: Background color token (Jan 19)
    • DEC-006: Typography scale choice (Jan 18)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HEALTH CHECK
───────────────────────────────────────────────────────
  ✓ Tokens defined
  ✓ Screens specified (6/8)
  ⚠ 1 stale export
  ○ 2 screens need completion
  ○ 3 screens need realization

  Overall: ██████████████░░░░░░ 70%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
</step>

<step name="suggest_actions">
## Suggest Actions

Based on current status, recommend next steps:

```
## ▶ Suggested Actions

Based on current status:

[If specs incomplete]
1. **Complete screen specifications**
   `/ui:design-screens SCR-07,SCR-08`
   2 screens need specification

[If exports stale]
2. **Refresh stale exports**
   `/ui:export stitch SCR-02`
   1 export needs refresh

[If realization pending]
3. **Continue realization**
   Screens ready for design: SCR-03, SCR-05, SCR-06
   `/ui:export stitch SCR-03`

[If sync needed]
4. **Check for drift**
   `/ui:sync`
   Verify specs match implementations

───────────────────────────────────────────────────────

## Quick Commands

/ui:design-screens        Complete remaining screens
/ui:export stitch        Export to Stitch
/ui:realize SCR-XX       Mark screen as realized
/ui:sync                 Check system consistency

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
</step>

</process>

<success_criteria>
- All UI artifacts checked for existence
- Comprehensive metrics calculated
- Clear status display for each category
- Health check performed
- Actionable next steps provided
</success_criteria>
