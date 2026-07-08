---
name: ui:pencil
description: Interactive design workflow with Pencil MCP — create, iterate, validate, and sync designs
argument-hint: "[subcommand: open|sync|components|validate|iterate|style|layout] [args]"
allowed-tools: [Read, Write, Glob, Grep, AskUserQuestion, Task, mcp__pencil__*]
agent: ui-designer (for complex operations)
---

<objective>
Provide an interactive design workflow using Pencil MCP. Unlike `/ui:export pencil` which is a one-way batch operation, `/ui:pencil` enables bidirectional sync, iterative refinement, visual validation, and design system management — all with immediate visual feedback via screenshots.
</objective>

<context>
@./.claude/ui-design/adapters/pencil.md
@.harn/design/UI-SPEC.md (if exists)
@.harn/design/screens/*.md (if exists)
@.harn/design/COMPONENTS.md (if exists)
@.harn/design/design-tokens.json (if exists)
</context>

<subcommands>

## Available Subcommands

| Subcommand | Description | Example |
|------------|-------------|---------|
| `open` | Open or create a .pen design file | `/ui:pencil open .harn/design/pencil/app.pen` |
| `sync` | Bidirectional sync between specs and designs | `/ui:pencil sync --push` |
| `components` | Manage design system components | `/ui:pencil components --list` |
| `validate` | Visual validation against specifications | `/ui:pencil validate SCR-01` |
| `iterate` | Interactive refinement session | `/ui:pencil iterate SCR-01` |
| `style` | Explore and apply style guides | `/ui:pencil style --explore` |
| `layout` | Debug layout issues | `/ui:pencil layout screen_abc` |

If no subcommand provided, show interactive menu.

</subcommands>

<ux_principles>

## Interactive Experience

This command prioritizes:
1. **Immediate feedback** — Screenshots after every significant change
2. **Conversational flow** — Ask clarifying questions, offer choices
3. **Progressive disclosure** — Start simple, reveal complexity as needed
4. **Recovery friendly** — Easy to undo, iterate, try alternatives

## No Subcommand Behavior

If user runs just `/ui:pencil`, present options:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► PENCIL DESIGN WORKFLOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

What would you like to do?

1. Open/Create    → Open a .pen file or create new design
2. Sync           → Sync between specs and Pencil designs
3. Components     → Manage design system components
4. Validate       → Check designs against specifications
5. Iterate        → Refine a screen interactively
6. Style          → Explore style guides for inspiration
7. Layout         → Debug layout and positioning issues

───────────────────────────────────────────────────────
```

</ux_principles>

<subcommand_open>

## /ui:pencil open [file]

Open an existing .pen file or create a new one.

### Arguments
- `[file]` — Path to .pen file (optional)
- `--new` — Force create new file
- `--template [name]` — Start from template (blank, dashboard, landing, mobile)

### Process

<step name="open_determine_file">
**IMPORTANT — .pen file location:** ALL .pen design files are stored in `.harn/design/pencil/` within the project directory. If the directory does not exist, create it first.

If no file specified:
1. Check for existing .pen files in the `.harn/design/pencil/` folder
2. If found, list them and ask which to open
3. If none, offer to create new in `.harn/design/pencil/` folder

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► PENCIL OPEN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Found existing design files:
  1. .harn/design/pencil/app.pen (modified 2 hours ago)
  2. .harn/design/pencil/components.pen (modified yesterday)

Or create new:
  3. Create new design file

Which would you like to open?
───────────────────────────────────────────────────────
```
</step>

<step name="open_file">
Open or create the file in `.harn/design/pencil/`:

```javascript
// Open existing
mcp__pencil__open_document({ filePathOrTemplate: ".harn/design/pencil/app.pen" })

// Or create new — after creating, save to .harn/design/pencil/
mcp__pencil__open_document({ filePathOrTemplate: "new" })
// The resulting file should be saved as .harn/design/pencil/app.pen (or .harn/design/pencil/{project-name}.pen)
```

</step>

<step name="open_get_state">
Get current editor state:

```javascript
mcp__pencil__get_editor_state({ include_schema: false })
```

Report contents:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► PENCIL OPENED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

File: .harn/design/pencil/app.pen

Contents:
  Screens:     3 (SCR-01, SCR-02, SCR-03)
  Components:  12 reusable
  Variables:   24 defined

Quick Actions:
  • /ui:pencil iterate SCR-01  — Refine a screen
  • /ui:pencil components      — Manage components
  • /ui:pencil sync --push     — Push specs to design

───────────────────────────────────────────────────────
```
</step>

<step name="open_sync_tokens">
If `design-tokens.json` exists and file is new/empty, offer to sync:

```
Design tokens found. Sync to Pencil variables?
  • Yes — Set up variables from design-tokens.json
  • No  — I'll set up manually
```

If yes:
```javascript
// Read tokens
const tokens = readFile(".harn/design/design-tokens.json")

// Convert and set
mcp__pencil__set_variables({
  filePath: ".harn/design/pencil/app.pen",
  variables: convertW3CTokensToPencil(tokens)
})
```
</step>

</subcommand_open>

<subcommand_sync>

## /ui:pencil sync [direction]

Bidirectional synchronization between specs and Pencil designs.

### Arguments
- `--push` — Specs → Pencil (create/update designs from specs)
- `--pull` — Pencil → Specs (extract designs back to specs)
- `--diff` — Show differences without changing anything
- `--screen [SCR-XX]` — Limit to specific screen(s)
- `--tokens` — Sync only design tokens/variables
- `--components` — Sync only components

### Process: Push (Specs → Pencil) — ORCHESTRATOR PATTERN

**CRITICAL:** Push uses an **orchestrator + subagent** architecture. The orchestrator (this command) handles setup and coordination. Each screen is processed by a dedicated **ui-pencil-screen** subagent in its own context window. This prevents the orchestrator's context from being overwhelmed by per-screen MCP operations.

<step name="sync_push_load">
**Orchestrator: Load and prepare context**

Load all specifications that will be needed by subagents:

```javascript
// Read all specs
const specs = glob(".harn/design/screens/*.md")
const tokens = readFile(".harn/design/design-tokens.json")
const components = readFile(".harn/design/COMPONENTS.md")
const pencilState = readFile(".harn/design/ui-state/pencil-state.json")
```

Also read the Pencil adapter rules (summary for subagent context):
```javascript
const adapterRules = readFile("./.claude/ui-design/adapters/pencil.md")
```
</step>

<step name="sync_push_compare">
**Orchestrator: Compare and plan**

Compare with existing Pencil content:

```javascript
mcp__pencil__batch_get({
  filePath: ".harn/design/pencil/app.pen",
  patterns: [{ name: "SCR-.*" }],
  readDepth: 1
})
```

Report differences:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► SYNC PUSH PREVIEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Comparing specs to Pencil designs...

Will CREATE (not in Pencil):
  + SCR-03: Dashboard
  + SCR-04: Settings

Will UPDATE (spec changed):
  ~ SCR-01: Login (spec modified after design)

Already synced:
  ✓ SCR-02: Signup

Proceed with push? (3 screens via parallel agents)
───────────────────────────────────────────────────────
```
</step>

<step name="sync_push_setup">
**Orchestrator: One-time setup (before spawning agents)**

Perform shared setup that only needs to happen once:

```javascript
// 1. Ensure file is open
mcp__pencil__get_editor_state({ include_schema: false })

// 2. Sync design tokens to variables (once for all screens)
mcp__pencil__set_variables({
  filePath: ".harn/design/pencil/app.pen",
  variables: convertW3CTokensToPencil(tokens)
})

// 3. Get available reusable components (for all agents to reference)
const existingComponents = mcp__pencil__batch_get({
  filePath: ".harn/design/pencil/app.pen",
  patterns: [{ reusable: true }],
  readDepth: 2
})
```
</step>

<step name="sync_push_plan_canvas_layout">
**Orchestrator: Pre-calculate canvas positions for all screens**

**CRITICAL:** Since subagents run in parallel, they all see the same canvas state at launch. Without pre-assigned positions, multiple agents may try to place their screen in the same blank space, causing overlaps.

Before spawning agents, the orchestrator must calculate and assign a unique canvas position for each screen:

```javascript
// 1. Get current canvas layout — see what already exists and where
const layout = mcp__pencil__snapshot_layout({
  filePath: ".harn/design/pencil/app.pen"
})

// 2. For screens that already have a node_id (update), keep their existing position
//    For NEW screens, find empty space sequentially

// 3. Determine screen dimensions (default: 1440x900 for desktop, 375x812 for mobile)
const screenWidth = 1440   // or from UI-CONTEXT.md viewport
const screenHeight = 900
const GAP = 100            // gap between screens on canvas

// 4. For each NEW screen, call find_empty_space_on_canvas sequentially,
//    BUT account for space that will be taken by previously-assigned screens
//    (since they don't exist yet on canvas)

const assignments = []
let lastAssigned = null  // track the rightmost assigned position

for (const screen of newScreensToCreate) {
  if (lastAssigned === null) {
    // First new screen: find actual empty space on canvas
    const space = mcp__pencil__find_empty_space_on_canvas({
      filePath: ".harn/design/pencil/app.pen",
      direction: "right",    // or "below" depending on preference
      width: screenWidth,
      height: screenHeight,
      padding: GAP
    })
    assignments.push({ screen: screen.id, x: space.x, y: space.y })
    lastAssigned = { x: space.x, y: space.y }
  } else {
    // Subsequent screens: offset from last assigned position (not from canvas state)
    const nextX = lastAssigned.x + screenWidth + GAP
    const nextY = lastAssigned.y  // same row, or wrap to next row if too wide
    assignments.push({ screen: screen.id, x: nextX, y: nextY })
    lastAssigned = { x: nextX, y: nextY }
  }
}

// For EXISTING screens being updated: use their current position from layout
for (const screen of existingScreensToUpdate) {
  const existingNode = findNodeInLayout(layout, screen.node_id)
  assignments.push({ screen: screen.id, x: existingNode.x, y: existingNode.y, node_id: screen.node_id })
}
```

**Result:** An `assignments` array where every screen has a pre-calculated `{ screen, x, y }`. This is passed to each subagent so they know exactly where to place their screen — no conflicts possible.
</step>

<step name="sync_push_spawn_agents">
**Orchestrator: Spawn one subagent per screen**

For each screen that needs to be created or updated, spawn a **ui-pencil-screen** agent using the Task tool. Launch agents **in parallel** for independent screens.

Each agent receives its **pre-assigned canvas position** from the orchestrator's layout plan.

```
For each screen (SCR-XX) to push:
  // Get the pre-calculated position for this screen
  const { x, y } = assignments.find(a => a.screen === "SCR-XX")

  Task(
    subagent_type: "general-purpose",
    description: "Push SCR-XX to Pencil",
    prompt: """
    You are a UI Pencil Screen Agent. Your job is to push exactly ONE screen
    to a Pencil .pen design file using MCP tools.

    Read the agent instructions: ./.claude/agents/ui-pencil-screen.md

    OPERATION: push

    PEN FILE: .harn/design/pencil/app.pen

    EXISTING NODE ID: {node_id from pencil-state or "none"}

    ASSIGNED CANVAS POSITION:
    x: {x}
    y: {y}
    IMPORTANT: You MUST place your screen frame at exactly these coordinates.
    Do NOT call find_empty_space_on_canvas — your position is pre-assigned by
    the orchestrator to avoid overlaps with other parallel agents.
    When creating the screen frame, set: { ..., x: {x}, y: {y} }

    SCREEN SPEC:
    ---
    {inline full content of .harn/design/screens/SCR-XX-name.md}
    ---

    DESIGN TOKENS:
    {inline full content of design-tokens.json}

    AVAILABLE COMPONENTS:
    {list of reusable component names and IDs from step above}

    ADAPTER RULES SUMMARY:
    - Use I() for Insert, U() for Update, R() for Replace, C() for Copy, M() for Move, D() for Delete
    - Max 25 operations per batch_design call
    - Always validate with get_screenshot after creation
    - Use meaningful node names with SCR-XX prefix
    - Node types: frame, text, rectangle, ellipse, ref, group
    - Layout: "horizontal", "vertical", "grid"
    - Sizing: number, "fill_container", "hug_content"

    Execute the push and return a structured result with:
    - screen ID
    - status (success/partial/failed)
    - node_id created/updated
    - operations count
    - any issues
    """
  )
```

**IMPORTANT:** Launch all screen agents **in parallel** using multiple Task calls in a single message. This maximizes throughput — each agent works in its own context window simultaneously.

Example with 3 screens:
```
// Single message with 3 parallel Task calls:
Task("Push SCR-01 to Pencil", ..., subagent_type: "general-purpose")
Task("Push SCR-03 to Pencil", ..., subagent_type: "general-purpose")
Task("Push SCR-04 to Pencil", ..., subagent_type: "general-purpose")
```
</step>

<step name="sync_push_collect">
**Orchestrator: Collect results and update state**

After all subagents complete, collect their results:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► SYNC PUSH COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Pushed via parallel agents:

  ✓ SCR-01: Login      (updated, node: screen_abc123)
  ✓ SCR-03: Dashboard  (created, node: screen_xyz789)
  ✓ SCR-04: Settings   (created, node: screen_def456)

Already synced:
  ✓ SCR-02: Signup

Total: 3 screens pushed, 1 already synced
───────────────────────────────────────────────────────
```

Update state files:
1. Update `.harn/design/ui-state/pencil-state.json` with new/updated node_ids
2. Update `.harn/design/UI-REGISTRY.md` with sync status
</step>

### Process: Pull (Pencil → Specs) — ORCHESTRATOR PATTERN

**CRITICAL:** Pull uses the same **orchestrator + subagent** architecture as push. The orchestrator handles discovery and shared data. Each screen is extracted by a dedicated subagent in its own context window.

<step name="sync_pull_discover">
**Orchestrator: Discover screens and shared data**

Read all designs from Pencil at shallow depth (orchestrator only needs names and IDs):

```javascript
// Get all screen names and IDs (shallow read — just metadata)
mcp__pencil__batch_get({
  filePath: ".harn/design/pencil/app.pen",
  patterns: [{ name: "SCR-.*" }],
  readDepth: 1
})

// Get variables (shared — orchestrator writes tokens file)
mcp__pencil__get_variables({ filePath: ".harn/design/pencil/app.pen" })

// Get reusable components list (shared)
mcp__pencil__batch_get({
  filePath: ".harn/design/pencil/app.pen",
  patterns: [{ reusable: true }],
  readDepth: 1
})
```

Report what was found:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► SYNC PULL PREVIEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Found in Pencil:

Screens:
  • SCR-01: Login      (node: screen_abc123)
  • SCR-02: Signup     (node: screen_def456)
  • SCR-05: Profile    (node: screen_ghi789) — NEW

Variables: 24 defined
Components: 12 reusable

Proceed with pull? (3 screens via parallel agents)
───────────────────────────────────────────────────────
```
</step>

<step name="sync_pull_shared">
**Orchestrator: Handle shared data (tokens, components)**

The orchestrator handles shared data that applies to all screens:

```javascript
// Update design tokens from Pencil variables
// Write to .harn/design/design-tokens.json

// Update components inventory from reusable components
// Write to .harn/design/COMPONENTS.md
```
</step>

<step name="sync_pull_spawn_agents">
**Orchestrator: Spawn one subagent per screen**

For each screen to pull, spawn a **ui-pencil-screen** agent:

```
For each screen (SCR-XX) to pull:
  Task(
    subagent_type: "general-purpose",
    description: "Pull SCR-XX from Pencil",
    prompt: """
    You are a UI Pencil Screen Agent. Your job is to extract exactly ONE screen
    from a Pencil .pen design file and write/update its specification.

    Read the agent instructions: ./.claude/agents/ui-pencil-screen.md

    OPERATION: pull

    PEN FILE: .harn/design/pencil/app.pen

    SCREEN NODE:
      id: "{node_id}"
      name: "{screen_name}"

    EXISTING SPEC PATH: {path or "none"}

    SPEC TEMPLATE (use this structure for new specs):
    ---
    {inline screen.md template from ui-design/templates/}
    ---

    DESIGN TOKENS (for reference mapping):
    {inline design-tokens.json}

    Steps:
    1. Read the screen node with readDepth: 4 using batch_get
    2. Take a screenshot with get_screenshot
    3. Transform the node tree into the spec template format
    4. Write the spec file to .harn/design/screens/SCR-XX-name.md
    5. Return structured result with spec_path and components found
    """
  )
```

**IMPORTANT:** Launch all screen agents **in parallel**.
</step>

<step name="sync_pull_collect">
**Orchestrator: Collect results and report**

After all subagents complete:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► SYNC PULL COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Extracted via parallel agents:

Screens:
  ✓ .harn/design/screens/SCR-01-login.md (updated)
  ✓ .harn/design/screens/SCR-02-signup.md (updated)
  ✓ .harn/design/screens/SCR-05-profile.md (created)

Shared data (by orchestrator):
  ✓ .harn/design/design-tokens.json (updated)
  ✓ .harn/design/COMPONENTS.md (updated)

Total: 3 screens pulled via parallel agents
───────────────────────────────────────────────────────
```

Update state files:
1. Update `.harn/design/ui-state/pencil-state.json` with sync status
2. Update `.harn/design/UI-REGISTRY.md`
</step>

### Process: Diff

<step name="sync_diff">
Show differences without making changes:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► SYNC DIFF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SCR-01: Login
  Spec                      │ Pencil
  ─────────────────────────────────────────────────
  Primary: #2563EB          │ Primary: #3B82F6 ⚠️
  Card padding: 32px        │ Card padding: 24px ⚠️
  Has "Forgot password"     │ Has "Forgot password" ✓
  Has Google button         │ Missing Google button ⚠️

SCR-02: Signup
  ✓ In sync

Actions:
  • /ui:pencil sync --push SCR-01  — Update Pencil from spec
  • /ui:pencil sync --pull SCR-01  — Update spec from Pencil

───────────────────────────────────────────────────────
```
</step>

</subcommand_sync>

<subcommand_components>

## /ui:pencil components [action]

Manage design system components in Pencil.

### Arguments
- `--list` — List all reusable components
- `--create [name]` — Create new component
- `--create-from-specs` — Create components from COMPONENTS.md
- `--preview [name]` — Screenshot a component
- `--extract [nodeId]` — Convert existing node to reusable component
- `--variants [name]` — Show/create component variants

### Process: List

<step name="components_list">
```javascript
mcp__pencil__batch_get({
  filePath: ".harn/design/pencil/app.pen",
  patterns: [{ reusable: true }],
  readDepth: 2
})
```

Display:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► DESIGN SYSTEM COMPONENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Buttons (4)
  • Button/Primary      ID: btn_primary
  • Button/Secondary    ID: btn_secondary
  • Button/Ghost        ID: btn_ghost
  • Button/Destructive  ID: btn_destructive

Inputs (3)
  • Input/Default       ID: input_default
  • Input/Error         ID: input_error
  • Input/Disabled      ID: input_disabled

Cards (2)
  • Card/Default        ID: card_default
  • Card/Elevated       ID: card_elevated

Actions:
  • /ui:pencil components --preview Button/Primary
  • /ui:pencil components --create "Badge"
  • /ui:pencil components --variants Button/Primary

───────────────────────────────────────────────────────
```
</step>

### Process: Create from Specs

<step name="components_from_specs">
Read COMPONENTS.md and create each:

```javascript
// For each component in spec
const operations = `
btnPrimary=I(dsFrame, { type: "frame", name: "Button/Primary", reusable: true, layout: "horizontal", fill: "#2563EB", padding: [12, 24], cornerRadius: 6 })
btnLabel=I(btnPrimary, { type: "text", name: "label", content: "Button", fill: "#FFFFFF", fontSize: 14, fontWeight: "500" })
`

mcp__pencil__batch_design({
  filePath: ".harn/design/pencil/app.pen",
  operations: operations
})
```

Report with screenshots:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► COMPONENTS CREATED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Created 8 components from COMPONENTS.md:

✓ Button/Primary     [screenshot]
✓ Button/Secondary   [screenshot]
✓ Input/Default      [screenshot]
✓ Input/Error        [screenshot]
✓ Card/Default       [screenshot]
✓ Avatar             [screenshot]
✓ Badge              [screenshot]
✓ Divider            [screenshot]

───────────────────────────────────────────────────────
```
</step>

### Process: Extract

<step name="components_extract">
Convert existing node to reusable component:

```javascript
// Make node reusable
mcp__pencil__batch_design({
  filePath: ".harn/design/pencil/app.pen",
  operations: `U("existingNodeId", { reusable: true, name: "Component/Name" })`
})
```
</step>

### Process: Preview

<step name="components_preview">
```javascript
mcp__pencil__get_screenshot({
  filePath: ".harn/design/pencil/app.pen",
  nodeId: "componentId"
})
```

Show screenshot with component details.
</step>

</subcommand_components>

<subcommand_validate>

## /ui:pencil validate [screen]

Visual validation of designs against specifications.

### Arguments
- `[screen]` — Screen ID (SCR-XX) or "all"
- `--strict` — Fail on any deviation
- `--report` — Generate validation report file

### Process

**For single screen:** Handle directly (no subagent needed).
**For "all" or multiple screens:** Use the orchestrator + subagent pattern — spawn one agent per screen in parallel.

<step name="validate_multi_screen">
**When validating multiple screens (e.g., `validate all`):**

Use the same orchestrator pattern as sync push/pull:

1. Read all specs and get screen node IDs from pencil-state.json
2. Spawn one **ui-pencil-screen** agent per screen with operation: "validate"
3. Each agent captures screenshot, compares to spec, returns validation result
4. Orchestrator collects and presents combined report

```
For each screen:
  Task(
    subagent_type: "general-purpose",
    description: "Validate SCR-XX in Pencil",
    prompt: "... OPERATION: validate, SCREEN SPEC: {...}, NODE ID: {...} ..."
  )
```

Launch all validation agents **in parallel**.
</step>

<step name="validate_load">
**When validating a single screen (direct — no subagent):**

Load spec and capture screenshot:

```javascript
// Read spec
const spec = readFile(".harn/design/screens/SCR-01-login.md")

// Get screenshot
mcp__pencil__get_screenshot({
  filePath: ".harn/design/pencil/app.pen",
  nodeId: "screen_abc123"
})
```
</step>

<step name="validate_compare">
Compare spec requirements to visual:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► VALIDATION: SCR-01 Login
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Screenshot displayed]

Checking against spec...

Layout:
  ✓ Centered card layout
  ✓ Card max-width ~400px
  ✓ Vertical centering

Components:
  ✓ Logo present
  ✓ "Welcome back" heading
  ✓ Email input with label
  ✓ Password input with label
  ✓ Primary "Sign In" button
  ⚠️ "Forgot password?" link — not visible
  ✓ Divider with "or"
  ⚠️ Google button — missing icon

Colors:
  ✓ Primary button matches #2563EB
  ✓ Background matches #F8FAFC
  ⚠️ Muted text appears darker than spec

Overall: 2 issues found

Fix suggestions:
  • Add "Forgot password?" text link below Sign In button
  • Add Google icon to secondary button

───────────────────────────────────────────────────────
```
</step>

<step name="validate_offer_fix">
Offer to fix issues:

```
Would you like to fix these issues?
  • Yes — Generate fix operations
  • No  — I'll fix manually
  • Iterate — Open interactive refinement
```

If yes:
```javascript
mcp__pencil__batch_design({
  filePath: ".harn/design/pencil/app.pen",
  operations: `
forgotLink=I("cardId", { type: "text", content: "Forgot password?", fontSize: 14, fill: "#64748B" })
M(forgotLink, "cardId", 5)
`
})
```
</step>

<step name="validate_report">
If `--report` flag, generate report file:

```markdown
# Validation Report: SCR-01 Login

Date: 2026-01-23
Status: 2 issues

## Screenshot
[embedded or linked]

## Checklist

### Layout
- [x] Centered card layout
- [x] Card max-width ~400px
- [x] Vertical centering

### Components
- [x] Logo present
- [x] "Welcome back" heading
- [x] Email input with label
- [x] Password input with label
- [x] Primary "Sign In" button
- [ ] "Forgot password?" link — **MISSING**
- [x] Divider with "or"
- [ ] Google button icon — **MISSING**

### Colors
- [x] Primary: #2563EB
- [x] Background: #F8FAFC
- [ ] Muted text: appears darker

## Recommendations
1. Add forgot password link
2. Add Google icon to button
3. Adjust muted text color
```
</step>

</subcommand_validate>

<subcommand_iterate>

## /ui:pencil iterate [screen]

Interactive refinement session with immediate visual feedback.

### Arguments
- `[screen]` — Screen ID (SCR-XX) or node ID
- `--from-scratch` — Start with blank screen
- `--from-spec` — Generate initial design from spec first

### Process

<step name="iterate_init">
Initialize session:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► ITERATE: SCR-01 Login
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Starting interactive refinement session.

[Current screenshot displayed]

I'll help you refine this design. You can:
  • Describe changes in natural language
  • Request specific operations
  • Ask for style suggestions
  • Say "done" when finished

What would you like to change?
───────────────────────────────────────────────────────
```
</step>

<step name="iterate_loop">
Refinement loop:

1. **User describes change:**
   "Make the card shadow more prominent"

2. **Generate operations:**
   ```javascript
   U("cardId", { effects: [{ type: "dropShadow", offsetX: 0, offsetY: 4, blur: 12, color: "rgba(0,0,0,0.15)" }] })
   ```

3. **Execute:**
   ```javascript
   mcp__pencil__batch_design({ operations: "..." })
   ```

4. **Show result:**
   ```javascript
   mcp__pencil__get_screenshot({ nodeId: "screenId" })
   ```

5. **Confirm:**
   ```
   [New screenshot]

   Changed: Card shadow increased to 12px blur, 15% opacity

   • Keep — Accept this change
   • Undo — Revert to previous
   • Adjust — Make it even more/less
   • Next — Move on to something else
   ```

6. **Repeat until "done"**
</step>

<step name="iterate_history">
Track changes during session:

```
Session History:
  1. ✓ Increased card shadow
  2. ✓ Changed heading to 28px
  3. ✓ Added forgot password link
  4. ↩ Reverted button color (undone)
  5. ✓ Adjusted input border color

Total changes: 4 applied, 1 reverted
```
</step>

<step name="iterate_complete">
When user says "done":

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► ITERATE COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Session summary:
  Screen: SCR-01 Login
  Changes: 4 applied
  Duration: ~5 minutes

[Final screenshot]

Would you like to:
  • Sync — Update spec from this design
  • Validate — Run validation check
  • Continue — Keep iterating
  • Done — End session

───────────────────────────────────────────────────────
```
</step>

### Natural Language Examples

| User Says | Generated Operation |
|-----------|---------------------|
| "Make the button bigger" | `U(btnId, { height: 48, padding: [14, 28] })` |
| "Add more space between inputs" | `U(formGroup, { gap: 20 })` |
| "The heading should be bolder" | `U(heading, { fontWeight: "700" })` |
| "Center the forgot password text" | `U(forgotLink, { textAlign: "center", width: "fill_container" })` |
| "Add a subtle border to the card" | `U(card, { stroke: "#E2E8F0", strokeWidth: 1 })` |
| "Make everything more compact" | `U(card, { padding: 24, gap: 16 })` |

</subcommand_iterate>

<subcommand_style>

## /ui:pencil style [action]

Explore and apply style guides for design inspiration.

### Arguments
- `--explore` — Browse available style tags
- `--apply [id]` — Apply a specific style guide
- `--tags [tags]` — Get style guide for specific tags
- `--preview` — Preview style without applying

### Process: Explore

<step name="style_explore">
Get available tags:

```javascript
mcp__pencil__get_style_guide_tags()
```

Display grouped by category:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► STYLE GUIDE EXPLORER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Available style tags:

Platform:
  mobile, webapp, website, desktop

Industry:
  saas, ecommerce, fintech, healthcare, education

Aesthetic:
  modern, minimal, bold, playful, professional, elegant

Color:
  dark, light, colorful, monochrome, gradient

Layout:
  dashboard, landing, forms, cards, data-heavy

Select tags to generate a style guide:
───────────────────────────────────────────────────────
```
</step>

<step name="style_get">
Get style guide for selected tags:

```javascript
mcp__pencil__get_style_guide({
  tags: ["saas", "modern", "webapp", "professional", "dashboard"]
})
```

Display style guide:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► STYLE GUIDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Tags: saas, modern, webapp, professional, dashboard

Color Palette:
  Primary:    #2563EB (Blue)
  Secondary:  #64748B (Slate)
  Accent:     #8B5CF6 (Purple)
  Background: #F8FAFC (Light gray)
  Surface:    #FFFFFF (White)

Typography:
  Headings:   Inter, semibold
  Body:       Inter, regular
  Mono:       JetBrains Mono

Spacing:
  Base unit:  4px
  Component:  16px gaps
  Section:    32px gaps

Style Notes:
  • Clean lines, minimal decoration
  • Subtle shadows for depth
  • Rounded corners (6-8px)
  • High contrast for readability
  • Consistent icon style

Apply this style?
  • Yes — Apply to current design
  • Preview — Show example first
  • Different — Try other tags

───────────────────────────────────────────────────────
```
</step>

<step name="style_apply">
Apply style to design:

```javascript
// Update variables
mcp__pencil__set_variables({
  filePath: ".harn/design/pencil/app.pen",
  variables: styleGuide.variables
})

// Update existing elements
mcp__pencil__replace_all_matching_properties({
  filePath: ".harn/design/pencil/app.pen",
  parents: ["screenId"],
  properties: {
    fillColor: styleGuide.colorMapping,
    fontFamily: styleGuide.fontMapping,
    cornerRadius: styleGuide.radiusMapping
  }
})
```
</step>

</subcommand_style>

<subcommand_layout>

## /ui:pencil layout [node]

Debug layout and positioning issues.

### Arguments
- `[node]` — Node ID to inspect (optional, defaults to selected)
- `--problems` — Only show nodes with issues
- `--depth [n]` — How deep to inspect (default: 3)

### Process

<step name="layout_snapshot">
Get layout snapshot:

```javascript
mcp__pencil__snapshot_layout({
  filePath: ".harn/design/pencil/app.pen",
  parentId: nodeId,
  maxDepth: 3,
  problemsOnly: false  // or true for --problems
})
```
</step>

<step name="layout_display">
Display layout structure:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► LAYOUT DEBUG: SCR-01 Login
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Layout Tree:
  Screen (1440×900)
  └── CenterContainer (1440×900, vertical, center)
      └── Card (400×auto, vertical, gap:24)
          ├── Logo (48×48) ✓
          ├── Heading (400×36) ✓
          ├── FormGroup (400×auto, vertical, gap:16)
          │   ├── EmailLabel (400×20) ✓
          │   ├── EmailInput (400×40) ✓
          │   ├── PasswordLabel (400×20) ✓
          │   └── PasswordInput (400×40) ✓
          ├── SignInButton (400×44) ✓
          ├── ForgotLink (400×20) ✓
          ├── Divider (400×1) ✓
          └── GoogleButton (400×44) ✓

No layout issues detected.

───────────────────────────────────────────────────────
```
</step>

<step name="layout_problems">
When problems detected:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► LAYOUT ISSUES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ 2 layout issues found:

1. CLIPPED: PasswordInput
   Parent: FormGroup (400×160)
   Child:  PasswordInput (420×40)
   Issue:  Child width exceeds parent by 20px
   Fix:    U("passwordInput", { width: "fill_container" })

2. OVERFLOW: Card
   Parent: CenterContainer (1440×900)
   Child:  Card (400×950)
   Issue:  Card height exceeds container
   Fix:    Reduce padding or content

Apply fixes?
  • Fix all — Apply suggested fixes
  • Fix #1 — Apply specific fix
  • Manual — I'll fix myself

───────────────────────────────────────────────────────
```
</step>

<step name="layout_find_space">
Helper for finding empty space:

```javascript
mcp__pencil__find_empty_space_on_canvas({
  filePath: ".harn/design/pencil/app.pen",
  nodeId: "existingScreenId",
  width: 1440,
  height: 900,
  padding: 100,
  direction: "right"
})
```

Returns coordinates for new screen placement.
</step>

</subcommand_layout>

<state_management>

## File Location Rule

All `.pen` design files are stored in `.harn/design/pencil/`.

```
.harn/design/pencil/
├── app.pen                 Main design file
├── components.pen          Component library (optional)
└── *.pen                   Additional design files
```

## State Tracking

Track Pencil session state in `.harn/design/ui-state/pencil-state.json`:

```json
{
  "active_file": ".harn/design/pencil/app.pen",
  "last_opened": "2026-01-23T10:30:00Z",
  "screens": {
    "SCR-01": {
      "node_id": "screen_abc123",
      "last_synced": "2026-01-23T10:35:00Z",
      "sync_direction": "push",
      "validated": true,
      "validation_issues": 0
    }
  },
  "components": {
    "Button/Primary": "btn_primary",
    "Input/Default": "input_default"
  },
  "variables_synced": true,
  "last_style_guide": {
    "tags": ["saas", "modern", "webapp"],
    "applied": "2026-01-23T10:32:00Z"
  },
  "iterate_sessions": [
    {
      "screen": "SCR-01",
      "started": "2026-01-23T10:40:00Z",
      "changes": 4,
      "completed": true
    }
  ]
}
```

</state_management>

<error_handling>

## Error Handling

### No .pen File Open
```
⚠️ No Pencil file is currently open.

Run: /ui:pencil open [file]
```

### MCP Connection Failed
```
⚠️ Cannot connect to Pencil MCP server.

Ensure Pencil MCP is running and configured in your Claude Code settings.
```

### Operation Failed
```
⚠️ Operation failed: [error message]

The batch was rolled back. No changes were made.

Debug:
  • /ui:pencil layout — Check for layout issues
  • Review operation syntax
```

### Screen Not Found
```
⚠️ Screen "SCR-05" not found in Pencil file.

Available screens:
  • SCR-01: Login
  • SCR-02: Signup
  • SCR-03: Dashboard

Create it?
  • /ui:pencil sync --push SCR-05
```

</error_handling>

<success_criteria>

## Success Criteria

**Open:**
- File opened or created successfully
- Current state displayed
- Variables synced if requested

**Sync:**
- All specified screens processed
- Screenshots captured for push operations
- Specs updated for pull operations
- Registry updated with node mappings

**Components:**
- Components created/listed successfully
- Preview screenshots generated
- Components marked as reusable

**Validate:**
- Screenshot captured
- All spec requirements checked
- Issues clearly reported
- Fix suggestions provided

**Iterate:**
- Changes executed successfully
- Screenshots shown after each change
- History tracked
- Final state confirmed

**Style:**
- Tags explored or style guide retrieved
- Style applied if requested
- Variables updated

**Layout:**
- Layout tree displayed
- Problems identified
- Fixes suggested or applied

</success_criteria>

<workflow_guidance>

## Next Steps After Pencil Work

After any Pencil subcommand completes, suggest the logical next action:

**After /ui:pencil open:**
- `/ui:pencil sync --push` — Push screen specs into the design
- `/ui:pencil iterate` — Start refining the design interactively

**After /ui:pencil sync:**
- `/ui:pencil validate` — Verify the design matches specs
- `/ui:pencil iterate` — Refine specific elements
- `/ui:realize` — Mark synced screens as realized

**After /ui:pencil iterate (done):**
- `/ui:pencil sync --pull` — Pull changes back into specs
- `/ui:pencil validate` — Check against spec requirements
- `/ui:export` — Export updated designs to other tools

**After /ui:pencil validate:**
- `/ui:pencil iterate` — Fix any issues found
- `/ui:realize` — Mark validated screens as realized
- `/ui:sync` — Sync specs with implementation

**After /ui:pencil style:**
- `/ui:pencil iterate` — Refine after style application
- `/ui:export` — Export the styled design

**General workflow reminder:**
```
───────────────────────────────────────────────────────

## ▶ Typical Flow

/ui:pencil open → sync --push → iterate → validate → sync --pull → /ui:realize

Other commands:
  /ui:export      — Export to Figma, V0, Stitch, or generic
  /ui:sync        — Check drift between specs and code
  /ui:status      — Review overall progress

───────────────────────────────────────────────────────
```

</workflow_guidance>
