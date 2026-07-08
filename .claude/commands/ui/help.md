---
name: ui:help
description: Show available UI Design System commands and usage guide
allowed-tools: []
---

<objective>
Display all available UI Design System commands with descriptions, usage examples, and workflow guidance.
</objective>

<process>

Display the following help information:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI Design System for Claude Code
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INITIALIZATION
─────────────────────────────────────────────────────

  /ui:init              Initialize UI context for project
                        Discovers platform, framework, inspiration
                        Creates: UI-CONTEXT.md, state files

  /ui:setup-tokens      Set up design token system
                        Define colors, typography, spacing
                        Creates: design-tokens.json

SPECIFICATION
─────────────────────────────────────────────────────

  /ui:design-screens    Create screen specifications
                        10-section format with wireframes
                        Creates: UI-SPEC.md, screens/*.md

  /ui:define-components Extract component inventory
                        Props, variants, states, accessibility
                        Creates: COMPONENTS.md

  /ui:patterns          Document reusable UI patterns
                        Add, view, or auto-extract patterns
                        Creates: UI-PATTERNS.md

EXPORT
─────────────────────────────────────────────────────

  /ui:export [service]  Generate service-specific prompts
                        Services: stitch, v0, figma, pencil, design-md, generic
                        Creates: ui-exports/*.md (DESIGN.md for design-md)

                        Examples:
                        /ui:export stitch
                        /ui:export v0 SCR-01
                        /ui:export figma
                        /ui:export pencil
                        /ui:export design-md        VoltAgent DESIGN.md format

PENCIL DESIGN (Interactive)
─────────────────────────────────────────────────────

  /ui:pencil [action]   Interactive design workflow with Pencil MCP
                        Direct execution, visual validation, bidirectional sync

                        Subcommands:
                        /ui:pencil open [file]      Open or create .pen file
                        /ui:pencil sync --push      Specs → Pencil
                        /ui:pencil sync --pull      Pencil → Specs
                        /ui:pencil sync --diff      Compare without changing
                        /ui:pencil components       Manage design system
                        /ui:pencil validate SCR-01  Visual validation
                        /ui:pencil iterate SCR-01   Interactive refinement
                        /ui:pencil style --explore  Style guide exploration
                        /ui:pencil layout           Debug layout issues

                        Guide: ./.claude/ui-design/references/pencil-guide.md

CODE-TO-DESIGN (Reverse Engineering)
─────────────────────────────────────────────────────

  /ui:scan              Analyze existing codebase for UI patterns
                        Discovers components, screens, tokens
                        Creates: CODE-ANALYSIS.md

  /ui:generate-specs    Generate specs from code analysis
                        Auto-creates screen and component specs
                        Creates: screens/*.md, COMPONENTS.md

  /ui:reverse-engineer  One-shot: scan + generate + export
                        Full reverse engineering workflow

BRANDING
─────────────────────────────────────────────────────

  /ui:logo              Create logo and favicon specifications
                        Guided questions, AI image prompts
                        Creates: LOGO-SPEC.md, logo-prompts.md

                        Options:
                        /ui:logo --refresh
                        /ui:logo --favicon-only
                        /ui:logo --export midjourney

IMPORT
─────────────────────────────────────────────────────

  /ui:import-tokens     Import tokens from external sources
                        Supports: Figma, Tailwind, W3C, etc.
                        Updates: design-tokens.json

  /ui:import-design     Import design from external tools
                        Reverse sync, drift detection
                        Updates: screen specs, patterns

  /ui:import-design-md  Import DESIGN.md (VoltAgent format)
                        Sources: voltagent:<name>, HTTPS URL, local path
                        Populates tokens, context, components, patterns

                        Examples:
                        /ui:import-design-md voltagent:claude
                        /ui:import-design-md https://example.com/DESIGN.md
                        /ui:import-design-md ./DESIGN.md

TRACKING
─────────────────────────────────────────────────────

  /ui:realize [screen]  Mark screens as realized
                        Track implementation status
                        Updates: UI-REGISTRY.md

                        Examples:
                        /ui:realize SCR-01
                        /ui:realize SCR-01,SCR-02

  /ui:sync              Detect and fix drift
                        Token, component, export consistency
                        Auto-fix or generate recommendations

STATUS & INFO
─────────────────────────────────────────────────────

  /ui:status            Show specification coverage
                        Screens, components, exports, progress

  /ui:decisions         View design decision log
                        Add, view, filter decisions

                        Examples:
                        /ui:decisions
                        /ui:decisions add
                        /ui:decisions DEC-005

  /ui:whats-new         Show version history and changes

  /ui:help              Show this help message

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TYPICAL WORKFLOWS
─────────────────────────────────────────────────────

## Starting Fresh

  1. /ui:init               Set up context
  2. /ui:setup-tokens       Define design system
  3. /ui:design-screens     Specify all screens
  4. /ui:define-components  Extract components
  5. /ui:export stitch      Generate prompts
  6. [Use external tool]    Create designs
  7. /ui:realize            Track completion

## Quick Export Flow

  /ui:export stitch         Export to Stitch
  [Generate in Stitch]
  /ui:import-design         Capture changes
  /ui:realize SCR-01        Mark as done

## Pencil Interactive Flow

  /ui:pencil open --new     Create design file
  /ui:pencil style          Pick a style guide
  /ui:pencil sync --push    Push specs to Pencil
  /ui:pencil iterate SCR-01 Refine interactively
  /ui:pencil validate all   Validate against specs
  /ui:export v0             Export to code

## Reverse Engineering Flow

  /ui:scan                  Analyze existing code
  /ui:generate-specs        Create specs from code
  /ui:pencil sync --push    Visualize in Pencil
  /ui:pencil iterate        Refine designs

## DESIGN.md Flow (VoltAgent)

  /ui:import-design-md voltagent:claude   Import curated catalog entry
  [Review tokens/context/patterns populated]
  /ui:design-screens                      Specify screens using imported system
  /ui:export design-md                    Export back to DESIGN.md artifact

## Maintenance

  /ui:sync                  Check for drift
  /ui:decisions add         Document choice
  /ui:patterns extract      Find new patterns

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ARTIFACTS CREATED
─────────────────────────────────────────────────────

  .harn/design/
  ├── UI-CONTEXT.md           Platform and constraints
  ├── UI-SPEC.md              Master specification
  ├── UI-DECISIONS.md         Decision log
  ├── UI-PATTERNS.md          Pattern library
  ├── UI-REGISTRY.md          Realization tracking
  ├── COMPONENTS.md           Component inventory
  ├── LOGO-SPEC.md            Logo and branding specs
  ├── CODE-ANALYSIS.md        Reverse engineering results
  ├── design-tokens.json      Design tokens (W3C)
  ├── screens/
  │   ├── SCR-01-login.md     Individual screen specs
  │   ├── SCR-02-signup.md
  │   └── ...
  ├── ui-exports/
  │   ├── stitch-prompts.md   Stitch-optimized prompts
  │   ├── v0-prompts.md       V0-optimized prompts
  │   ├── figma-tokens.json   Figma Variables export
  │   ├── pencil-operations.md  Pencil operations log
  │   ├── DESIGN.md           VoltAgent DESIGN.md (9 sections)
  │   ├── generic-prompts.md  Tool-agnostic prompts
  │   └── handoffs/           Design handoff docs
  ├── ui-state/
  │   ├── coordinator-state.json
  │   └── pencil-state.json   Pencil session state
  └── pencil/
      └── *.pen               Pencil design files

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SUPPORTED SERVICES
─────────────────────────────────────────────────────

  Stitch      Visual design generation (Google)
              Best for: High-fidelity mockups

  V0          React component generation (Vercel)
              Best for: Code implementation

  Figma       Design tool integration
              Best for: Designer handoff

  Pencil      Direct design via MCP (Interactive)
              Best for: Rapid prototyping, iteration
              Unique: Executes directly, visual validation

  DESIGN.md   VoltAgent DESIGN.md format (Markdown)
              Best for: Living visual documentation, LLM-readable spec
              Bidirectional: export from specs, import from catalog/URL/path

  Generic     Tool-agnostic prompts
              Best for: Any AI design tool

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MULTI-AGENT SYSTEM
─────────────────────────────────────────────────────

The system uses specialized agents:

  UI Designer     Coordinator, routes tasks
  UI Researcher   Context, inspiration, analysis
  UI Specifier    Screens, components, patterns
  UI Prompter     Exports, prompts, handoffs
  UI Brander      Logo and brand identity
  UI Scanner      Code analysis, reverse engineering

Agents are spawned automatically based on task complexity.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

More Info:
  /ui:whats-new             Version history
  ./.claude/ui-design/      Full documentation

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

</process>
