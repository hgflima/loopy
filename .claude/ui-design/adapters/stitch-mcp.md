# Stitch MCP Adapter

Rules for executing UI specifications directly against the Google Stitch MCP server.

This adapter is a **direct-execution sibling** of `stitch.md`. Where `stitch.md` produces prompts the user copy-pastes into stitch.new, `stitch-mcp.md` takes the same prompts and dispatches them through `mcp__stitch__*` tool calls, tracking project/screen/design-system IDs in `.harn/design/ui-state/stitch-state.json`.

<adapter_info>
Service: Google Stitch via MCP
Type: Direct execution (not prompts)
Output: Screens created/updated inside a Stitch project via MCP tool operations
Strength: Eliminates copy-paste; syncs design tokens as a design system; idempotent re-runs via state file
Best For: Teams that already use Stitch and want prompts to land in the service automatically
Limitations: Requires the Stitch MCP server to be running; subject to Stitch's own rate/feature limits
Key Difference: Shares the prompt builder with `stitch.md` so a screen rendered via MCP is visually identical to one a human would generate by pasting the same text into stitch.new
</adapter_info>

<capability_matrix>

| Capability | Support | Notes |
|------------|---------|-------|
| Full screens | Excellent | Via `generate_screen_from_text` |
| Individual components | N/A | Stitch generates full screens, not isolated components |
| Iteration / refinement | Excellent | Via `edit_screens` on an existing screen |
| Variants | Good | Via `generate_variants` (opt-in) |
| Design tokens import | Excellent | Via `create_design_system` / `apply_design_system` |
| Dark mode | Good | Emit both modes as separate tokens in the design system |
| Responsive layouts | Inherited from Stitch | Mention breakpoints in the screen prompt |
| Reverse sync (pull) | Not supported | Stitch is write-only from our side — use `/ui:import-design` if you export from Stitch manually |

</capability_matrix>

<execution_model>

## Direct Execution vs Prompts

| Aspect | `stitch` adapter | `stitch-mcp` adapter |
|--------|------------------|----------------------|
| Output | `.harn/design/ui-exports/stitch-prompts.md` | Live screens in a Stitch project |
| Execution | Manual (copy/paste into stitch.new) | Automatic (MCP calls) |
| Iteration | Re-paste with refinement text | `edit_screens` with the refinement text |
| Token sync | Hex values embedded in prompt | `create_design_system` + `apply_design_system` |
| State | None | `.harn/design/ui-state/stitch-state.json` |
| Idempotency | Regenerates file each run | Reuses project + screen IDs across runs |

## Execution Flow

```
Smoke test MCP → Resolve project → Sync design system → Per screen: generate or edit → Persist IDs
                      ↓                      ↓                          ↓
              list_projects /        create_design_system /    generate_screen_from_text /
              create_project         update_design_system +     edit_screens
                                     apply_design_system
```

</execution_model>

<smoke_test>

## MCP Availability Check (Required Before Any Operation)

Before invoking any other `mcp__stitch__*` tool, the orchestrator MUST confirm the Stitch MCP server is reachable. Use `list_projects` as the smoke test — it is the cheapest read and returns fast when the server is healthy.

```javascript
mcp__stitch__list_projects({ /* minimal args */ })
```

**Success signal:** tool returns (even if the list is empty). Proceed.

**Failure signals (any of):**
- Tool not available / not registered in this session
- Timeout (>10s without response)
- Error response from the MCP server (auth, rate limit, server down)

**On failure**, do NOT silently fall through. The orchestrator must surface the failure to the user via `AskUserQuestion` with exactly two options:

1. **Abortar** — Stop the export. Write nothing. Emit a concise diagnostic (what failed, suggested fix: check the Stitch MCP server is running / re-authenticate).
2. **Cair para modo stitch (prompts .md)** — Fall back to the normal `stitch` adapter flow: generate `.harn/design/ui-exports/stitch-prompts.md` as if the user had run `/ui:export stitch`, and annotate the output clearly so the user knows MCP was unavailable.

