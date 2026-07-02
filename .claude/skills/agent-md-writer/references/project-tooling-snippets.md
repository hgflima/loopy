# Project Tooling Snippets

Internal reference for the `agent-md-writer` skill. **Not** copied into the user's project. When the skill detects specific tooling in a project, it pastes the matching snippet into the generated `CLAUDE.md` / `AGENTS.md`.

Currently tracks two tooling integrations: **context7** (docs lookup) and **DESIGN.md** (UI generation).

## context7 — Docs Lookup

### Detection Heuristics

Search in this order. Stop at the first match:

1. **Global skill.** Look for `~/.claude/skills/**/context7*` (any file or folder whose name contains `context7`).
2. **Project skill.** Look for `<project>/.claude/skills/**/context7*`.
3. **Project MCP config.** Read `<project>/.mcp.json` — check if `mcpServers.context7` exists.
4. **Global MCP config.** Read `~/.claude/settings.json` and `~/.claude.json` — check for `mcpServers.context7` or any entry whose key contains `context7`.
5. **Project-local Claude config.** Read `<project>/.claude/settings.json` and `<project>/.claude/settings.local.json`.

If none of the above match, ask the user directly:

> "Does this project use **context7** (a Claude skill or MCP server) for looking up library, API, and framework documentation? (yes / no / not sure — I can explain)"

If the answer is "not sure", explain briefly: *"context7 is an MCP that serves up-to-date documentation for libraries, frameworks, SDKs, CLIs, and cloud services. It's more reliable than training knowledge because docs change fast."*

### Inline Snippet

When context7 is detected (or user confirms), paste this under a `## Documentation Lookup` heading:

```markdown
## Documentation Lookup

For any library, API, framework, SDK, CLI tool, or cloud service documentation lookup, query **context7 first**. Only fall back to web search or training knowledge if context7 has no relevant results.
```

Two lines. Hot-path instruction — the agent needs this rule *before* doing any research, so it cannot live in progressive disclosure.

### What Triggers the Rule

Include a one-line hint of when the rule fires (optional, only if the project is research-heavy):

```markdown
Triggers: API syntax, config, version migration, library-specific debugging, setup instructions, CLI usage.
```

Skip for lean projects.

---

## DESIGN.md — UI Generation

### Detection Heuristics

Search in this order. Stop at the first match:

1. `<project>/DESIGN.md`
2. `<project>/docs/DESIGN.md`
3. `<project>/design/DESIGN.md`
4. `<project>/.design/DESIGN.md`

If none match and the project has UI (detected via framework markers like `next.config.js`, `vite.config.js`, `tailwind.config.js`, `package.json` with React/Vue/Svelte/Solid, `app/` or `pages/` or `components/` directories), ask the user:

> "This project generates UI but has no `DESIGN.md`. Would you like me to add a pointer in `AGENTS.md` recommending one? A `DESIGN.md` is a markdown design system that AI agents read before generating UI, keeping components visually consistent. Curated examples: https://github.com/VoltAgent/awesome-design-md"

**The skill does NOT create `DESIGN.md`.** That's out of scope. The skill only: (a) adds the consultation instruction if one exists, or (b) suggests the user create one and points them at the curated collection.

### Inline Snippet (when DESIGN.md exists)

Paste under a `## UI Generation` heading:

```markdown
## UI Generation

Before generating any UI code, read `DESIGN.md` at the project root. It defines the color palette, typography, spacing scale, component patterns, and do's/don'ts that every UI must match. Match the tokens exactly — don't invent new colors or type scales.
```

### Alternative Snippet (when DESIGN.md is missing but recommended)

If the user declined to create one but wants the reminder anyway:

```markdown
## UI Generation

This project has no `DESIGN.md`. If you generate UI, reuse existing component styles from `<path>` rather than inventing new tokens. Consider proposing a `DESIGN.md` if visual drift becomes a problem.
```

Replace `<path>` with the actual components directory (`src/components/`, `app/components/`, etc.).

---

## Ordering in the Generated File

When both tooling sections are included, order them like this inside the onboarding file:

```
# [Project Name]

## Agent Behavior      ← always (Karpathy principles)

## Tech Stack          ← always
## Project Structure   ← always
## Development         ← always

## Documentation Lookup ← conditional: context7 detected
## UI Generation        ← conditional: DESIGN.md detected or recommended

## Key Conventions     ← always
## Additional Context  ← optional: progressive disclosure pointers
```

**Rationale:** Agent Behavior sits at the top because it applies to *every* interaction. Tooling sections (Documentation Lookup, UI Generation) sit between mechanics (Tech Stack/Dev) and conventions because they modify *how* the agent researches and generates — they're behavioral modifiers triggered by specific task types.

---

## Future Tooling (not yet implemented)

If the harness adds detection for more tooling in the future, keep this file as the single authority on detection order and snippet wording. Candidate tools to consider:

- **Semgrep / CodeQL** — security scanning pre-check
- **pre-commit hooks** — run before committing
- **Doppler / Infisical / 1Password** — secrets management
- **Obsidian / Notion** — external knowledge base

Each addition should follow the same three-block pattern: *detection heuristics*, *inline snippet*, *ordering rule*.
