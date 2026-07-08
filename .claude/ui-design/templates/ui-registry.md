# UI-REGISTRY.md Template

Template for `.harn/design/UI-REGISTRY.md` — tracks the realization and implementation status of UI screens.

---

<template>

```markdown
# UI Registry: [Project Name]

> Tracking realization, implementation, and maintenance of UI specifications.
> Total Screens: [N] | Realized: [N] | Implemented: [N]
> Last Updated: YYYY-MM-DD

---

## Overview

The UI Registry tracks the lifecycle of each screen from specification through implementation and maintenance.

### Pipeline Summary

```
┌────────────────────────────────────────────────────────────┐
│  Screen Pipeline                                           │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Specified ──▶ Exported ──▶ Realized ──▶ Implemented       │
│                                                            │
│     [8]         [6]          [4]           [2]            │
│                                                            │
│  ████████████████████████████████░░░░░░░░  Specified      │
│  ██████████████████████████░░░░░░░░░░░░░░  Exported       │
│  ████████████████░░░░░░░░░░░░░░░░░░░░░░░░  Realized       │
│  ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  Implemented    │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Status Legend

| Status | Description | Artifact |
|--------|-------------|----------|
| Draft | Initial wireframe only | `screens/SCR-XX-*.md` (partial) |
| Specified | Full 10-section spec complete | `screens/SCR-XX-*.md` (complete) |
| Exported | Prompts generated for tool | `ui-exports/*-prompts.md` |
| Realized | Visual design created | External tool (Stitch, V0, Figma) |
| Implemented | Code in codebase | `src/app/**` or `src/components/**` |
| Verified | Matches spec, tested | QA passed |

---

## Screen Registry

### Core Screens (Priority: Must Have)

| ID | Screen | Spec | Export | Realize | Implement | Verify |
|----|--------|------|--------|---------|-----------|--------|
| SCR-01 | Login | ✅ | ✅ Stitch | ✅ | ✅ | ✅ |
| SCR-02 | Signup | ✅ | ✅ Stitch | ✅ | ⏳ | ○ |
| SCR-03 | Dashboard | ✅ | ✅ Stitch | ✅ | ○ | ○ |
| SCR-04 | Settings | ✅ | ✅ V0 | ○ | ○ | ○ |

### Standard Screens (Priority: Should Have)

| ID | Screen | Spec | Export | Realize | Implement | Verify |
|----|--------|------|--------|---------|-----------|--------|
| SCR-05 | Profile | ✅ | ○ | ○ | ○ | ○ |
| SCR-06 | Projects | ⏳ | ○ | ○ | ○ | ○ |
| SCR-07 | Project Detail | ○ | ○ | ○ | ○ | ○ |

### Optional Screens (Priority: Nice to Have)

| ID | Screen | Spec | Export | Realize | Implement | Verify |
|----|--------|------|--------|---------|-----------|--------|
| SCR-08 | Help | ○ | ○ | ○ | ○ | ○ |
| SCR-09 | Changelog | ○ | ○ | ○ | ○ | ○ |

**Legend:** ✅ Complete | ⏳ In Progress | ○ Not Started

---

## Realization Log

Detailed tracking of external tool work.

### SCR-01: Login

| Event | Date | Tool | Details |
|-------|------|------|---------|
| Exported | 2024-01-15 | Stitch | Full prompt generated |
| Realized | 2024-01-15 | Stitch | First generation |
| Iteration | 2024-01-16 | Stitch | Adjusted button sizing |
| Approved | 2024-01-16 | - | Design approved |
| Implemented | 2024-01-18 | Code | `src/app/login/page.tsx` |
| Verified | 2024-01-19 | QA | Matches spec ✓ |

**External Links:**
- Stitch: [Link to Stitch project]
- Figma: [Link to Figma frame]
- Code: `src/app/login/page.tsx`

**Notes:**
- Initial generation needed button size adjustment
- Social login icons required manual addition
- Dark mode verified working

---

### SCR-02: Signup

| Event | Date | Tool | Details |
|-------|------|------|---------|
| Exported | 2024-01-15 | Stitch | Full prompt generated |
| Realized | 2024-01-16 | Stitch | First generation |
| Implemented | - | - | In progress |

**External Links:**
- Stitch: [Link]
- Code: `src/app/signup/page.tsx` (WIP)

**Notes:**
- Reused PAT-01 Auth Form Layout from Login
- Password strength indicator needed custom implementation

---

### SCR-03: Dashboard

| Event | Date | Tool | Details |
|-------|------|------|---------|
| Exported | 2024-01-17 | Stitch | Full prompt generated |
| Realized | 2024-01-17 | Stitch | First generation |
| Iteration | 2024-01-18 | Stitch | Chart styling adjusted |

