# UI Design System Templates

> Templates for the UI Design System for Claude Code.
> Version: 0.2.0

This folder contains templates for all UI specification documents created by the `/ui:*` commands.

---

## Template Index

| Template | Output File | Created By | Purpose |
|----------|-------------|------------|---------|
| `ui-spec.md` | `.harn/design/UI-SPEC.md` | `/ui:design-screens` | Master specification hub |
| `ui-context.md` | `.harn/design/UI-CONTEXT.md` | `/ui:init` | Platform and constraints |
| `screen.md` | `.harn/design/screens/SCR-XX-*.md` | `/ui:design-screens` | Individual screen specs |
| `component.md` | `.harn/design/COMPONENTS.md` | `/ui:define-components` | Component inventory |
| `ui-patterns.md` | `.harn/design/UI-PATTERNS.md` | `/ui:patterns` | Reusable UI patterns |
| `ui-decisions.md` | `.harn/design/UI-DECISIONS.md` | `/ui:decisions` | Design decision log |
| `ui-registry.md` | `.harn/design/UI-REGISTRY.md` | `/ui:realize` | Realization tracking |
| `design-tokens.json` | `.harn/design/design-tokens.json` | `/ui:setup-tokens` | Design tokens (W3C) |

---

## Template Overview

### Core Documents

#### UI-SPEC.md
The master specification document that ties everything together. Contains:
- Overview and key metrics
- Design system references
- Screen inventory with status
- Navigation architecture
- Component summary
- Export and realization tracking

#### UI-CONTEXT.md
Captures the project context before design begins:
- Platform and browser support
- Technical and design constraints
- Inspiration and visual direction
- User context and personas
- Integration points

#### Screen Specs (SCR-XX-*.md)
Individual screen specifications using the 10-section format:
1. Meta (ID, route, requirements)
2. Purpose
3. Wireframe (ASCII)
4. Layout Structure
5. Components
6. States
7. Interactions
8. Responsive Behavior
9. Accessibility
10. Content

#### COMPONENTS.md
Component inventory with specifications:
- Component list by category
- Props, variants, sizes
- ASCII state visualizations
- Accessibility requirements
- Token references
- Usage examples

### Supporting Documents

#### UI-PATTERNS.md
Reusable UI patterns that combine components:
- Pattern index
- ASCII wireframes
- Component composition
- Responsive behavior
- Variants

#### UI-DECISIONS.md
Design decision log:
- Context and options considered
- Decision and rationale
- Consequences
- Status tracking

#### UI-REGISTRY.md
Realization and implementation tracking:
- Pipeline status per screen
- Realization log (external tool work)
- Implementation tracking
- Drift detection
- Quality checklists

#### design-tokens.json
Design tokens in W3C format:
- Colors (with dark mode via `$extensions.mode`)
- Typography
- Spacing
- Border radius
- Shadows
- Z-index
- Transitions
- Opacity

---

## File Structure

When templates are used, they create this structure:

```
.harn/design/
├── UI-SPEC.md              ← Master specification
├── UI-CONTEXT.md           ← Platform and constraints
├── UI-PATTERNS.md          ← Reusable patterns
├── UI-DECISIONS.md         ← Decision log
├── UI-REGISTRY.md          ← Realization tracking
├── COMPONENTS.md           ← Component inventory
├── design-tokens.json      ← Design tokens (W3C)
├── screens/
│   ├── SCR-01-login.md     ← Individual screen specs
│   ├── SCR-02-signup.md
│   ├── SCR-03-dashboard.md
│   └── ...
├── ui-exports/
│   ├── stitch-prompts.md   ← Service-specific exports
│   ├── v0-prompts.md
│   ├── figma-tokens.json
│   └── generic-prompts.md
└── ui-state/
    └── coordinator-state.json  ← Internal state tracking
```

---

## ASCII Diagram Characters

Templates use ASCII art for wireframes and visualizations. Standard characters:

```
Box Drawing
───────────
┌ ┐ └ ┘   Corners
│ ─       Lines (vertical, horizontal)
├ ┤ ┬ ┴   T-junctions
┼         Cross
═ ║       Double lines (emphasis)

UI Elements
───────────
[ ]       Buttons, clickable elements
< >       Dropdowns, selects
○ ●       Radio buttons (unselected, selected)
□ ■       Checkboxes (unchecked, checked)
⋮ ⋯       Overflow menus (vertical, horizontal)

Status Indicators
─────────────────
✓ ✗       Check, X
● ○       Filled, empty (progress)
▶ ▼ ◀ ▲   Arrows/direction
░ ▒ ▓ █   Progress bars/fills

Spacing
───────
...       Variable content
[ ... ]   Expandable section
─ ─ ─     Dashed line (optional/disabled)
```

---

## Customization

Templates can be customized per project:

1. **Copy template to `.harn/design/` during setup
2. **Modify sections** as needed for project
3. **Preserve structure** for command compatibility

Commands will use local templates if present, falling back to these defaults.

---

## Version History

| Version | Changes |
|---------|---------|
| 0.2.0 | Added UI-CONTEXT, UI-PATTERNS, UI-DECISIONS, UI-REGISTRY templates. Enhanced screen.md with 10-section format. Added dark mode to design-tokens.json. Added ASCII visualizations to component.md. |
| 0.1.0 | Initial templates: UI-SPEC, screen, component, design-tokens |

---

## Related

- `/ui:help` — Show all available commands
- `/ui:whats-new` — See version history
- `./.claude/ui-design/README.md` — Full documentation

---

*UI Design System for Claude Code v0.2.0*
