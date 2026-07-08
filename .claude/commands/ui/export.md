---
name: ui:export
description: Generate service-specific prompts and exports for external design tools
argument-hint: "[service: stitch|stitch-mcp|v0|figma|pencil|design-md|generic] [screen: SCR-XX (optional)]"
allowed-tools: [Read, Write, Glob, Grep, AskUserQuestion, Task]
agent: ui-prompter (for complex exports)
---

<objective>
Transform UI specifications into service-optimized outputs. Generate prompts for AI design tools (Stitch, V0), export formats for design applications (Figma), execute designs directly via MCP (Pencil or Stitch via `stitch-mcp`), or produce a publishable DESIGN.md (VoltAgent/awesome-design-md format). Uses service-specific adapters to ensure optimal output generation.
</objective>

<context>
@./.claude/ui-design/adapters/stitch.md
@./.claude/ui-design/adapters/stitch-mcp.md
@./.claude/ui-design/adapters/v0.md
@./.claude/ui-design/adapters/figma.md
@./.claude/ui-design/adapters/pencil.md
@./.claude/ui-design/adapters/design-md.md
@./.claude/ui-design/adapters/generic.md
@.harn/design/UI-SPEC.md (required)
@.harn/design/screens/*.md (required)
@.harn/design/COMPONENTS.md (recommended)
@.harn/design/design-tokens.json (recommended)
@.harn/design/UI-CONTEXT.md (recommended for design-md)
@.harn/design/UI-PATTERNS.md (recommended for design-md)
@.harn/design/UI-DECISIONS.md (recommended for design-md)
</context>

<ux_principles>
## Service Selection

If no service specified, offer quick selection:

**Question: Which service to export for?**

Options:
- Stitch — Visual design generation (recommended for high-fidelity mockups)
- Stitch MCP — Direct execution via Google Stitch MCP (same prompts as Stitch, but runs them in the service automatically; recommended when the MCP server is available)
- V0 — React component generation (recommended for implementation)
- Figma — Token export + setup guide
- Pencil — Direct design execution via MCP (recommended for rapid prototyping)
- DESIGN.md (VoltAgent format) — Single Markdown file describing the full visual system; agent-consumable and publishable
- Generic — Tool-agnostic prompts

## Scope Selection

Allow exporting:
- All screens (default)
- Specific screen(s) by ID
- Screens needing regeneration (drift detected)
</ux_principles>

<process>

<step name="parse_arguments">
## Parse Arguments

Parse the command arguments:
- `stitch` → Google Stitch prompts (written to `stitch-prompts.md`)
- `stitch-mcp` → Google Stitch executed directly via MCP server (uses the same prompt builder as `stitch`)
- `v0` → Vercel V0 prompts
- `figma` → Figma token export + setup
- `pencil` → Direct Pencil MCP execution
- `design-md` → DESIGN.md (VoltAgent/awesome-design-md format) — single-file visual system doc
- `generic` → Tool-agnostic prompts (default if no argument)

Optional screen filter:
- `SCR-01` → Export single screen
- `SCR-01,SCR-02,SCR-03` → Export multiple screens
- No filter → Export all screens

**Note:** The `design-md` service is system-level, not screen-level. It ignores any screen filter and always produces a single file describing the full visual system.

Examples:
- `/ui:export stitch` → All screens to Stitch (prompts-only, written to file)
- `/ui:export stitch-mcp` → All screens executed directly in the Stitch MCP server
- `/ui:export stitch-mcp SCR-01` → Single screen executed/updated via Stitch MCP
- `/ui:export v0 SCR-01` → Single screen to V0
- `/ui:export figma` → Full Figma setup
- `/ui:export pencil` → Direct design execution
- `/ui:export pencil SCR-01` → Single screen to Pencil
- `/ui:export design-md` → Single DESIGN.md file at `.harn/design/ui-exports/DESIGN.md`
</step>

<step name="verify_prerequisites">
## Verify Prerequisites

Check required files exist:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► EXPORT PREREQUISITES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Checking requirements for [service] export...

✓ UI-SPEC.md              Found
✓ Screen specs            [N] screens found
○ COMPONENTS.md           Optional (adds detail)
○ design-tokens.json      Optional (adds precision)

[If missing required]
✗ Screen specs missing - run /ui:design-screens first

───────────────────────────────────────────────────────
```

If required files missing:
- Inform user what's needed
- Suggest command to run
- Exit gracefully

**Service-specific requirements:**

- `design-md` is system-level — screen specs are NOT required, but at least one of the following should exist to produce a useful output: `design-tokens.json`, `COMPONENTS.md`, `UI-CONTEXT.md`. If all three are missing, warn the user that DESIGN.md will be mostly "*Not yet defined*" placeholders and ask whether to proceed. Recommended additional inputs: `UI-PATTERNS.md` (feeds §7 Do's) and `UI-DECISIONS.md` (feeds §7 Don'ts).

- `stitch-mcp` requires the Google Stitch MCP server to be reachable. Run a smoke test via `mcp__stitch__list_projects` (cheapest read; returns fast when healthy) with a short timeout. If the smoke test fails (tool unavailable, timeout, or server error), DO NOT silently fall through — ask the user what to do:

  ```
  AskUserQuestion:
    "The Stitch MCP server did not respond. What would you like to do?"
    Option 1 — Abort: Stop the export; print a concise diagnostic with suggested fixes (check MCP server, re-authenticate).
    Option 2 — Fall back to stitch (prompts-only): Generate .harn/design/ui-exports/stitch-prompts.md as if the user ran `/ui:export stitch`, and annotate the output clearly so the user knows MCP was unavailable.
  ```

  If the smoke test succeeds, proceed to `transform_to_stitch_mcp`. The rationale for asking rather than auto-falling-back: the user's intent when choosing `stitch-mcp` is to execute via MCP — silent fallback would hide a broken setup.
</step>

<step name="load_adapter">
## Load Service Adapter

Load adapter from `./.claude/ui-design/adapters/[service].md`:

The adapter provides:
- **transformation_rules** — How to convert specs
- **token_mapping** — Convert tokens to service format
- **component_descriptions** — Service-specific language
- **capability_matrix** — What the service supports
- **iteration_guidance** — Refinement patterns
</step>

<step name="spawn_prompter_or_handle">
## Generate Prompts

**For Pencil service (any screen count 2+):**
- Use the **orchestrator + subagent** pattern (see transform_to_pencil step)
- Orchestrator handles setup (open file, set variables, get components)
- Each screen gets its own **ui-pencil-screen** subagent in a fresh context window
- All screen agents run **in parallel** for maximum efficiency
- This prevents context window exhaustion from per-screen MCP operations

**For Pencil service (1 screen only):**
- Handle directly without spawning (single screen fits in context)

**For Stitch MCP service (any screen count 2+):**
- Same orchestrator + subagent pattern as Pencil (see transform_to_stitch_mcp step)
- Orchestrator handles setup (smoke test, project resolve, design system sync)
- Each screen gets its own **ui-stitch-screen** subagent
- Screen agents run **in parallel**

**For Stitch MCP service (1 screen only):**
- Handle directly without spawning (single screen fits in context)

**For other services (Stitch, V0, Figma, Generic) with 5+ screens:**
- Spawn UI Prompter agent with full context
- Agent handles all transformations
- Returns complete prompt set

**For other services with 1-4 screens:**
- Handle directly without spawning
- Apply adapter rules sequentially
</step>

<step name="transform_to_stitch">
## Stitch Export

For each screen, generate Stitch-optimized prompt:

```markdown
# Stitch Prompts

Generated: [date]
Source: UI specifications
Screens: [N] total

---

## SCR-01: Login

### Prompt

```
Create a modern login screen with the following specifications:

**Layout:**
Full-page layout with centered content card on subtle gray background (#F8FAFC).
Card is elevated with soft shadow, rounded corners (8px).
Maximum width 400px, vertically centered.

**Components:**
- Logo at top of card
- "Welcome back" heading with "Sign in to your account" subtitle
- Email input with label "Email address"
- Password input with label "Password" and show/hide toggle
- Primary blue button (#2563EB) "Sign in" - full width
- "Forgot password?" link below button
- Divider with "or continue with" text
- Google and GitHub social sign-in buttons
- "Don't have an account? Sign up" footer link

**Visual Style:**
- Clean, minimal aesthetic
- Inter or system font
- Primary blue: #2563EB
- Text dark slate: #0F172A
- Muted text: #64748B
- Subtle shadows, not flat

**States to show:**
- Default state (primary view)
```

### Iteration Guidance

**If layout is wrong:**
```
Adjust: Move [element] to [position]. Card should be centered both horizontally and vertically.
```

**If colors are off:**
```
Adjust: Change primary button to #2563EB. Background should be #F8FAFC, not pure white.
```

**If components missing:**
```
Add: Include a "Forgot password?" text link below the submit button.
```

### Handoff
→ See: handoffs/SCR-01-brief.md

---
```
</step>

<step name="transform_to_v0">
## V0 Export

For each screen, generate V0-optimized prompt:

```markdown
# V0 Prompts

Generated: [date]
Source: UI specifications
Screens: [N] total

---

## SCR-01: Login Page

### Prompt

```
Create a login page using shadcn/ui components with the following:

**Container:**
- Full viewport height
- Centered content using flexbox
- Background: bg-slate-50

**Card (shadcn/ui Card):**
- max-w-md mx-auto
- CardHeader with title "Welcome back" and description "Sign in to your account"
- CardContent with form
- CardFooter with signup link

**Form (react-hook-form + zod):**
- Email input (Input component, type="email", required)
- Password input (Input component, type="password", required)
- Submit button (Button variant="default", full width)
- Form validation with zod schema

**Additional elements:**
- "Forgot password?" link (Link component)
- Separator with "or continue with" text
- Social buttons: Google, GitHub (Button variant="outline")
- Footer: "Don't have an account?" with Link to /signup

**Form behavior:**
- Client-side validation
- Loading state on submit
- Error display using form field errors

**Accessibility:**
- Focus first input on mount
- Proper label associations
- Error announcements
```

### Expected Output
- File: `src/components/auth/login-form.tsx`
- shadcn/ui: Card, CardHeader, CardContent, CardFooter, Button, Input, Label, Separator
- Dependencies: react-hook-form, @hookform/resolvers, zod

### TypeScript Interface
```typescript
interface LoginFormProps {
  onSubmit: (data: { email: string; password: string }) => Promise<void>;
  isLoading?: boolean;
  error?: string;
}
```

### Iteration Guidance

**If using wrong components:**
```
Use shadcn/ui Card instead of custom div. Import from @/components/ui/card.
```

**If form validation missing:**
```
Add zod schema validation with zodResolver from @hookform/resolvers/zod.
```

---
```
</step>

<step name="transform_to_figma">
## Figma Export

Generate Figma-compatible outputs:

### figma-tokens.json
```json
{
  "$schema": "https://design-tokens.org/schema.json",
  "collections": {
    "Primitives": {
      "Blue": {
        "50": { "$value": "#EFF6FF", "$type": "color" },
        "100": { "$value": "#DBEAFE", "$type": "color" },
        "500": { "$value": "#3B82F6", "$type": "color" },
        "600": { "$value": "#2563EB", "$type": "color" },
        "700": { "$value": "#1D4ED8", "$type": "color" }
      }
    },
    "Semantic": {
      "Primary": {
        "Default": { "$value": "{Primitives.Blue.600}", "$type": "color" },
        "Hover": { "$value": "{Primitives.Blue.700}", "$type": "color" },
        "Foreground": { "$value": "#FFFFFF", "$type": "color" }
      },
      "Background": {
        "Default": { "$value": "#FFFFFF", "$type": "color" },
        "Subtle": { "$value": "#F8FAFC", "$type": "color" }
      }
    }
  },
  "modes": {
    "Light": "default",
    "Dark": {
      "Semantic.Background.Default": "#0F172A",
      "Semantic.Background.Subtle": "#1E293B"
    }
  }
}
```

### figma-setup.md
```markdown
# Figma Setup Guide

## 1. Import Variables

1. Open your Figma file
2. Right-click in canvas → Plugins → Tokens Studio (or Figma Variables)
3. Import `figma-tokens.json`
4. Variables will appear in your Local Variables panel

## 2. Create Component Library

For each component in COMPONENTS.md:

### Button
1. Create frame 40x40px (md size)
2. Add text layer "Button"
3. Apply variables:
   - Fill: Primary/Default
   - Text: Primary/Foreground
   - Corner radius: 6px
4. Create variants: primary, secondary, ghost, destructive
5. Add size variants: sm (32px), md (40px), lg (48px)

[Continue for each component...]

## 3. Build Screen Frames

| Screen | Frame Size | Notes |
|--------|------------|-------|
| SCR-01: Login | 1440x900 (desktop) | Also create 375x812 mobile |
| SCR-02: Signup | 1440x900 (desktop) | Same structure as Login |

## 4. Prototyping

Connect screens per navigation flows in UI-SPEC.md.
```
</step>

<step name="transform_to_pencil">
## Pencil Export (Direct Execution) — ORCHESTRATOR PATTERN

Unlike other adapters, Pencil executes designs directly via MCP tools. To prevent context window exhaustion when exporting multiple screens, this uses an **orchestrator + subagent** architecture: the orchestrator handles setup and coordination, while each screen is processed by a dedicated subagent in its own context window.

### Orchestrator Step 1: Pre-flight and Setup

```javascript
// 1. Check/open the .pen file
mcp__pencil__get_editor_state({ include_schema: false })

// 2. Open or verify the target file
mcp__pencil__open_document({ filePathOrTemplate: ".harn/design/pencil/app.pen" })

// 3. Sync design tokens to Pencil variables (ONE TIME for all screens)
mcp__pencil__set_variables({
  filePath: ".harn/design/pencil/app.pen",
  variables: {
    "primary": { "$value": "#2563EB", "type": "color" },
    "primary-foreground": { "$value": "#FFFFFF", "type": "color" },
    "background": { "$value": "#F8FAFC", "type": "color" },
    "foreground": { "$value": "#0F172A", "type": "color" },
    "muted": { "$value": "#64748B", "type": "color" },
    "border": { "$value": "#E2E8F0", "type": "color" }
    // ... extracted from design-tokens.json
  }
})

// 4. Get existing reusable components (for subagent context)
mcp__pencil__batch_get({
  filePath: ".harn/design/pencil/app.pen",
  patterns: [{ reusable: true }],
  readDepth: 2
})

// 5. Get existing screens to detect updates vs creates
mcp__pencil__batch_get({
  filePath: ".harn/design/pencil/app.pen",
  patterns: [{ name: "SCR-.*" }],
  readDepth: 1
})
```

### Orchestrator Step 2: Prepare per-screen context

For each screen to export, prepare a self-contained context bundle:
- Screen spec content (inlined)
- Design tokens (inlined)
- Available reusable components and their IDs
- Existing node ID (if updating)
- Pencil adapter operation syntax rules

### Orchestrator Step 3: Spawn parallel subagents

**For single screen:** Handle directly without subagent (same as before).

**For 2+ screens:** Spawn one **ui-pencil-screen** agent per screen using the Task tool. Launch **all agents in parallel**.

```
For each screen (SCR-XX) to export:
  Task(
    subagent_type: "general-purpose",
    description: "Export SCR-XX to Pencil",
    prompt: """
    You are a UI Pencil Screen Agent. Your job is to create/update exactly
    ONE screen in a Pencil .pen design file using MCP tools.

    Read the agent instructions: ./.claude/agents/ui-pencil-screen.md

    OPERATION: push

    PEN FILE: .harn/design/pencil/app.pen

    EXISTING NODE ID: {node_id or "none"}

    SCREEN SPEC:
    ---
    {inline full content of .harn/design/screens/SCR-XX-name.md}
    ---

    DESIGN TOKENS:
    {inline design-tokens.json}

    AVAILABLE COMPONENTS:
    {list of reusable component names and IDs}

    ADAPTER RULES SUMMARY:
    - Use I() for Insert, U() for Update, R() for Replace, C() for Copy
    - Max 25 operations per batch_design call — split if needed
    - Always validate with get_screenshot after creation
    - Use meaningful node names with SCR-XX prefix
    - Node types: frame, text, rectangle, ellipse, ref, group
    - Layout: "horizontal", "vertical", "grid"
    - Sizing: number, "fill_container", "hug_content"

    Execute the push and return a structured result including:
    - screen ID, status, node_id, operations count, any issues
    """
  )
```

**IMPORTANT:** All screen agents run **in parallel** — each gets its own fresh context window and processes its screen independently.

### Orchestrator Step 4: Collect results and finalize

After all subagents complete:

1. Collect node IDs from each agent's result
2. Update pencil-state.json with screen-to-node mappings
3. Update UI-REGISTRY.md with export status
4. Write pencil-operations.md log

### Output Log

```markdown
# Pencil Operations Log

Generated: [date]
File: .harn/design/pencil/app.pen
Screens: [N] total
Method: Parallel subagents (1 per screen)

## Results

| Screen | Status | Node ID | Operations | Screenshot |
|--------|--------|---------|------------|------------|
| SCR-01 | ✓ Created | screen_abc123 | 18 ops | Validated |
| SCR-02 | ✓ Created | screen_def456 | 22 ops | Validated |
| SCR-03 | ✓ Created | screen_ghi789 | 25 ops | Validated |

## Per-Screen Details

### SCR-01: Login
**Node ID:** screen_abc123
**Status:** Generated
**Agent:** Completed in own context window
**Screenshot:** Validated ✓

### SCR-02: Signup
**Node ID:** screen_def456
**Status:** Generated
**Agent:** Completed in own context window
**Screenshot:** Validated ✓

[... repeat for each screen]
```
</step>

<step name="transform_to_stitch_mcp">
## Stitch MCP Export (Direct Execution) — ORCHESTRATOR PATTERN

Unlike the plain `stitch` export, `stitch-mcp` dispatches each screen through `mcp__stitch__*` tool calls, so work lands inside a live Stitch project instead of `stitch-prompts.md`. This step assumes `verify_prerequisites` has already confirmed MCP availability — if the smoke test failed and the user chose the fallback path, the command has already been rerouted to `transform_to_stitch` and this step is skipped.

The prompt text sent to Stitch is built by the **same transformation rules as the plain `stitch` adapter** (`./.claude/ui-design/adapters/stitch.md` — `<transformation_rules>`, `<token_mapping>`, `<component_descriptions>`). This is intentional: a screen rendered via MCP must be visually indistinguishable from one a human generates by pasting the same prompt into stitch.new. Do NOT duplicate the prompt-building logic — reuse the adapter.

### Orchestrator Step 1: Load state and resolve project

Read `.harn/design/ui-state/stitch-state.json` if it exists (otherwise start from defaults):

```javascript
let state = readJsonOr(".harn/design/ui-state/stitch-state.json", {
  project_id: null,
  project_name: deriveProjectName(), // from UI-SPEC.md title or repo basename
  design_system_id: null,
  tokens_hash: null,
  last_sync: null,
  screen_mapping: {}
});

// Try ID first (fastest)
let project = state.project_id
  ? await mcp__stitch__get_project({ project_id: state.project_id }).catch(() => null)
  : null;

// Fall back to name lookup (handles state loss / fresh clone)
if (!project) {
  const all = await mcp__stitch__list_projects({});
  project = all.find(p => p.name === state.project_name) ?? null;
  if (project) state.project_id = project.id;
}

// Create if still missing
if (!project) {
  project = await mcp__stitch__create_project({ name: state.project_name });
  state.project_id = project.id;
}

// Persist immediately — partial crash must leave us idempotent
writeJson(".harn/design/ui-state/stitch-state.json", state);
```

### Orchestrator Step 2: Sync design system from tokens

```javascript
const tokensJson = readJson(".harn/design/design-tokens.json");
const currentHash = sha1(JSON.stringify(tokensJson));

if (!state.design_system_id) {
  // First run
  const ds = await mcp__stitch__create_design_system({
    project_id: project.id,
    name: `${state.project_name} DS`,
    tokens: convertTokensForStitch(tokensJson) // see stitch-mcp.md <token_mapping>
  });
  state.design_system_id = ds.id;
} else if (state.tokens_hash !== currentHash) {
  // Tokens changed — update
  await mcp__stitch__update_design_system({
    design_system_id: state.design_system_id,
    tokens: convertTokensForStitch(tokensJson)
  });
}

// Always apply (cheap, guarantees new screens pick up current DS)
await mcp__stitch__apply_design_system({
  project_id: project.id,
  design_system_id: state.design_system_id
});

state.tokens_hash = currentHash;
writeJson(".harn/design/ui-state/stitch-state.json", state);
```

### Orchestrator Step 3: Plan per-screen action

For each screen in scope (all screens, or the filtered subset from the command argument), decide the action:

```javascript
for (const screenId of screensInScope) {
  const spec = readFile(`.harn/design/screens/${screenId}-*.md`);
  const specHash = sha1(spec);
  const existing = state.screen_mapping[screenId];

  if (!existing) {
    plan[screenId] = { action: "create", spec };
  } else if (existing.spec_snapshot_hash === specHash) {
    plan[screenId] = { action: "skip", reason: "no spec changes", screen_id: existing.screen_id };
  } else if (isMajorRewrite(spec, existing)) {
    plan[screenId] = { action: "regenerate", spec, previous_screen_id: existing.screen_id };
  } else {
    plan[screenId] = { action: "edit", spec, screen_id: existing.screen_id };
  }
}
```

`isMajorRewrite` is the heuristic described in `stitch-mcp.md <iteration_guidance>` (wireframe block rewritten, or >30% component diff). Regenerate deletes server-side and creates fresh — small edits use `edit_screens` to preserve IDs and variants.

### Orchestrator Step 4: Build prompts and spawn subagents

For each screen with action `create` or `regenerate`, build the full prompt via the shared `stitch.md` builder. For `edit`, build diff-focused edit instructions via `stitch.md <iteration_guidance>`.

**Single screen in scope:** handle directly without spawning a subagent (Task overhead isn't worth it for one screen). Call `mcp__stitch__generate_screen_from_text` or `edit_screens` inline.

**2+ screens in scope:** spawn one **ui-stitch-screen** agent per screen via the Task tool, all in parallel:

```
For each screenId with action in {create, edit, regenerate}:
  Task(
    subagent_type: "general-purpose",
    description: "Export [screenId] to Stitch MCP",
    prompt: """
    You are a UI Stitch Screen Agent.
    Read the agent instructions: ./.claude/agents/ui-stitch-screen.md

    OPERATION: [create | edit]

    PROJECT ID: [project.id]
    DESIGN SYSTEM ID: [state.design_system_id]
    SCREEN KEY: [screenId]
    SCREEN NAME: [screen title from spec]
    SCREEN ID: [existing.screen_id if edit, else omit]

    [For create/regenerate:]
    PROMPT TEXT (send VERBATIM to generate_screen_from_text.text):
      <<<
      [full prompt built by the orchestrator via stitch.md transformation_rules]
      >>>

    [For edit:]
    EDIT INSTRUCTIONS (send VERBATIM to edit_screens.instructions):
      <<<
      [diff-style instructions built via stitch.md iteration_guidance]
      >>>

    GENERATE VARIANTS: [true|false]
    VARIANTS COUNT: [3 if variants requested]

    Execute the call and return a STITCH SCREEN RESULT block (format in ui-stitch-screen.md).
    """
  )
```

All Task invocations go out **in parallel** — each agent gets its own fresh context window.

For screens with action `regenerate`, the orchestrator first deletes or archives the old screen server-side (if Stitch exposes that — otherwise just orphan the old ID with a note in the ops log) and sets the subagent's operation to `create`.

For screens with action `skip`, no subagent is spawned; the orchestrator records them as "skipped" in the log.

### Orchestrator Step 5: Collect results, persist state, write log

Parse each agent's `STITCH SCREEN RESULT` block and merge into state:

```javascript
for (const result of results) {
  const prev = state.screen_mapping[result.screen_key] ?? { variant_ids: [], version: 0 };
  state.screen_mapping[result.screen_key] = {
    screen_id: result.screen_id,
    variant_ids: result.variant_ids,
    last_update: nowIso(),
    version: (prev.version ?? 0) + (result.operation === "edit" || result.operation === "create" ? 1 : 0),
    spec_snapshot_hash: sha1(readFile(`.harn/design/screens/${result.screen_key}-*.md`))
  };
}

state.last_sync = nowIso();
writeJson(".harn/design/ui-state/stitch-state.json", state);
```

Then write the operations log, update `UI-REGISTRY.md`, and update `coordinator-state.json` (see `update_registry` and `update_state` steps — `stitch_mcp` block).

### Output Log

Write `.harn/design/ui-exports/stitch-operations.md`:

```markdown
# Stitch MCP Operations Log

Generated: [ISO timestamp]
Project: [project name] ([project_id])
Design System: [DS name] ([design_system_id])
Screens in scope: [N]
Method: [Inline (single screen) | Parallel subagents (1 per screen)]

## Pre-flight
- ✓ MCP smoke test (list_projects) — OK in [ms]
- ✓ Project resolved — [reused existing | created new]
- ✓ Design system — [created | tokens unchanged, apply only | tokens changed, updated]

## Per-screen results

| Screen | Action | Screen ID | Version | Variants | Issues |
|--------|--------|-----------|---------|----------|--------|
| SCR-01 | edit | scr_001 | 2 | 0 | — |
| SCR-02 | create | scr_002 | 1 | 0 | — |
| SCR-03 | skip (no spec changes) | scr_003 | 1 | 0 | — |

## Warnings
[list any warnings surfaced by subagents or the orchestrator]

## Next steps
- Open the project in Stitch: [URL if available in the create_project response]
- Iterate on one screen: `/ui:export stitch-mcp SCR-01`
- Force regenerate a screen: delete its entry from `stitch-state.json` and re-run
```
</step>

<step name="transform_to_design_md">
## DESIGN.md Export (VoltAgent Format)

Produce a single `DESIGN.md` file with the 9 canonical sections defined by the VoltAgent/awesome-design-md format. This is a system-level artifact (not per-screen), designed for AI agents to consume as a visual contract and for humans to publish alongside `README.md` / `AGENTS.md` / `CLAUDE.md`.

### Inputs aggregated

| Section | Source | Notes |
|---------|--------|-------|
| §1 Visual Theme & Atmosphere | `UI-CONTEXT.md` — Mood, audience, inspiration, keywords | Emit 2–5 paragraphs of prose |
| §2 Color Palette & Roles | `design-tokens.json` → `color.*` | Walk each role; emit hex; dark-mode parallel table if `$extensions.mode.dark` present |
| §3 Typography Rules | `design-tokens.json` → `fontFamily.*`, `fontSize.*`, `fontWeight.*`, `lineHeight.*` | Build scale table |
| §4 Component Stylings | `COMPONENTS.md` | Prose paragraphs per component — no props, no TSX |
| §5 Layout Principles | `design-tokens.json` → `spacing.*` + `UI-CONTEXT.md` layout notes | List spacing values; pull grid/container rules |
| §6 Depth & Elevation | `design-tokens.json` → `shadow.*` | Token name → CSS value → intended use |
| §7 Do's and Don'ts | `UI-PATTERNS.md` (Do's) + `UI-DECISIONS.md` (Don'ts) | Recommended patterns → Do; rejected options → Don't |
| §8 Responsive Behavior | `UI-CONTEXT.md` → viewport, breakpoints, device focus | Emit breakpoints table + strategy |
| §9 Agent Prompt Guide | Aggregated from §§1–6 | Three templated prompts: general, new screen, new component |

### Transformation rules

Follow the adapter at `./.claude/ui-design/adapters/design-md.md` — section `<transformation_rules>` is authoritative. Key invariants:

1. **All 9 sections always present.** If source is missing data, emit the section with a single italicized placeholder line: `*Not yet defined — see [source-file].*`
2. **Preserve hex values exactly** — no re-quantizing or re-naming colors.
3. **Prose, not bullets, in §1 and §4** — mood and component descriptions read better as sentences.
4. **Drop harness-internal metadata** (`$type`, `$description`, `$metadata.*`, raw token paths like `color.primary.500`). Translate to human language.
5. **Dark mode is parallel, not alternate** — emit a second palette table under §2; never a separate section or file.
6. **§9 references concrete values** from §§2–6 so the prompts are self-contained.

### Output file

**Single file:** `.harn/design/ui-exports/DESIGN.md`

This path is canonical — the user may move the file to the project root after review. Do NOT place it in a per-service subfolder.

### Template skeleton

```markdown
# DESIGN.md

> Visual design system for [Project Name].
> Source of truth for AI agents generating UI consistent with the brand.

---

## 1. Visual Theme & Atmosphere

[2–5 paragraphs of prose from UI-CONTEXT.md Mood/Direction.]

**Keywords:** [comma list from UI-CONTEXT tags]
**Inspiration:** [from UI-CONTEXT inspiration]
**Audience:** [from UI-CONTEXT audience]

---

## 2. Color Palette & Roles

**Mode:** [Light / Dark / Both — inferred from presence of `$extensions.mode.dark`]

### Core Palette

| Role | Hex | Usage |
|------|-----|-------|
| Primary | `#HEX` | [usage] |
| Secondary | `#HEX` | [usage] |
| Background (page) | `#HEX` | [usage] |
| Surface (cards) | `#HEX` | [usage] |
| Text primary | `#HEX` | [usage] |
| Text muted | `#HEX` | [usage] |
| Border | `#HEX` | [usage] |
| Success | `#HEX` | [usage] |
| Warning | `#HEX` | [usage] |
| Error/Destructive | `#HEX` | [usage] |

### Dark Mode (emit only if any token has `$extensions.mode.dark`)

| Role | Hex | Notes |
|------|-----|-------|
| ... | ... | ... |

**Rules:**
- [rules from UI-DECISIONS color-usage entries, if any]

---

## 3. Typography Rules

**Font families:**
- Sans: `[fontFamily.sans.$value]` — used for [where]
- Serif: `[fontFamily.serif.$value]` — used for [where, if defined]
- Mono: `[fontFamily.mono.$value]` — used for code, numerics

**Scale:**

| Role | Size | Weight | Line height | Use |
|------|------|--------|-------------|-----|
| Display | [fontSize.display] | [weight] | [lh] | Hero, marketing |
| H1 | [fontSize.h1] | [weight] | [lh] | Page title |
| H2 | [fontSize.h2] | [weight] | [lh] | Section title |
| H3 | [fontSize.h3] | [weight] | [lh] | Subsection |
| Body | [fontSize.base] | [weight] | [lh] | Paragraphs |
| Small | [fontSize.sm] | [weight] | [lh] | Captions, helper |
| Code | [fontSize.code] | [weight] | [lh] | Inline + blocks |

**Rules:**
- [rules from UI-DECISIONS typography entries]

---

## 4. Component Stylings

[For each component in COMPONENTS.md, emit a prose paragraph. Use present-tense descriptive voice. See adapter `<component_descriptions>` for prose patterns.]

### Buttons

**Primary:** [prose description of fill, text, radius, padding, states.]

**Secondary:** [prose description.]

**Ghost / tertiary:** [prose description.]

**Destructive:** [prose description — "only for irreversible actions".]

### Inputs

[prose for text, select, checkbox, radio, toggle.]

### Cards & Surfaces

[prose for card treatment.]

### Navigation

[prose for top nav, side nav, tabs, breadcrumbs.]

### Feedback

[prose for toasts, alerts, banners, modals, tooltips.]

### Data display

[prose for tables, lists, badges, chips, avatars.]

---

## 5. Layout Principles

**Spacing scale:** [comma-separated list from `spacing.*` tokens in order]

**Grid:** [from UI-CONTEXT Layout notes]

**Containers:**
- Page max-width: [value]
- Content max-width: [value]
- Sidebar width: [value if applicable]

**Rhythm rules:**
- [rules from UI-CONTEXT + UI-PATTERNS layout entries]

**Alignment:** [from UI-CONTEXT]

---

## 6. Depth & Elevation

**Philosophy:** [infer from shadow count — "flat" if only `shadow.none`; "subtle" if sm/md only; "layered" if full scale]

**Elevation scale:**

| Level | Token | Value | Used for |
|-------|-------|-------|----------|
| 0 | `shadow.none` | none | Flat surfaces |
| 1 | `shadow.sm` | [value] | Resting cards |
| 2 | `shadow.md` | [value] | Hover, dropdowns |
| 3 | `shadow.lg` | [value] | Modals, popovers |
| 4 | `shadow.xl` | [value] | Dialogs |

**Rules:**
- [from UI-DECISIONS elevation-philosophy entries]

---

## 7. Do's and Don'ts

### Do

- [Each UI-PATTERNS entry with status=recommended, paraphrased to prescriptive voice.]

### Don't

- [Each UI-DECISIONS entry with chosen=false or section=rejected, paraphrased as "Don't X".]

---

## 8. Responsive Behavior

**Breakpoints:**

| Name | Min width | Target device |
|------|-----------|---------------|
| [name] | [width] | [device] |

**Strategy:** [from UI-CONTEXT — mobile-first / desktop-first]

**Rules:**
- [responsive patterns from UI-PATTERNS with status=recommended.]

**Device focus:** [from UI-CONTEXT Device focus field]

---

## 9. Agent Prompt Guide

### General brief

\`\`\`
You are designing UI for [Project Name]. The system feels [keywords from §1].
Use the palette in §2 exactly — primary is #HEX, backgrounds are #HEX, text is #HEX.
Typography: [sans family] for UI, [mono family] for code. Body size: [fontSize.base].
Spacing scale: [values]. Corner radius: [borderRadius values]. Shadows: [description from §6].
Always follow the Do/Don't rules in §7.
\`\`\`

### Building a new screen

\`\`\`
Generate a [screen type] for [Project Name] at [viewport from §8].
Layout: [container max-width + alignment from §5].
Colors: [palette roles from §2].
Components: use the [button / input / card] treatments from §4.
Elevation: [rule from §6].
Follow Do's in §7; avoid Don'ts.
\`\`\`

### Adding a component

\`\`\`
Design a new [component] for [Project Name].
Match the visual treatment in §4 — same radius, padding rhythm, and color roles.
If interactive, define hover/active/disabled using the palette in §2.
Respect elevation in §6; don't introduce a new shadow level.
\`\`\`
```

### Post-generation

After writing `.harn/design/ui-exports/DESIGN.md`:

1. Validate all 9 sections present (headings `## 1.` through `## 9.`).
2. Report any section that fell back to the "*Not yet defined*" placeholder so the user knows which source file to populate.
3. Record the export in `UI-DECISIONS.md` with date + source artifact versions.

### Iteration guidance

If a section looks wrong:
- Edit the underlying source (`UI-CONTEXT.md`, `design-tokens.json`, `COMPONENTS.md`, `UI-PATTERNS.md`, `UI-DECISIONS.md`), then re-run `/ui:export design-md`.
- DESIGN.md is derived — never edit it by hand and expect the changes to persist. The harness treats it as a build artifact.
</step>

<step name="transform_to_generic">
## Generic Export

For each screen, generate tool-agnostic prompt:

```markdown
# Generic UI Prompts

Generated: [date]
Source: UI specifications
Screens: [N] total

Note: These prompts use universal language and work with any design tool.

---

## SCR-01: Login Screen

### Prompt

```
Design a login screen with these specifications:

LAYOUT:
- Full page with content centered both horizontally and vertically
- Main content area is a card/panel, maximum 400 pixels wide
- Background is very light gray (almost white)

CARD STRUCTURE (top to bottom):
1. Application logo at top
2. Large heading: "Welcome back"
3. Smaller subheading: "Sign in to your account"
4. Form with:
   - Email field with label above
   - Password field with label above and show/hide option
   - Large primary button spanning full width of form
5. "Forgot password?" link
6. Horizontal divider with "or" text
7. Two secondary buttons for Google and GitHub sign-in
8. Footer text: "Don't have an account?" with "Sign up" link

VISUAL DETAILS:
- Card has subtle drop shadow and slightly rounded corners
- Primary button is bright blue
- Input fields have light gray borders
- Text uses dark colors for headings, medium gray for secondary text
- Clean, modern, minimal aesthetic
- Sans-serif font throughout

SPACING:
- Generous padding inside the card (24-32 pixels)
- Comfortable spacing between form elements (16-20 pixels)
- Button has vertical padding for easy clicking
```

### What to look for:
- [ ] Card is centered on page
- [ ] Form elements are properly labeled
- [ ] Primary button is visually prominent
- [ ] Social buttons are secondary in style
- [ ] Overall clean, professional appearance

---
```
</step>

<step name="create_handoffs">
## Create Handoff Documents

For each exported screen, create handoff brief:

```markdown
# Design Handoff: SCR-01 Login

## Visual Checklist

### Layout
- [ ] Card centered horizontally and vertically
- [ ] Max width 400px
- [ ] Background color: #F8FAFC

### Typography
- [ ] Heading: 24px, semibold
- [ ] Subheading: 14px, regular, muted color
- [ ] Input labels: 14px, medium

### Colors
- [ ] Primary button: #2563EB
- [ ] Button text: #FFFFFF
- [ ] Input border: #E2E8F0
- [ ] Body text: #0F172A
- [ ] Muted text: #64748B

### Spacing
- [ ] Card padding: 24px
- [ ] Form gap: 16px
- [ ] Button padding: 12px vertical

### Components Used
| Component | Variant | Count |
|-----------|---------|-------|
| Button | primary | 1 |
| Button | outline | 2 |
| Input | default | 2 |
| Separator | with-text | 1 |
| Link | default | 2 |

### States to Design
- [ ] Default (required)
- [ ] Loading (submit in progress)
- [ ] Error (validation failed)
```
</step>

<step name="update_registry">
## Update Registry

Update `.harn/design/UI-REGISTRY.md`:

```markdown
## Export History

| Screen | Stitch | Stitch MCP | V0 | Figma | Pencil | Generic | Last Export |
|--------|--------|------------|----|-------|--------|---------|-------------|
| SCR-01 | ✓ v2 | ✓ scr_001 v2 | ✓ v1 | ✓ | ✓ screen_abc | ✓ | 2026-01-19 |
| SCR-02 | ✓ v1 | ○ | ✓ v1 | ✓ | ✓ screen_def | ✓ | 2026-01-19 |
| SCR-03 | ○ | ○ | ○ | ○ | ○ | ○ | - |

## System-Level Exports

| Artifact | Status | File | Last Export |
|----------|--------|------|-------------|
| DESIGN.md | [✓ / ○] | `.harn/design/ui-exports/DESIGN.md` | [date] |
```
</step>

<step name="update_state">
## Update State

Update `.harn/design/ui-state/coordinator-state.json`:
```json
{
  "project_status": {
    "exports_generated": {
      "stitch": [N],
      "v0": [N],
      "figma": true/false,
      "pencil": {
        "count": [N],
        "file": ".harn/design/pencil/app.pen",
        "node_mapping": {
          "SCR-01": "screen_abc123",
          "SCR-02": "screen_def456"
        }
      },
      "stitch_mcp": {
        "count": [N],
        "project_id": "prj_abc123",
        "project_name": "[project name]",
        "design_system_id": "ds_xyz789",
        "state_file": ".harn/design/ui-state/stitch-state.json",
        "last_export": "[ISO timestamp]",
        "screen_mapping": {
          "SCR-01": "scr_001",
          "SCR-02": "scr_002"
        }
      },
      "design_md": {
        "generated": true,
        "file": ".harn/design/ui-exports/DESIGN.md",
        "last_export": "[timestamp]",
        "sections_with_placeholders": []
      },
      "generic": [N]
    }
  }
}
```
</step>

<step name="completion">
## Completion Summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► EXPORT COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Service:  [stitch/v0/figma/pencil/design-md/generic]
Screens:  [N] prompts generated (design-md: system-level, screens not iterated)

Prompts:
  ✓ SCR-01: Login           → stitch-prompts.md#scr-01
  ✓ SCR-02: Signup          → stitch-prompts.md#scr-02
  ✓ SCR-03: Dashboard       → stitch-prompts.md#scr-03

Handoffs:
  ✓ handoffs/SCR-01-brief.md
  ✓ handoffs/SCR-02-brief.md
  ✓ handoffs/SCR-03-brief.md

Files:
  .harn/design/ui-exports/[service]-prompts.md (or pencil-operations.md)
  .harn/design/ui-exports/DESIGN.md (for design-md exports)
  .harn/design/ui-exports/handoffs/*.md
  .harn/design/pencil/app.pen (for Pencil exports)

───────────────────────────────────────────────────────

## How to Use

[For Stitch]
1. Open stitch.new
2. Copy prompt from stitch-prompts.md
3. Paste and generate
4. If iteration needed, use refinement guidance
5. Export as Figma/HTML/Flutter

[For V0]
1. Open v0.dev
2. Copy prompt from v0-prompts.md
3. Generate component
4. Click "Add to Codebase" or use `npx v0 add`
5. Review and customize generated code

[For Figma]
1. Import figma-tokens.json using Variables panel
2. Follow setup guide in figma-setup.md
3. Build components from COMPONENTS.md specs
4. Create screens following screen specs

[For Pencil]
1. Designs executed directly via MCP
2. Screenshots captured for validation
3. Review pencil-operations.md for details
4. Iterate with Update operations if needed
5. Node IDs recorded for future reference

[For Stitch MCP]
1. Screens executed directly in a live Stitch project via MCP
2. Design tokens synced as a Stitch design system (reused across runs)
3. Open the project URL printed in stitch-operations.md to review
4. Iterate a single screen: `/ui:export stitch-mcp SCR-XX` (uses `edit_screens` to preserve IDs and variants)
5. Force a full regeneration for one screen: delete its entry from `.harn/design/ui-state/stitch-state.json` and re-run
6. If MCP is down when you run the command, you'll be asked whether to abort or fall back to the prompts-only flow

[For DESIGN.md]
1. Review .harn/design/ui-exports/DESIGN.md
2. Check that all 9 sections have real content (not "*Not yet defined*" placeholders)
3. If placeholders remain, populate the corresponding source file and re-run `/ui:export design-md`
4. Move to project root (or copy) so other agents (Claude Code, Cursor, Windsurf) can consume it as visual contract
5. Commit alongside README.md / AGENTS.md — it's a publishable artifact

───────────────────────────────────────────────────────

## ▶ After Generation

**Track realization** — Mark screens as realized

`/ui:realize SCR-01`

**Iterate on prompts** — Refine if results need adjustment

`/ui:export [service] SCR-01` (regenerate single screen)

**Import back** — If design drifted from spec

`/ui:import-design`

───────────────────────────────────────────────────────
```
</step>

</process>

<success_criteria>
- Export files created in `.harn/design/ui-exports/`
- All specified screens have corresponding prompts (or designs for Pencil)
- Prompts follow service adapter best practices
- Handoff documents generated for each screen
- Design tokens included where applicable
- Clear usage instructions provided
- Registry and state updated

**Pencil-specific criteria:**
- Designs executed successfully via batch_design (one subagent per screen)
- Screenshots captured for visual validation (by each subagent)
- Node IDs recorded in registry for future updates (collected by orchestrator)
- Variables synced from design tokens (once by orchestrator before spawning agents)
- All screen agents ran in parallel for maximum efficiency
- Orchestrator context remained lean (no MCP tool call bloat)
</success_criteria>
