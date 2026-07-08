---
name: ui:reverse-engineer
description: One-shot workflow - scan codebase, generate specs, and export (minimal intervention)
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, Task]
agent: ui-scanner
---

<objective>
Complete code-to-design workflow in one command. Scans the codebase, generates specs, and prepares export — all with minimal user intervention.

**Use case:** You want to go from existing code to design-ready exports as fast as possible without reviewing intermediate steps.

**This combines:**
- `/ui:scan` — Codebase analysis
- `/ui:generate-specs` — Spec generation
- `/ui:export` — Export preparation
</objective>

<context>
@./.claude/ui-design/templates/code-analysis.md
@./.claude/ui-design/templates/screen.md
@./.claude/ui-design/templates/ui-spec.md
@./.claude/agents/ui-scanner.md
@./.claude/ui-design/adapters/stitch.md
@./.claude/ui-design/adapters/v0.md
@./.claude/ui-design/adapters/figma.md
</context>

<ux_principles>
## Minimal Intervention

- Ask only essential questions upfront
- Make smart defaults for everything else
- Report progress but don't wait for approval

## Speed Over Perfection

- Generate complete specs, mark inferred sections
- Skip optional refinements
- Prioritize getting to export quickly

## Transparent Process

- Show what's happening at each phase
- Report final results comprehensively
- Make it easy to refine later
</ux_principles>

<process>

<step name="initial_questions">
## Initial Questions (Minimal)

Ask only what's needed:

**Question 1: Export Target**

"Which design tool do you want to export to?"

Options:
- Stitch (visual design, recommended for mockups)
- V0 (code generation with shadcn/ui)
- Figma (design tokens + setup guide)
- Generic (tool-agnostic prompts)
- All services (generate all exports)

**Question 2: Scope (Optional)**

For large codebases (>100 component files), ask:

"Large codebase detected. Scan scope?"

Options:
- Full scan (all components and screens)
- Core only (main app, skip tests/storybook)
- Specific directories (will prompt)
</step>

<step name="phase_1_scan">
## Phase 1: Codebase Scan

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► PHASE 1/3: SCANNING CODEBASE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Execute full `/ui:scan` process:

1. **Quick detection** — Framework, styling, routing
2. **Component scan** — All components with props/variants
3. **Screen scan** — All routes with layouts
4. **Token extraction** — From Tailwind/CSS/theme files
5. **Pattern detection** — Reusable patterns

**Output:**
- `.harn/design/CODE-ANALYSIS.md`
- `.harn/design/design-tokens.json`
- `.harn/design/ui-state/scanner-state.json`

```
✓ Framework: Next.js 14 (App Router)
✓ Components: 45 discovered
✓ Screens: 12 mapped
✓ Tokens: 87 extracted
✓ Patterns: 6 detected

→ Proceeding to spec generation...
```
</step>

<step name="phase_2_generate">
## Phase 2: Spec Generation

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► PHASE 2/3: GENERATING SPECS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Execute full `/ui:generate-specs` process:

1. **UI-SPEC.md** — Master specification document
2. **COMPONENTS.md** — Component inventory with full props
3. **Screen specs** — 10-section specs for all screens
4. **UI-REGISTRY.md** — Tracking document
5. **UI-PATTERNS.md** — Detected patterns

**For each screen, generate:**
- Full 10-section spec
- ASCII wireframe (approximated from components)
- State documentation
- Component hierarchy

```
✓ UI-SPEC.md created
✓ COMPONENTS.md created (45 components)
✓ Screen specs: 12/12 complete
✓ UI-PATTERNS.md created (6 patterns)
✓ UI-REGISTRY.md created

→ Proceeding to export...
```
</step>

<step name="phase_3_export">
## Phase 3: Export Generation

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► PHASE 3/3: GENERATING EXPORTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Based on selected export target:

### For Stitch:
```
.harn/design/ui-exports/
├── stitch-prompts.md        # Screen-by-screen prompts
└── handoffs/
    └── design-handoff.md    # Project context for designers
```

### For V0:
```
.harn/design/ui-exports/
├── v0-prompts.md            # Code generation prompts
└── handoffs/
    └── v0-setup.md          # Tech context
```

### For Figma:
```
.harn/design/ui-exports/
├── figma-tokens.json        # Figma Variables format
├── figma-setup.md           # Import instructions
└── handoffs/
    └── figma-handoff.md     # Designer instructions
```

### For All Services:
Generate all of the above.

