---
name: ui:stitch-sync
description: Pull PNG+HTML of each Stitch screen locally, organize per-screen folders, and emit a navigator index.html
argument-hint: "[screen: SCR-XX (optional)]"
allowed-tools: [Read, Write, Bash, Glob, Task, mcp__stitch__list_projects, mcp__stitch__get_screen]
---

<objective>
Sync Stitch-generated screens from the live MCP project down to the local repo. For each screen listed in `.harn/design/ui-state/stitch-state.json`, fetch its rendered HTML and screenshot PNG via `mcp__stitch__get_screen`, reorganize `handoffs/` into per-screen folders (`SCR-XX/` holding the brief + PNG + HTML), and emit a standalone `index.html` navigator so reviewers can click through every screen locally without opening stitch.new. Depends on `/ui:export stitch-mcp` having run first.
</objective>

<context>
@.harn/design/ui-state/stitch-state.json (required — source of truth for project_id + screen_mapping)
@.harn/design/ui-exports/stitch-operations.md (required — presence is the signal that `/ui:export stitch-mcp` has run)
@.harn/design/ui-exports/handoffs/SCR-*-brief.md (required — at least one must exist)
</context>

<process>

<step name="parse_arguments">
## Parse Arguments

Accept an optional single-screen filter:

- No argument → sync **all** screens listed in `stitch-state.json > screen_mapping`.
- `SCR-XX` → sync **only** that screen (must be present in the mapping; otherwise abort with a clear message).

Examples:
- `/ui:stitch-sync` → every screen
- `/ui:stitch-sync SCR-03` → only SCR-03
</step>

<step name="verify_prerequisites">
## Verify Prerequisites

Run these checks **before** touching the filesystem. If any fails, abort with a concise diagnostic and a pointer to the fix — do NOT silently fall through.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► STITCH SYNC — PREREQUISITES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

1. **MCP smoke test** — `mcp__stitch__list_projects({})`. Cheapest read; confirms the Stitch MCP server is reachable and the session is authenticated.
   - On failure (tool unavailable, timeout, auth error): abort with
     > "Stitch MCP indisponível. Verifique o servidor MCP e re-autentique."

2. **Ops log present** — `Read .harn/design/ui-exports/stitch-operations.md`.
   - On missing: abort with
     > "Rode `/ui:export stitch-mcp` primeiro — `stitch-operations.md` ausente."

3. **Briefs present** — `Glob .harn/design/ui-exports/handoffs/SCR*-brief.md` (either at the root of `handoffs/` OR already inside `SCR-XX/` subfolders from a previous sync).
   - If zero matches: abort with
     > "Nenhum brief `SCR-*-brief.md` encontrado. Rode `/ui:export stitch-mcp` primeiro."

4. **State JSON parseable** — `Read .harn/design/ui-state/stitch-state.json`. Extract:
   - `project_id` — must be non-empty
   - `screen_mapping` — dict of `SCR-XX → { screen_id, title, ... }`
   - If invalid or empty: abort with
     > "`stitch-state.json` sem `screen_mapping`. Re-rode `/ui:export stitch-mcp`."

5. **Single-screen argument validation** — if the user passed `SCR-XX`, check it exists in `screen_mapping`. Abort otherwise with the list of valid keys.

If all pass, proceed.
</step>

<step name="plan_scope">
## Plan Scope

Build the list of screens to sync:

```
scope = argument ? [state.screen_mapping[argument]] : Object.entries(state.screen_mapping)
```

For each entry, capture: `screen_key` (e.g. `SCR-01`), `screen_id`, `title`, and the current brief path (either `handoffs/SCR-XX-brief.md` at the root, or `handoffs/SCR-XX/SCR-XX-brief.md` if already reorganized).

Print a one-line plan to the user:

```
Sync scope: 6 screens (SCR-01, SCR-02, SCR-03, SCR-04, SCR-05, SCR-06)
Target:     .harn/design/ui-exports/handoffs/SCR-XX/
```
</step>

<step name="spawn_sync_subagents">
## Spawn per-screen subagents (parallel)

**Why subagents:** each screen requires an `mcp__stitch__get_screen` call (returns a JSON blob ~1KB that includes long base64-style URLs) plus two `curl` downloads. Fanning this out to one `general-purpose` Task per screen keeps the orchestrator's context clean and runs the network work concurrently.