**External Links:**
- Stitch: [Link]

**Notes:**
- Complex layout required multiple generations
- Charts need custom implementation (not from Stitch)
- Empty state designed separately

---

## Implementation Tracking

### Implemented Screens

| Screen | File | Components | Tests | A11y |
|--------|------|------------|-------|------|
| Login | `src/app/login/page.tsx` | 8 | ✅ | ✅ |

### Pending Implementation

| Screen | Blocker | Assigned | ETA |
|--------|---------|----------|-----|
| Signup | None | - | - |
| Dashboard | Chart library decision | - | - |
| Settings | Form library setup | - | - |

---

## Drift Detection

Track divergence between spec and implementation.

### Active Drift

| Screen | Element | Spec Says | Actual | Severity | Action |
|--------|---------|-----------|--------|----------|--------|
| SCR-01 | Button | primary, lg | primary, md | Low | Update spec |
| SCR-03 | Sidebar | 280px | 256px | Low | Update code |

### Resolved Drift

| Screen | Element | Resolution | Date |
|--------|---------|------------|------|
| SCR-01 | Colors | Updated tokens to match impl | 2024-01-20 |

---

## Export Versions

Track which spec version was exported.

| Screen | Spec Version | Export Version | Fresh? |
|--------|--------------|----------------|--------|
| SCR-01 | v1.2 | v1.2 | ✅ Yes |
| SCR-02 | v1.1 | v1.0 | ⚠️ Stale |
| SCR-03 | v2.0 | v1.5 | ⚠️ Stale |
| SCR-04 | v1.0 | v1.0 | ✅ Yes |

**Action Items:**
- [ ] Re-export SCR-02 (spec updated since export)
- [ ] Re-export SCR-03 (major spec changes)

---

## Quality Checklist

### Pre-Realization Checklist

- [ ] Full 10-section spec complete
- [ ] All components exist in COMPONENTS.md
- [ ] Tokens referenced (not hardcoded values)
- [ ] Responsive behavior documented
- [ ] Accessibility requirements noted
- [ ] Content/copy finalized

### Pre-Implementation Checklist

- [ ] Design approved (visual matches intent)
- [ ] Components available in codebase
- [ ] Routes/navigation configured
- [ ] API endpoints available
- [ ] Error states designed

### Post-Implementation Checklist

- [ ] Matches approved design
- [ ] All states implemented (loading, error, empty)
- [ ] Responsive behavior working
- [ ] Keyboard navigation working
- [ ] Screen reader tested
- [ ] Performance acceptable

---

## Maintenance Schedule

| Task | Frequency | Last Run | Next Due |
|------|-----------|----------|----------|
| Drift check | Weekly | 2024-01-20 | 2024-01-27 |
| Export freshness | On spec change | 2024-01-18 | As needed |
| A11y audit | Monthly | 2024-01-01 | 2024-02-01 |
| Performance check | Monthly | 2024-01-01 | 2024-02-01 |

---

## Notes

### Conventions

- Screen IDs: `SCR-XX` (two digits, zero-padded)
- Version format: `vX.Y` (major.minor)
- Dates: `YYYY-MM-DD` format

### External Tool Access

| Tool | Access | Owner |
|------|--------|-------|
| Stitch | [Link/Account] | [Person] |
| Figma | [Link/Account] | [Person] |
| V0 | [Link/Account] | [Person] |

---

*Updated by /ui:realize and /ui:sync | Last sync: YYYY-MM-DD*
```

</template>

---

<guidelines>

## Purpose

The UI Registry provides:
1. **Pipeline visibility** — See where each screen is in the workflow
2. **Realization tracking** — Document external tool work
3. **Implementation tracking** — Know what's built
4. **Drift detection** — Catch spec/implementation divergence
5. **Quality assurance** — Checklists for consistency

## Workflow

```
Specify → Export → Realize → Implement → Verify
   │         │        │          │          │
   │         │        │          │          └── QA matches spec
   │         │        │          └── Code in codebase
   │         │        └── Visual design in external tool
   │         └── Prompts generated
   └── 10-section spec complete
```

## When to Update

| Event | Update |
|-------|--------|
| Screen specified | Add to registry, mark Specified |
| Prompt exported | Mark Exported, note tool |
| Design generated | Add realization log entry |
| Design iterated | Add iteration log entry |
| Code implemented | Mark Implemented, add file path |
| QA completed | Mark Verified |
| Drift detected | Add to drift section |
| Drift resolved | Move to resolved |

## Best Practices

1. **Update immediately** — Don't batch updates
2. **Link everything** — File paths, external URLs
3. **Note blockers** — Track what's preventing progress
4. **Version specs** — Know which version was exported
5. **Check freshness** — Re-export when specs change

</guidelines>
