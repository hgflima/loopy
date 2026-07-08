---
name: ui:realize
description: Mark screens as realized and track implementation status
argument-hint: "[screen: SCR-XX] [--status: done|partial|blocked]"
allowed-tools: [Read, Write, Edit, Glob, AskUserQuestion]
---

<objective>
Track which screens have been realized in external tools. Update the registry with implementation status, link to outputs, and note any implementation details or variations.
</objective>

<context>
@.harn/design/UI-SPEC.md (if exists)
@.harn/design/UI-REGISTRY.md (if exists)
@.harn/design/screens/*.md (if exists)
</context>

<ux_principles>
## Quick Status Update

Allow quick marking of screens as realized:
- `/ui:realize SCR-01` — Mark as done
- `/ui:realize SCR-01 --partial` — Partially done
- `/ui:realize SCR-01 --blocked` — Blocked on something

## Batch Operations

Allow marking multiple screens:
- `/ui:realize SCR-01,SCR-02,SCR-03`
- `/ui:realize all` — Interactive selection
</ux_principles>

<process>

<step name="parse_arguments">
## Parse Arguments

Parse screen ID and status:
- Screen ID: `SCR-XX` format
- Status: `done` (default), `partial`, `blocked`

If no arguments:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► REALIZE SCREENS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Mark screens as realized in external tools.

Current Status:
  ✓ SCR-01: Login              Realized (Stitch)
  ○ SCR-02: Signup             Not realized
  ○ SCR-03: Dashboard          Not realized
  ◆ SCR-04: Settings           Partial (V0)
  ✗ SCR-05: Profile            Blocked

Which screens to update?
───────────────────────────────────────────────────────
```

Options:
- Select specific screens
- Mark all pending as done
- Update existing status
</step>

<step name="gather_details">
## Gather Realization Details

**Question: Where was this screen realized?**

Options:
- Stitch (Google Stitch)
- V0 (Vercel V0)
- Figma
- Manual implementation
- Other tool

**Question: Any notes about the implementation?**

Options:
- Matches spec exactly
- Minor variations (specify)
- Major changes (consider /ui:import-design)
- Blocked on [issue]
</step>

<step name="update_registry">
## Update Registry

Create or update `.harn/design/UI-REGISTRY.md`:

```markdown
# UI Registry

Last updated: [date]

## Realization Status

| Screen | Status | Tool | Version | Date | Notes |
|--------|--------|------|---------|------|-------|
| SCR-01 | ✓ Done | Stitch | v1 | 2026-01-19 | Matches spec |
| SCR-02 | ✓ Done | V0 | v1 | 2026-01-19 | Added loading state |
| SCR-03 | ○ Pending | - | - | - | - |
| SCR-04 | ◆ Partial | V0 | v1 | 2026-01-18 | Missing dark mode |
| SCR-05 | ✗ Blocked | - | - | - | Needs user avatar component |

## Legend
- ✓ Done: Fully realized
- ◆ Partial: Some elements incomplete
- ✗ Blocked: Cannot proceed
- ○ Pending: Not started

## Realization History

### SCR-01: Login
| Version | Date | Tool | Changes |
|---------|------|------|---------|
| v1 | 2026-01-19 | Stitch | Initial realization |

### SCR-02: Signup
| Version | Date | Tool | Changes |
|---------|------|------|---------|
| v1 | 2026-01-19 | V0 | Initial, added loading state |

## Output Locations

| Screen | Stitch | V0 | Figma | Code |
|--------|--------|----|----|------|
| SCR-01 | [link] | - | - | src/components/auth/login.tsx |
| SCR-02 | - | [link] | - | src/components/auth/signup.tsx |

## Blocked Items

### SCR-05: Profile
**Blocked on:** User avatar component not available
**Unblocked by:** Implement Avatar component (CMP-05)
**Added:** 2026-01-18
```
</step>

<step name="update_screen_spec">
## Update Screen Specification

Update the screen's spec file with realization info:

```markdown
## 1. Meta
- **Route:** /login
- **Requirements:** REQ-001
- **Status:** Realized ✓
- **Realized:** Stitch v1 (2026-01-19)
- **Last Updated:** 2026-01-19
```
</step>

<step name="update_state">
## Update Coordinator State

Update `.harn/design/ui-state/coordinator-state.json`:

```json
{
  "project_status": {
    "screens_total": 8,
    "screens_specified": 8,
    "screens_realized": {
      "done": 3,
      "partial": 1,
      "blocked": 1,
      "pending": 3
    }
  },
  "realization": {
    "SCR-01": { "status": "done", "tool": "stitch", "date": "2026-01-19" },
    "SCR-02": { "status": "done", "tool": "v0", "date": "2026-01-19" }
  }
}
```
</step>

<step name="check_blocked">
## Check for Blocked Dependencies

If marking as blocked, identify dependencies:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► BLOCKED SCREEN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SCR-05: Profile marked as blocked.

What's blocking this screen?
───────────────────────────────────────────────────────
```

Options:
- Missing component (specify)
- Missing design tokens
- External dependency
- Other (specify)

Track blocker for follow-up:
```markdown
## Blockers

| Screen | Blocker | Unblocked By | Added |
|--------|---------|--------------|-------|
| SCR-05 | Avatar component | Implement CMP-05 | 2026-01-18 |
```
</step>

<step name="completion">
## Completion Summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► REALIZATION UPDATED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Updated: [N] screens

  ✓ SCR-01: Login              Done (Stitch)
  ✓ SCR-02: Signup             Done (V0)

Overall Progress:
  Done:      3/8  ██████░░░░  37%
  Partial:   1/8
  Blocked:   1/8
  Pending:   3/8

Files Updated:
  ✓ .harn/design/UI-REGISTRY.md
  ✓ .harn/design/screens/SCR-01-login.md
  ✓ .harn/design/screens/SCR-02-signup.md
  ✓ .harn/design/ui-state/coordinator-state.json

───────────────────────────────────────────────────────

## ▶ Next Steps

[If partial screens exist]
**Complete partial screens:**
`/ui:export v0 SCR-04` — Regenerate for missing parts

[If blocked screens exist]
**Resolve blockers:**
SCR-05 blocked on Avatar component

[If all done]
**Check for drift:**
`/ui:sync` — Verify specs match reality

───────────────────────────────────────────────────────
```
</step>

</process>

<success_criteria>
- Screen realization status updated
- Registry file created/updated
- Screen spec files updated with status
- State file updated with progress
- Blockers tracked if any
- Progress clearly displayed
</success_criteria>
