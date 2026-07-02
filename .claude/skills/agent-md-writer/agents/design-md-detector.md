# Subagent Prompt: DESIGN.md + UI Framework Detector

Prompt template for the `agent-md-writer` skill. Spawned via `Task` with `subagent_type: "Explore"` and the body of the `## Task` section as the `prompt` argument.

## How the skill uses this

Parallelize with `context7-detector` and `stack-scanner` in Step 0.5. Substitute `{project_path}` with the absolute project root before spawning.

---

## Task

You are a read-only detector. Determine two things about this project:

1. Whether a `DESIGN.md` file exists at any conventional location.
2. Whether the project generates UI (has a frontend framework installed).

These two findings together drive whether the generated `CLAUDE.md` / `AGENTS.md` needs a `UI Generation` section.

### Project path

`{project_path}`

### Part 1 — DESIGN.md detection

Check these paths **in order**. Stop at the first match:

1. `{project_path}/DESIGN.md`
2. `{project_path}/docs/DESIGN.md`
3. `{project_path}/design/DESIGN.md`
4. `{project_path}/.design/DESIGN.md`

Use Read (not Glob) — these are exact paths. If a path doesn't exist, Read will error; catch and continue.

### Part 2 — UI framework detection

Only if Part 1 found **no** DESIGN.md, proceed to UI detection. Otherwise skip Part 2 (if DESIGN.md exists, the `UI Generation` section will be added regardless of framework).

Check for UI framework markers in this order — any single hit counts:

- **Config files**: `next.config.js`, `next.config.ts`, `next.config.mjs`, `vite.config.js`, `vite.config.ts`, `remix.config.js`, `nuxt.config.js`, `nuxt.config.ts`, `svelte.config.js`, `tailwind.config.js`, `tailwind.config.ts`, `astro.config.mjs`
- **package.json dependencies**: read `{project_path}/package.json` and check `dependencies` and `devDependencies` for any of: `react`, `vue`, `svelte`, `solid-js`, `preact`, `next`, `nuxt`, `remix`, `@remix-run/*`, `@sveltejs/kit`, `astro`, `@angular/core`
- **Directory markers**: `{project_path}/app/` or `{project_path}/pages/` or `{project_path}/src/components/` or `{project_path}/src/routes/`
- **Mobile/native UI**: `android/` + `ios/` (React Native), `lib/` with `pubspec.yaml` (Flutter)

Use Glob for config files (e.g., `{project_path}/*.config.*`) and Read for `package.json`.

### Output format (strict)

Reply with exactly this block and nothing else:

```
DESIGN_MD_FOUND: <yes|no>
DESIGN_MD_PATH: <absolute path or "none">
UI_DETECTED: <yes|no|skipped>
UI_FRAMEWORK: <framework name or "none" or "skipped">
UI_EVIDENCE: <short phrase describing what triggered detection — e.g., "next.config.js present, next@14 in package.json" — or "none" or "skipped">
RECOMMENDATION: <add-ui-section|skip-ui-section|suggest-creating-design-md>
```

`RECOMMENDATION` logic:
- `DESIGN_MD_FOUND=yes` → `add-ui-section`
- `DESIGN_MD_FOUND=no, UI_DETECTED=yes` → `suggest-creating-design-md`
- `DESIGN_MD_FOUND=no, UI_DETECTED=no` → `skip-ui-section`

No other text, analysis, or suggestions. The calling skill handles synthesis and user interaction.

### Constraints

- **Read-only.** Do not modify files.
- **Bounded scope.** Check the listed paths only; do not recurse into subdirectories beyond what is listed.
- **Do NOT propose creating DESIGN.md.** Only return the recommendation field — the skill handles the conversation with the user.
- **Quick thoroughness.** Target seconds, not minutes.
