# Adapters Overview

This directory contains export adapters for different design tools. Each adapter transforms UI specifications into tool-specific prompts or formats.

## Adapter Comparison

| Feature | Stitch | V0 | Figma | Pencil | DESIGN.md | Generic |
|---------|--------|-----|-------|--------|-----------|---------|
| **Output** | Visual designs | React code | Design files | .pen files | Single .md file (9 sections) | Universal prompts |
| **Primary Use** | Quick mockups | Production code | Full design work | Direct execution | Agent-consumable visual contract | Unknown tools |
| **Best For** | Visual exploration | React/Next.js apps | Team collaboration | Rapid prototyping | Feeding other AI agents; brand onboarding | Future-proofing |
| **Code Output** | HTML/CSS/Flutter | React + Tailwind | CSS snippets | N/A (design) | None (documentation) | None |
| **Token Import** | Manual (hex values) | Via Tailwind config | Native Variables | Direct (set_variables) | Bidirectional (import-design-md) | Manual (hex values) |
| **Iteration** | Re-prompt | Built-in UI | Full control | Update operations | Edit sources + re-export | Re-prompt |
| **Collaboration** | Solo | Solo | Excellent | Solo | Publishable (Git-tracked) | Solo |
| **Prototyping** | N/A | React state | Excellent | Static designs | N/A (system-level only) | N/A |
| **Execution** | Manual | Manual | Manual | **Automatic** | Derived artifact | Manual |

## Capability Matrix

| Capability | Stitch | V0 | Figma | Pencil | DESIGN.md | Generic |
|------------|--------|-----|-------|--------|-----------|---------|
| Full screens | ✅ Excellent | ✅ Good | ✅ Excellent | ✅ Excellent | ❌ No (system only) | ✅ Works |
| Components | ⚠️ Limited | ✅ Excellent | ✅ Excellent | ✅ Excellent | ✅ Good (prose) | ✅ Works |
| Responsive | ✅ Good | ✅ Excellent | ✅ Excellent | ✅ Good | ✅ Good | ✅ Works |
| Dark mode | ✅ Good | ✅ Excellent | ✅ Excellent | ✅ Excellent | ✅ Good (parallel palette) | ✅ Works |
| Animations | ⚠️ Limited | ✅ Good | ✅ Good | ⚠️ Limited | ❌ No | ⚠️ Variable |
| Production code | ⚠️ Basic | ✅ Excellent | ⚠️ Dev Mode | ❌ N/A | ❌ No | ⚠️ Variable |
| TypeScript | ❌ No | ✅ Excellent | ❌ N/A | ❌ N/A | ❌ N/A | ❌ N/A |
| Design handoff | ⚠️ Via Figma | Direct code | ✅ Excellent | ✅ Screenshots | ✅ Excellent (agent-readable) | ⚠️ Manual |
| Visual validation | ❌ Manual | ❌ Manual | ✅ Good | ✅ Excellent | ❌ Manual | ❌ Manual |
| Design systems | ⚠️ Limited | ✅ shadcn | ✅ Excellent | ✅ Excellent | ✅ Excellent (canonical spec) | ⚠️ Variable |
| Bidirectional sync | ❌ No | ❌ No | ⚠️ Partial | ❌ No | ✅ Excellent (export + import) | ❌ No |

## When to Use Each Adapter

### Stitch
```
Use when:
- Early visual exploration
- Need quick mockups for feedback
- Non-React projects
- Want Figma-exportable designs
- Marketing/landing pages
- Client presentations

Skip when:
- Need production code
- Complex interactions
- Detailed component systems
```

### V0
```
Use when:
- Building React/Next.js apps
- Need TypeScript code
- Want shadcn/ui components
- Need form validation
- Building data tables
- Component-level generation

Skip when:
- Not using React
- Need design files
- Team design review needed
- Visual exploration phase
```

### Figma
```
Use when:
- Full design system work
- Team collaboration needed
- Detailed visual refinement
- Interactive prototypes
- Design-to-dev handoff
- Client presentations

Skip when:
- Solo developer project
- Simple screens
- Time-constrained
- React implementation priority
```

### Pencil
```
Use when:
- Want direct execution (no copy/paste)
- Need visual validation via screenshots
- Building component libraries
- Rapid prototyping with immediate feedback
- Design token synchronization needed
- Iterative refinement with precise control

Skip when:
- Need production code (use V0)
- Team collaboration required (use Figma)
- Non-technical stakeholder review (use Stitch)
- Don't have Pencil MCP server
```

### DESIGN.md (VoltAgent format)
```
Use when:
- Feeding other AI agents (Claude Code, Cursor, Windsurf) a compact visual contract
- Onboarding a project from an existing brand (Stripe, Linear, Claude, etc. via VoltAgent catalog)
- Publishing a visual spec alongside README.md / AGENTS.md / CLAUDE.md
- Documenting the design system for non-designers or external contributors
- Wanting bidirectional sync (export from specs; import from an existing DESIGN.md)

Skip when:
- Need per-screen detail (DESIGN.md is system-level only — use V0/Stitch/Figma for screens)
- Need executable code or interactive prototype
- Project has no tokens / COMPONENTS.md / UI-CONTEXT.md populated yet
  (output will be mostly "*Not yet defined*" placeholders)
```

### Generic
```
Use when:
- Tool not supported
- Testing new AI tools
- Tool-agnostic docs needed
- Fallback when others fail
- Documentation purposes

Skip when:
- Using supported tool
- Need optimized output
- Tool-specific features needed
```

