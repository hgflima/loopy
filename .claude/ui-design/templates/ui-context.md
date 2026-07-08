# UI-CONTEXT.md Template

Template for `.harn/design/UI-CONTEXT.md` — captures platform constraints, project context, and design inspiration.

---

<template>

```markdown
# UI Context: [Project Name]

> Platform, constraints, and design direction for the [Project Name] interface.
> Created: YYYY-MM-DD | Last Updated: YYYY-MM-DD

---

## Platform

### Target Environment

| Aspect | Value | Notes |
|--------|-------|-------|
| Platform | [Web \| iOS \| Android \| Desktop \| Cross-platform] | - |
| Framework | [Next.js \| React \| Vue \| etc.] | Version X.X |
| Rendering | [SSR \| CSR \| Static \| Hybrid] | - |
| Deployment | [Vercel \| AWS \| Self-hosted] | - |

### Browser/Device Support

```
┌────────────────────────────────────────────────────────────┐
│  Browser Support Matrix                                    │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Chrome      ████████████████  Latest 2 versions          │
│  Firefox     ████████████████  Latest 2 versions          │
│  Safari      ████████████████  Latest 2 versions          │
│  Edge        ████████████████  Latest 2 versions          │
│  Safari iOS  ████████████████  iOS 14+                    │
│  Chrome And. ████████████████  Android 10+                │
│                                                            │
│  IE 11       ░░░░░░░░░░░░░░░░  Not supported              │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

| Target | Min Version | Market Share |
|--------|-------------|--------------|
| Chrome | 90+ | ~65% |
| Safari | 14+ | ~18% |
| Firefox | 88+ | ~8% |
| Edge | 90+ | ~5% |
| Mobile Safari | iOS 14+ | ~25% mobile |
| Chrome Android | 90+ | ~60% mobile |

### Viewport Requirements

```
┌────────────────────────────────────────────────────────────┐
│  Breakpoint System                                         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Mobile        Tablet          Desktop         Wide        │
│  320-639px     640-1023px      1024-1279px    1280px+     │
│                                                            │
│  ┌─────┐      ┌─────────┐     ┌───────────┐  ┌──────────┐│
│  │     │      │         │     │           │  │          ││
│  │     │      │         │     │           │  │          ││
│  │     │      │         │     │           │  │          ││
│  └─────┘      └─────────┘     └───────────┘  └──────────┘│
│                                                            │
│  Touch-first  Touch+Mouse     Mouse+KB       Mouse+KB     │
│  1 column     2 columns       3 columns      4+ columns   │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

| Breakpoint | Min Width | Max Width | Primary Input |
|------------|-----------|-----------|---------------|
| xs (mobile) | 320px | 639px | Touch |
| sm (tablet) | 640px | 1023px | Touch/Mouse |
| md (desktop) | 1024px | 1279px | Mouse/Keyboard |
| lg (wide) | 1280px | 1535px | Mouse/Keyboard |
| xl (ultra) | 1536px | ∞ | Mouse/Keyboard |

---

## Constraints

### Technical Constraints

| Constraint | Requirement | Impact |
|------------|-------------|--------|
| Bundle size | < 200KB initial JS | Lazy load routes |
| LCP | < 2.5s | Optimize images, critical CSS |
| CLS | < 0.1 | Reserve space for async content |
| FID | < 100ms | Minimize main thread work |
| Offline | [Yes \| No \| Partial] | Service worker strategy |

### Design Constraints

| Constraint | Requirement | Notes |
|------------|-------------|-------|
| Accessibility | WCAG 2.1 AA | Required for compliance |
| Dark mode | [Required \| Optional \| None] | System preference detection |
| RTL support | [Yes \| No] | Arabic/Hebrew locales |
| Animation | Respect prefers-reduced-motion | Required |
| Touch targets | Min 44x44px | Mobile accessibility |

### Brand Constraints

| Aspect | Constraint | Source |
|--------|------------|--------|
| Logo | SVG only, min 24px height | Brand guidelines |
| Colors | Use brand palette only | Brand guidelines |
| Typography | [Font family] or system | Brand/Performance |
| Imagery | [Photo style, illustrations] | Brand guidelines |

### Content Constraints

| Content | Constraint |
|---------|------------|
| Headlines | Max 60 characters |
| Body text | Max 80 characters per line |
| Button text | Max 25 characters |
| Form labels | Max 30 characters |

---

## Inspiration

### Design References

List of design inspiration sources with notes on what to reference.

#### Reference 1: [Name/Source]

```
┌─────────────────────────────────────────────────────────────┐
│  What to Reference                                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ✓ Navigation pattern — Clean top nav with dropdown         │
│  ✓ Card design — Subtle shadows, rounded corners            │
│  ✓ Color usage — Muted backgrounds, vibrant CTAs            │
│  ✗ Typography — Too decorative for our use case            │
│                                                             │
│  URL: [link]                                                │
│  Screenshot: [path or description]                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Reference 2: [Name/Source]