**For 2+ screens:** dispatch all Tasks in a **single message** with multiple `Task` tool calls. For a single screen (user passed a specific `SCR-XX`), handle inline without spawning.

### Per-screen subagent prompt (self-contained)

```
You are syncing ONE Stitch screen down to the local repo.

INPUTS:
- project_id:       [from state.project_id]
- screen_id:        [from state.screen_mapping[SCR-XX].screen_id]
- screen_key:       SCR-XX
- title:            [from state.screen_mapping[SCR-XX].title]
- dest_folder:      .harn/design/ui-exports/handoffs/SCR-XX/
- brief_src_path:   [absolute path of the current SCR-XX-brief.md — either at root of handoffs/ or already inside SCR-XX/]

STEPS:

1. Call mcp__stitch__get_screen:
     name:      projects/<project_id>/screens/<screen_id>
     projectId: <project_id>
     screenId:  <screen_id>
   Extract:
     html_url = response.htmlCode.downloadUrl
     png_url  = response.screenshot.downloadUrl
   If either field is missing → return status: failed with that reason.

2. Create dest folder:
     mkdir -p <dest_folder>

3. Relocate the brief (idempotent):
     If brief_src_path is already <dest_folder>/SCR-XX-brief.md → no-op.
     Else: mv <brief_src_path> <dest_folder>/SCR-XX-brief.md

4. Download HTML with retry (max 3 attempts, 1s sleep between):
     for i in 1 2 3; do
       curl -fsSL -o "<dest_folder>/SCR-XX.html" "<html_url>" && break
       sleep 1
     done
   Record html_path on success, null on failure.

5. Download PNG with retry (same pattern):
     for i in 1 2 3; do
       curl -fsSL -o "<dest_folder>/SCR-XX.png" "<png_url>" && break
       sleep 1
     done
   Record png_path on success, null on failure.

6. Determine status:
     ok      — both files downloaded
     partial — exactly one downloaded
     failed  — neither downloaded (or step 1 returned no URLs)

RETURN a structured block exactly in this format (one per line, no prose):

SYNC_RESULT
screen_key: SCR-XX
title: <title>
status: ok | partial | failed
html_path: <path or null>
png_path: <path or null>
width: <from response or null>
height: <from response or null>
warnings: <comma-separated list, or none>
```

Each Task uses `subagent_type: general-purpose`. The orchestrator collects every `SYNC_RESULT` block and moves on — it does NOT re-call `get_screen` or re-download anything.
</step>

<step name="collect_and_write_index">
## Collect results + write the navigator index.html

After every subagent has returned, aggregate the `SYNC_RESULT` blocks into an array.

### 1. Write `.harn/design/ui-exports/handoffs/index.html`

Standalone page — no CDN dependencies, inline CSS, dark theme to match the project's design system (near-black background, indigo accent). Each card links to `SCR-XX/SCR-XX.html` and shows `SCR-XX/SCR-XX.png` as thumbnail.