## Typical Workflows

### Solo Developer (React)
```
Spec → V0 → Codebase
```

### Solo Developer (Non-React)
```
Spec → Stitch → Export → Implement
```

### With Design Team
```
Spec → Figma → Refine → V0 → Codebase
```

### Visual Exploration First
```
Spec → Stitch → Figma → Refine → V0 → Codebase
```

### Rapid Prototyping (Direct Execution)
```
Spec → Pencil → Validate (screenshot) → Iterate → V0 → Codebase
```

### Design System Development
```
Spec → Pencil (components) → Pencil (screens) → Screenshot validation → Export
```

### Brand Onboarding (Import-first)
```
/ui:import-design-md voltagent:<brand> → populates tokens + COMPONENTS.md + UI-CONTEXT.md
→ /ui:design-screens → /ui:export [service]
```

### Publish Visual Contract (Export-first)
```
Spec (tokens + components + context + patterns) → /ui:export design-md
→ .harn/design/ui-exports/DESIGN.md → move to project root → commit
→ other agents (Claude Code, Cursor) consume it as visual contract
```

### Unknown Tool
```
Spec → Generic → Adapt → Tool → Export
```

## Common Features Across All Adapters

Each adapter includes:

1. **Capability Matrix** — What the tool can/cannot do
2. **Prompt Structure** — Basic and extended templates
3. **Transformation Rules** — Spec → prompt conversion
4. **Token Mapping** — Design tokens → tool format
5. **Component Descriptions** — Universal → tool-specific
6. **Iteration Guidance** — How to refine results
7. **Example Transformation** — Concrete before/after
8. **Reverse Sync** — Importing designs back
9. **Handoff Document** — Team communication
10. **Best Practices** — Dos and don'ts

## Adding New Adapters

To add support for a new design tool:

1. Create `[tool-name].md` in this directory
2. Follow the adapter template structure:
   - `<adapter_info>` — Service metadata
   - `<capability_matrix>` — Feature support
   - `<prompt_structure>` — Output templates
   - `<transformation_rules>` — Conversion logic
   - `<token_mapping>` — Token translation
   - `<component_descriptions>` — Component mapping
   - `<iteration_guidance>` — Refinement patterns
   - `<example_transformation>` — Before/after
   - `<reverse_sync>` — Import guidance
   - `<handoff_document>` — Handoff template
   - `<best_practices>` — Guidance

3. Update this README with comparison
4. Test with sample specifications

## Input/Output

### Input (From Specifications)

Adapters consume:
- Screen specs from `ui-design/templates/screen.md` (10-section format)
- Component specs from `ui-design/templates/component.md`
- Design tokens from `ui-design/templates/design-tokens.json`
- Context from `ui-design/templates/ui-context.md`
- Patterns from `ui-design/templates/ui-patterns.md`

### Output (To External Tools)

```
.harn/design/ui-exports/
├── stitch-prompts.md      # Stitch-optimized prompts
├── v0-prompts.md          # V0-optimized prompts
├── figma-tokens.json      # Figma Variables export
├── figma-setup.md         # Figma setup instructions
├── pencil-operations.md   # Pencil batch_design operations log
├── pencil-handoff.md      # Pencil handoff documentation
├── DESIGN.md              # VoltAgent-format visual contract (9 sections)
├── generic-prompts.md     # Tool-agnostic prompts
└── handoffs/
    ├── SCR-01-brief.md    # Per-screen design briefs
    ├── SCR-01-pencil.md   # Per-screen Pencil handoff
    └── design-handoff.md  # Full project handoff
```

## Dark Mode Support

All adapters support dark mode via design tokens:

```json
{
  "color": {
    "background": {
      "default": {
        "$value": "#FFFFFF",
        "$extensions": {
          "mode": { "dark": "#0F172A" }
        }
      }
    }
  }
}
```

### Adapter-Specific Dark Mode Handling

| Adapter | Dark Mode Approach |
|---------|-------------------|
| Stitch | Request explicit dark mode variant in prompt |
| V0 | Uses Tailwind `dark:` classes, respects CSS variables |
| Figma | Uses Variable modes (Light/Dark) |
| Pencil | Native variables with `$extensions.mode` |
| DESIGN.md | Parallel palette table under §2 (same section, second table) — never a separate section or file |
| Generic | Describe both modes in visual language |

## Version History

- **0.7.0** — DESIGN.md adapter (VoltAgent/awesome-design-md)
  - New adapter for single-file visual contract documentation
  - Bidirectional: `/ui:export design-md` (specs → DESIGN.md) and `/ui:import-design-md` (DESIGN.md → specs)
  - 9 canonical sections (Visual Theme, Color, Typography, Components, Layout, Elevation, Do's/Don'ts, Responsive, Agent Prompt Guide)
  - VoltAgent catalog shortcut: `/ui:import-design-md voltagent:<brand>`
  - Auto-detection in `/ui:init` at `./DESIGN.md`, `./docs/DESIGN.md`, `./design/DESIGN.md`, `./.harn/design/DESIGN.md`

- **0.4.0** — Pencil MCP adapter
  - New Pencil adapter for direct design execution
  - Operations-based output (not prompts)
  - Native screenshot validation
  - Design system component support
  - Variable/theme synchronization

- **0.2.0** — Enhanced adapters
  - Dark mode support via token `$extensions.mode`
  - 10-section screen format compatibility
  - Template integration
  - Improved iteration guidance
  - Registry tracking updates

- **0.1.0** — Initial adapters: Stitch, V0, Figma, Generic