```
┌─────────────────────────────────────────────────────────────┐
│  What to Reference                                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ✓ Dashboard layout — Clear hierarchy, good data viz        │
│  ✓ Empty states — Friendly illustrations                    │
│  ✓ Loading states — Skeleton screens                        │
│  ✗ Dense information — Too compact for mobile               │
│                                                             │
│  URL: [link]                                                │
│  Screenshot: [path or description]                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Pattern Inspiration

| Pattern | Source | Notes |
|---------|--------|-------|
| Auth flow | [Stripe] | Clean, minimal, trustworthy |
| Dashboard | [Linear] | Fast, keyboard-first |
| Settings | [GitHub] | Organized sections |
| Forms | [Typeform] | Progressive disclosure |
| Onboarding | [Notion] | Step-by-step, friendly |

### Visual Direction

```
┌─────────────────────────────────────────────────────────────┐
│  Visual Direction Summary                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Mood:        Professional, Modern, Approachable            │
│                                                             │
│  Keywords:    Clean • Minimal • Trustworthy • Fast          │
│                                                             │
│  Avoid:       Cluttered • Playful • Dark patterns           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Color Mood                                           │   │
│  │                                                      │   │
│  │ ████  ████  ████  ████  ████                        │   │
│  │ Cool  Neutral     Accent      Success  Error        │   │
│  │ blues  grays      purple      green    red          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Typography: Sans-serif, clean, readable                    │
│  Spacing: Generous whitespace, clear hierarchy              │
│  Borders: Subtle, rounded (8px default)                     │
│  Shadows: Minimal, elevation for focus                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## User Context

### Primary Users

| Persona | Description | Key Needs |
|---------|-------------|-----------|
| [Persona 1] | [Brief description] | [Key UI needs] |
| [Persona 2] | [Brief description] | [Key UI needs] |

### User Technical Context

| Factor | Assumption | Impact |
|--------|------------|--------|
| Connection | Mix of fast/slow | Progressive loading |
| Device age | 2-5 years old | Performance budget |
| Screen size | Varies widely | Responsive-first |
| Tech savvy | [Low \| Medium \| High] | UI complexity |
| Accessibility needs | ~15% users | Full a11y support |

### Usage Context

| Context | Consideration |
|---------|---------------|
| Environment | [Office, mobile, outdoor] |
| Attention | [Focused, distracted, multitasking] |
| Session length | [Brief, extended] |
| Frequency | [Daily, weekly, occasional] |

---

## Integration Points

### Existing Systems

| System | Integration | UI Impact |
|--------|-------------|-----------|
| Auth provider | [Clerk \| Auth0 \| Custom] | Login UI, session |
| Payment | [Stripe \| None] | Checkout flow |
| Analytics | [Posthog \| Mixpanel] | Event tracking |
| Error tracking | [Sentry \| None] | Error UI |

### API Considerations

| API | Latency | UI Impact |
|-----|---------|-----------|
| Primary API | ~200ms | Loading states |
| Search | ~500ms | Debounce, skeleton |
| File upload | Variable | Progress indicator |
| Real-time | WebSocket | Live updates |

---

## Notes

### Decisions Made

| Decision | Rationale | Date |
|----------|-----------|------|
| [Decision] | [Why] | YYYY-MM-DD |

### Open Questions

- [ ] [Question 1]
- [ ] [Question 2]

### Assumptions

- [Assumption 1]
- [Assumption 2]

---

*Generated by /ui:init | Last updated: YYYY-MM-DD*
```

</template>

---

<guidelines>

## Section Purpose

| Section | Purpose |
|---------|---------|
| Platform | Define technical environment and support requirements |
| Constraints | Document limitations that affect design decisions |
| Inspiration | Capture visual direction and reference materials |
| User Context | Understand who uses the UI and how |
| Integration | Note external systems that affect UI |

## Best Practices

1. **Be specific** — Vague constraints lead to vague designs
2. **Cite sources** — Link to inspiration, guidelines, requirements
3. **Update regularly** — Context changes; keep this current
4. **Share visually** — ASCII diagrams help communicate quickly
5. **Note rationale** — Document why constraints exist

## When to Update

- Project kickoff (initial creation)
- New platform support added
- Constraint changes (budget, timeline, scope)
- New inspiration discovered
- User research completed
- Integration added/changed

</guidelines>