Template:

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Stitch screens — [project name]</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 32px 24px;
      font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Inter", sans-serif;
      background: #08090a; color: #f7f8f8;
    }
    h1 { font-size: 28px; font-weight: 590; letter-spacing: -0.5px; margin: 0 0 8px; }
    .meta { color: #8a8f98; font-size: 13px; margin-bottom: 32px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
    .card {
      background: #101114; border: 1px solid #1f2024; border-radius: 8px;
      overflow: hidden; text-decoration: none; color: inherit;
      transition: border-color 120ms, transform 120ms;
      display: flex; flex-direction: column;
    }
    .card:hover { border-color: #5e6ad2; transform: translateY(-2px); }
    .thumb { aspect-ratio: 9 / 16; background: #000; overflow: hidden; }
    .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .thumb.placeholder {
      display: flex; align-items: center; justify-content: center;
      color: #62666d; font-size: 12px;
    }
    .body { padding: 14px 16px 16px; }
    .key { color: #8a8f98; font-size: 11px; font-weight: 510; letter-spacing: 0.04em; text-transform: uppercase; }
    .title { font-size: 15px; font-weight: 510; margin: 4px 0 10px; }
    .status { font-size: 12px; }
    .status.ok      { color: #6cc788; }
    .status.partial { color: #d4b350; }
    .status.failed  { color: #e5484d; }
    .links { margin-top: 12px; display: flex; gap: 12px; font-size: 12px; }
    .links a { color: #8a8f98; text-decoration: none; }
    .links a:hover { color: #f7f8f8; }
  </style>
</head>
<body>
  <h1>Stitch screens</h1>
  <div class="meta">[project name] · synced [YYYY-MM-DD HH:mm] · [N] screens</div>
  <div class="grid">
    <!-- one card per screen, e.g.: -->
    <a class="card" href="SCR-01/SCR-01.html">
      <div class="thumb"><img src="SCR-01/SCR-01.png" alt="SCR-01 preview" loading="lazy"/></div>
      <div class="body">
        <div class="key">SCR-01</div>
        <div class="title">Início — Landing Page</div>
        <div class="status ok">✓ synced</div>
        <div class="links">
          <a href="SCR-01/SCR-01.html">HTML</a>
          <a href="SCR-01/SCR-01.png">PNG</a>
          <a href="SCR-01/SCR-01-brief.md">Brief</a>
        </div>
      </div>
    </a>
    <!-- ... -->
  </div>
</body>
</html>
```

**Rules:**
- If `png_path` is null → emit `<div class="thumb placeholder">(sem preview)</div>` instead of `<img>`.
- If `html_path` is null → the outer `<a class="card">` becomes a `<div class="card">` (no link) and the HTML link in `.links` is omitted.
- Status class tracks the subagent's reported status (`ok`/`partial`/`failed`).
- If the user synced a single screen, still emit the full index covering **all** screens in `screen_mapping` — cards for screens not in scope this run stay as they were (you can re-check files on disk to decide their status).

### 2. Append a "Local sync" section to `stitch-operations.md`

Read the current file, then either append (if no previous local-sync section) or replace the last `## Local sync (...)` section with fresh content:

```markdown
## Local sync ([YYYY-MM-DD HH:mm])

Scope: [all | SCR-XX]
Subagents: [N] ran in parallel

| Screen | HTML | PNG | Status | Warnings |
|--------|------|-----|--------|----------|
| SCR-01 | ✓ | ✓ | ok | — |
| SCR-02 | ✓ | ✗ | partial | png download failed after 3 retries |
| ... |

Navigator: `.harn/design/ui-exports/handoffs/index.html`
```
</step>

<step name="completion">
## Completion Summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► STITCH SYNC COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Scope:    [all | SCR-XX]
Screens:  [ok_count]/[total] fully synced
          [partial_count] partial · [failed_count] failed

Layout:
  handoffs/
  ├── index.html              ← open in browser to browse all screens
  ├── SCR-01/
  │   ├── SCR-01-brief.md
  │   ├── SCR-01.html
  │   └── SCR-01.png
  ├── SCR-02/ …
  └── SCR-06/ …

Log:      .harn/design/ui-exports/stitch-operations.md (§ Local sync)

───────────────────────────────────────────────────────

▶ Next

  Abrir navegador local:
    open .harn/design/ui-exports/handoffs/index.html

  Re-sincronizar uma tela específica (ex: após edit_screens):
    /ui:stitch-sync SCR-03

  Regenerar via MCP antes de re-sincronizar:
    /ui:export stitch-mcp SCR-03   →   /ui:stitch-sync SCR-03
```

If there were any `partial` / `failed` screens, list them explicitly below the summary with the warning text returned by the subagent — the user should know exactly which downloads to retry.
</step>

</process>

<success_criteria>
- Pre-flight fails fast and loudly when `/ui:export stitch-mcp` hasn't run yet or the MCP server is down — no filesystem changes happen in that case.
- Each in-scope screen ends up as a self-contained folder `handoffs/SCR-XX/` containing `SCR-XX-brief.md`, `SCR-XX.html`, and `SCR-XX.png`.
- `handoffs/index.html` exists, is standalone (no CDN, no external assets), renders every screen as a clickable card with preview, and works when opened directly from the filesystem (`file://…`).
- `stitch-operations.md` gains a `## Local sync (...)` section with one table row per synced screen (never duplicates — last section is replaced in place).
- Subagents run in parallel (one Task per screen) when syncing ≥2 screens; single-screen sync stays inline.
- Download errors retry 3× via `curl -fsSL` before downgrading the screen to `partial` or `failed` and surfacing a warning — the run never aborts mid-way because of one flaky URL.
- Re-running the command overwrites PNG/HTML and leaves the `SCR-XX-brief.md` intact in its folder (the `mv` step is a no-op on the second run).
</success_criteria>