Why interactive fallback rather than automatic fallback: the user's intent when choosing `stitch-mcp` is specifically to execute via MCP. A silent fallback would hide a broken setup and produce a file the user thought was a live Stitch screen. Asking once preserves both convenience and transparency.

</smoke_test>

<operation_flow>

## 1. Resolve the Project

Stitch projects live for the whole UI-design session, not per screen. The orchestrator keeps one project per UI spec and reuses its ID across runs.

```javascript
// Orchestrator step (runs once per export)
const state = readStateOr({
  project_id: null,
  project_name: "<derived from UI-SPEC.md title or directory basename>",
  design_system_id: null,
  tokens_hash: null,
  screen_mapping: {}
});

// Try to reuse an existing project if we have the ID
let project;
if (state.project_id) {
  project = mcp__stitch__get_project({ project_id: state.project_id });
}

// Fall back to name lookup (handles state file loss / fresh clone)
if (!project) {
  const all = mcp__stitch__list_projects({});
  project = all.find(p => p.name === state.project_name);
}

// Create if still missing
if (!project) {
  project = mcp__stitch__create_project({
    name: state.project_name,
    /* optional: description, default device, etc. from UI-CONTEXT.md */
  });
  state.project_id = project.id;
}
```

Persist `project.id` and `project.name` immediately to `stitch-state.json` so a subsequent crash mid-run still leaves us idempotent on retry.

## 2. Sync the Design System

Design tokens in `design-tokens.json` are the source of truth. The orchestrator hashes the file (SHA-1 of bytes, excluding whitespace-only diffs if convenient) and compares against `state.tokens_hash`.

```javascript
const currentHash = sha1(readFile(".harn/design/design-tokens.json"));

if (!state.design_system_id) {
  // First run — create
  const ds = mcp__stitch__create_design_system({
    project_id: project.id,
    name: `${state.project_name} DS`,
    tokens: convertTokensForStitch(designTokensJson) // see <token_mapping>
  });
  state.design_system_id = ds.id;
} else if (state.tokens_hash !== currentHash) {
  // Tokens changed — update
  mcp__stitch__update_design_system({
    design_system_id: state.design_system_id,
    tokens: convertTokensForStitch(designTokensJson)
  });
} else {
  // No change — just re-apply (idempotent, cheap)
  mcp__stitch__apply_design_system({
    project_id: project.id,
    design_system_id: state.design_system_id
  });
}

state.tokens_hash = currentHash;
```

Always call `apply_design_system` at least once per run even when tokens are unchanged — this guarantees that any newly-created screens below pick up the current DS, and it is cheap.

## 3. Per-Screen Dispatch (Create or Update)

For each screen in scope (all screens, or the filtered subset):

```javascript
const existing = state.screen_mapping[screenId]; // { screen_id, variant_ids, last_update, version } | undefined

// Build the natural-language prompt using the SAME rules as the `stitch` adapter.
// This is critical — it guarantees parity between paste-mode and mcp-mode.
// See <prompt_builder> below.
const promptText = buildStitchPrompt(screenSpec, designTokens);

if (!existing) {
  // Fresh screen
  const created = mcp__stitch__generate_screen_from_text({
    project_id: project.id,
    design_system_id: state.design_system_id,
    name: screenSpec.title,      // e.g., "SCR-01 Login"
    text: promptText
  });
  state.screen_mapping[screenId] = {
    screen_id: created.id,
    variant_ids: [],
    last_update: nowIso(),
    version: 1
  };
} else {
  // Existing screen — prefer edit over regenerate so we preserve variant IDs and manual tweaks
  mcp__stitch__edit_screens({
    project_id: project.id,
    screen_ids: [existing.screen_id],
    instructions: buildEditInstructions(screenSpec, previousSpecSnapshot)
      // "instructions" should be a short diff-focused text:
      // "Update the primary CTA label to 'Continuar'. Keep the rest of the layout unchanged."
  });
  existing.last_update = nowIso();
  existing.version += 1;
}
```