```
✓ [Service] prompts generated
✓ Handoff documents created
✓ Tokens formatted for [service]

→ Export complete!
```
</step>

<step name="final_summary">
## Final Summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► REVERSE ENGINEERING COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 SCAN RESULTS
─────────────────────────────────────────────────────────
Framework:    Next.js 14 + Tailwind CSS + TypeScript
Components:   45 discovered across 7 categories
Screens:      12 routes mapped
Tokens:       87 design values extracted
Patterns:     6 reusable patterns detected

 GENERATED FILES
─────────────────────────────────────────────────────────
Analysis:
  ✓ .harn/design/CODE-ANALYSIS.md
  ✓ .harn/design/design-tokens.json

Specifications:
  ✓ .harn/design/UI-SPEC.md
  ✓ .harn/design/COMPONENTS.md
  ✓ .harn/design/UI-PATTERNS.md
  ✓ .harn/design/UI-REGISTRY.md
  ✓ .harn/design/screens/SCR-01-login.md
  ✓ .harn/design/screens/SCR-02-signup.md
  ... [N more screens]

Exports:
  ✓ .harn/design/ui-exports/[service]-prompts.md
  ✓ .harn/design/ui-exports/handoffs/design-handoff.md
  [✓ .harn/design/ui-exports/figma-tokens.json (if Figma)]

 QUICK STATS
─────────────────────────────────────────────────────────
Top components: Button (47), Icon (89), Input (32)
Complex screens: Dashboard, Project Detail
Patterns: Auth Form, Dashboard Layout, Settings Section

 NOTES
─────────────────────────────────────────────────────────
• Screen specs have [INFERRED] sections - review recommended
• Wireframes are approximations from component analysis
• Token values extracted from Tailwind config

───────────────────────────────────────────────────────────

## ▶ Use Your Exports

**For Stitch:**
  Copy prompts from .harn/design/ui-exports/stitch-prompts.md
  Start with complex screens (Dashboard, etc.)

**For V0:**
  Copy prompts from .harn/design/ui-exports/v0-prompts.md
  Iterate on generated code

**For Figma:**
  Import .harn/design/ui-exports/figma-tokens.json as Variables
  Follow setup guide in figma-setup.md

## ▶ Refine Later

**Improve specific screen:**
  /ui:design-screens SCR-03

**Re-export after changes:**
  /ui:export [service]

**Sync after implementation changes:**
  /ui:sync

───────────────────────────────────────────────────────────
```
</step>

<step name="git_commit">
## Git Commit

Single comprehensive commit for all generated files:

```bash
git check-ignore -q .harn 2>/dev/null && COMMIT_HARN=false || COMMIT_HARN=true

if [ "$COMMIT_HARN" = "true" ]; then
    # Stage all generated files
    git add .harn/design/CODE-ANALYSIS.md
    git add .harn/design/design-tokens.json
    git add .harn/design/UI-SPEC.md
    git add .harn/design/COMPONENTS.md
    git add .harn/design/UI-PATTERNS.md
    git add .harn/design/UI-REGISTRY.md
    git add .harn/design/screens/*.md
    git add .harn/design/ui-exports/
    git add .harn/design/ui-state/

    git commit -m "docs(ui): reverse-engineer codebase to design specs

Scan Results:
- Framework: [framework]
- Components: [N] discovered
- Screens: [N] mapped
- Tokens: [N] extracted

Generated:
- CODE-ANALYSIS.md (full inventory)
- UI-SPEC.md + [N] screen specs
- COMPONENTS.md ([N] components)
- [Service] export prompts

Ready for design tool export.
"

    if git remote | grep -q origin; then
        git push origin $(git branch --show-current) 2>/dev/null || true
    fi
fi
```
</step>

</process>

<success_criteria>
- Complete scan with CODE-ANALYSIS.md
- All specs generated (UI-SPEC, screens, components)
- Export files ready for chosen service
- Single comprehensive summary
- Single git commit with all files
- Clear instructions for using exports
</success_criteria>

<error_handling>
## If Scan Fails

- Report what was discovered before failure
- Save partial CODE-ANALYSIS.md
- Suggest running `/ui:scan` manually with debug

## If Generation Fails

- Keep scan results
- Report which specs failed
- Suggest running `/ui:generate-specs` manually

## If Export Fails

- Keep scan and spec results
- Report export error
- Suggest running `/ui:export` manually
</error_handling>