### Why edit instead of regenerate on update

Stitch's `generate_screen_from_text` creates a new screen — it does not replace the previous one. Using it on an update path would orphan the old screen and lose any variants. `edit_screens` is the correct primitive for iteration and preserves stable IDs that downstream steps (Figma export, realization tracking) depend on.

## 4. Variants (Opt-In)

Variant generation is off by default because it multiplies screen count in the user's Stitch project. Enable only when the user explicitly asks (flag on the command, or the orchestrator surfaces a one-time prompt).

```javascript
if (generateVariantsForThisScreen) {
  const variants = mcp__stitch__generate_variants({
    project_id: project.id,
    screen_id: state.screen_mapping[screenId].screen_id,
    count: 3 // reasonable default
  });
  state.screen_mapping[screenId].variant_ids = variants.map(v => v.id);
}
```

## 5. Persist State

After every screen, write `stitch-state.json` (not only at the end). A partial run leaves enough state that the next invocation resumes cleanly.

</operation_flow>

<prompt_builder>

## Parity with the `stitch` Adapter

The text sent to `generate_screen_from_text` (and the instructions sent to `edit_screens`) MUST be generated by the same builder the `stitch` adapter uses to produce `stitch-prompts.md`. This is a hard invariant — a screen rendered via MCP must be indistinguishable from one a human generates by pasting the same prompt into stitch.new.

Concretely:

- **For create (`generate_screen_from_text.text`)**: use the `<transformation_rules>` and `<token_mapping>` sections of `.claude/ui-design/adapters/stitch.md`. Same 7-step structure (context → layout → components → tokens → style → states → responsive hints).
- **For update (`edit_screens.instructions`)**: use the `<iteration_guidance>` patterns from `.claude/ui-design/adapters/stitch.md`. Keep the text short and diff-focused — Stitch's edit endpoint works best on "change X to Y" instructions, not full regenerated prompts.

Do NOT inline a second copy of the transformation rules in this adapter — they belong in one place (`stitch.md`) and both flows depend on them.

</prompt_builder>

<token_mapping>

## design-tokens.json → Stitch Design System

Stitch's design-system payload expects a flat dictionary of named tokens with role labels. Convert from the W3C-format `design-tokens.json`:

```javascript
function convertTokensForStitch(tokens) {
  const result = { colors: {}, typography: {}, spacing: {}, radii: {}, shadows: {} };

  // Colors — flatten to role: hex pairs, keep dark-mode variants alongside
  for (const [role, value] of flattenColors(tokens.color)) {
    result.colors[role] = {
      light: value.$value,
      dark: value.$extensions?.mode?.dark ?? null
    };
  }

  // Typography — family + scale
  result.typography.families = tokens.typography.fontFamily; // { sans, mono, serif? }
  result.typography.scale = tokens.typography.fontSize;      // { base, sm, lg, h1, h2, ... }

  // Spacing, radii, shadows — pass through as name: value
  result.spacing = tokens.spacing;
  result.radii   = tokens.border?.radius ?? {};
  result.shadows = tokens.shadow ?? {};

  return result;
}
```

The actual schema Stitch expects is opaque to this adapter — pass the tokens as structured data and let the MCP tool decide the mapping. If `create_design_system` rejects the shape, surface the error with the raw response; do not silently strip fields.

### Dark Mode

When any color has `$extensions.mode.dark`, pass both values to Stitch and let the design system store them as a theme pair. If Stitch's current MCP schema only accepts a single palette, emit a WARN in `stitch-operations.md` explaining that dark-mode tokens were collapsed to light, and ask the user whether to create a sibling "dark" design system.

</token_mapping>

<iteration_guidance>

## Refining an Existing Screen

Prefer `edit_screens` with terse, diff-style instructions:

| Intent | Good instruction |
|--------|------------------|
| Change a label | `"Update the primary CTA label to 'Continuar'. Keep everything else unchanged."` |
| Recolor an element | `"Change the header background to #0B3D91. Do not touch spacing or typography."` |
| Reflow a section | `"Move the footer links above the legal text. Keep their styles."` |
| Add a missing element | `"Add a 'Forgot password?' link centered below the submit button, 14px, muted color."` |
| Fix spacing | `"Increase the gap between form fields to 20px."` |

Rules:
- One concern per call when possible. Two independent edits in one instruction often confuse Stitch.
- Never send a full regenerated prompt as `edit_screens.instructions` — that defeats the purpose and frequently produces worse results than `generate_screen_from_text` would. If the spec changed substantially (wireframe rewrite, new sections), delete the screen server-side and regenerate via `generate_screen_from_text` — track this as a `version` bump in state.

## Regenerate vs Edit Heuristic

| Trigger | Action |
|---------|--------|
| Spec's wireframe block rewritten | Delete + regenerate (new `version`) |
| Components list changed by >30% | Delete + regenerate |
| Token values changed but layout identical | `update_design_system` only; no per-screen call |
| Small copy / color / spacing edits | `edit_screens` |

The orchestrator computes this heuristic from the spec's modification timestamp and a cheap structural diff against the last-exported version (stored in `.harn/design/ui-state/stitch-state.json` under `screen_mapping[SCR-XX].spec_snapshot`).

</iteration_guidance>

<state_file>

## `.harn/design/ui-state/stitch-state.json`

Source of truth for idempotency and per-screen versioning. Written by the orchestrator after every successful MCP call.

```json
{
  "project_id": "prj_abc123",
  "project_name": "Recarga CIA",
  "design_system_id": "ds_xyz789",
  "tokens_hash": "a1b2c3d4...",
  "last_sync": "2026-04-17T14:32:00Z",
  "screen_mapping": {
    "SCR-01": {
      "screen_id": "scr_001",
      "variant_ids": [],
      "last_update": "2026-04-17T14:32:10Z",
      "version": 2,
      "spec_snapshot_hash": "e5f6..."
    },
    "SCR-02": {
      "screen_id": "scr_002",
      "variant_ids": ["scr_002_v1", "scr_002_v2"],
      "last_update": "2026-04-17T14:32:18Z",
      "version": 1,
      "spec_snapshot_hash": "9a8b..."
    }
  }
}
```

### Fields

| Field | Purpose |
|-------|---------|
| `project_id` | Stable Stitch project ID — reused across runs |
| `project_name` | Human name; used for fallback lookup if ID is lost |
| `design_system_id` | Stable DS ID — one per project |
| `tokens_hash` | SHA-1 of `design-tokens.json` at last sync; decides create vs update vs apply |
| `last_sync` | ISO timestamp of last successful orchestrator run |
| `screen_mapping[SCR-XX].screen_id` | Stable Stitch screen ID — required for `edit_screens` / `generate_variants` |
| `screen_mapping[SCR-XX].variant_ids` | IDs returned by `generate_variants` |
| `screen_mapping[SCR-XX].version` | Incremented on each successful edit or regenerate — mirrored in `UI-REGISTRY.md` |
| `screen_mapping[SCR-XX].spec_snapshot_hash` | SHA-1 of spec file at last export; used by the regenerate-vs-edit heuristic |

The file is also referenced by `coordinator-state.json` under `exports_generated.stitch_mcp.state_file` so the coordinator knows where to look without duplicating content.

</state_file>

<orchestrator_pattern>

## Multi-Screen Orchestrator

Same shape as the Pencil orchestrator (see `.claude/ui-design/adapters/pencil.md` `<orchestrator_pattern>` — that document is authoritative for the pattern itself).

Stitch-specific adaptations:

1. **Orchestrator owns** (runs once per export):
   - Smoke test (`list_projects`)
   - Project resolve / create
   - Design system create / update / apply
   - Read `stitch-state.json` and compute screen-level plan (create vs edit vs skip)
   - After subagents finish: write `stitch-state.json`, `stitch-operations.md`, update `UI-REGISTRY.md` and `coordinator-state.json`

2. **Per-screen subagents** (`ui-stitch-screen`), one Task per screen, launched in parallel for 2+ screens:
   - Receive the already-built prompt text (no prompt-building work in the subagent)
   - Receive `project_id`, `design_system_id`, and optional `screen_id` for updates
   - Call exactly one of `generate_screen_from_text` or `edit_screens` + optional `generate_variants`
   - Return a structured result the orchestrator can merge into `screen_mapping`

3. **Single-screen path**: if only one screen is in scope, handle inline without spawning — the Task overhead isn't worth it.

See `.claude/agents/ui-stitch-screen.md` for the subagent's full context protocol and output format.

</orchestrator_pattern>

<operations_log>

## `.harn/design/ui-exports/stitch-operations.md`

Human-readable log of what happened in the last run. Rewritten on every export (not append-only — the state file carries history).

```markdown
# Stitch MCP Operations Log

Generated: 2026-04-17T14:32:00Z
Project: Recarga CIA (prj_abc123)
Design System: Recarga CIA DS (ds_xyz789)
Screens in scope: 6
Method: Parallel subagents (1 per screen)

## Pre-flight
- ✓ MCP smoke test (list_projects) — OK in 420ms
- ✓ Project resolved — reused existing prj_abc123
- ✓ Design system — tokens unchanged, apply_design_system only

## Per-screen results

| Screen | Action | Screen ID | Version | Variants | Issues |
|--------|--------|-----------|---------|----------|--------|
| SCR-01 | edit | scr_001 | 2 | 0 | — |
| SCR-02 | edit | scr_002 | 1 | 2 | — |
| SCR-03 | create | scr_003 | 1 | 0 | — |
| SCR-04 | skip (no changes) | scr_004 | 1 | 0 | — |
| SCR-05 | create | scr_005 | 1 | 0 | DS applied pre-creation |
| SCR-06 | regenerate | scr_006 | 3 | 0 | Wireframe rewritten |

## Warnings
_(none)_

## Next steps
- Review screens in the Stitch UI: [project URL]
- To iterate on one screen: `/ui:export stitch-mcp SCR-01`
- To force regenerate: delete the entry from stitch-state.json and re-run
```

</operations_log>

<best_practices>

**Do:**
- Always run the MCP smoke test before any other call
- Persist `stitch-state.json` after each screen, not only at the end
- Reuse the `stitch.md` prompt builder verbatim
- Prefer `edit_screens` on update paths (preserves IDs and variants)
- Hash `design-tokens.json` to avoid unnecessary design-system updates
- Log the Stitch project URL in the completion summary so the user can jump in
- Respect the user's choice on variants — off by default

**Don't:**
- Silently fall back to the prompts-only flow when MCP fails — always ask
- Regenerate a screen when a `edit_screens` call would do
- Inline a second copy of the prompt-building logic — live in `stitch.md`
- Call `update_design_system` on every run — gate on `tokens_hash`
- Modify state files or `UI-REGISTRY.md` from inside the per-screen subagent — that is the orchestrator's job
- Exceed the user's scope (e.g., touch other screens when they asked for SCR-01 only)

</best_practices>

<diff_from_stitch>

## Key Differences: `stitch` vs `stitch-mcp`

| Aspect | `stitch` | `stitch-mcp` |
|--------|----------|--------------|
| Artefact | `stitch-prompts.md` | Live Stitch project |
| User effort | Copy/paste per screen | None after invocation |
| Pre-reqs | None | Stitch MCP server running |
| Iteration | Re-run command, re-paste | `edit_screens` on existing ID |
| Token sync | Embedded in each prompt | Central design system |
| State | None | `stitch-state.json` |
| Failure mode | Writes partial file | Asks user (abort or fallback) |

Use `stitch-mcp` when the MCP server is available and the team actually uses Stitch. Use `stitch` when you need a reviewable text artefact (code reviews, handoff to contractors without MCP access, documentation).

</diff_from_stitch>
