# Agent Onboarding File Template

This template works for both `CLAUDE.md` and `AGENTS.md` — they share the same structure. Adapt it to each project. Not every section is needed, and some projects need sections not listed here. Comments in `<!-- -->` are guidance for you (the skill); do not include them in the output.

---

# [Project Name]

<!-- WHY section: 1-3 sentences. What it does, who it's for, why it exists. -->

[One-liner description of the project and its purpose.]

## Agent Behavior

<!-- ALWAYS include this section. Compressed Karpathy-inspired principles. -->
<!-- Full rationale lives in references/karpathy-principles.md — do NOT expand here. -->
<!-- If the existing file already contains equivalent principles under a different heading, do not duplicate. -->

1. **Think before coding** — state assumptions, ask when ambiguous, surface tradeoffs. Don't pick silently between interpretations.
2. **Simplicity first** — minimum code that solves the problem. No speculative abstractions, no unrequested flexibility.
3. **Surgical changes** — touch only what's required. Don't refactor adjacent code. Match existing style.
4. **Goal-driven execution** — define success criteria, loop until verified. Every changed line traces to the request.

## Tech Stack

<!-- WHAT section: Only list what's not obvious from package.json/Cargo.toml/go.mod/Gemfile/etc. -->
<!-- Focus on non-obvious choices and key architectural decisions. -->

- **Language:** [e.g., TypeScript 5.x]
- **Framework:** [e.g., Next.js 14 (App Router)]
- **Database:** [e.g., PostgreSQL via Prisma]
- **Key libraries:** [only the ones that shape how code is written]

## Project Structure

<!-- WHAT section: Only document non-obvious conventions. -->
<!-- Skip boilerplate folders that follow framework defaults. -->

```
src/
├── app/          — Pages and routing
├── lib/          — Shared utilities and business logic
├── components/   — UI components (organized by feature)
└── db/           — Database schema and migrations
```

<!-- Add notes about structural conventions that aren't obvious: -->
<!-- e.g., "Feature folders contain their own types, hooks, and tests" -->

## Development

<!-- HOW section: The commands someone needs on day one. -->

```bash
# Install dependencies
[command]

# Run development server
[command]

# Run tests
[command]

# Run linter/formatter
[command]

# Build for production
[command]
```

<!-- If environment variables are needed, mention .env.example -->
<!-- If database setup is needed, mention briefly and point to docs -->

## Documentation Lookup

<!-- CONDITIONAL: include ONLY if context7 is detected in the project or globally. -->
<!-- Detection heuristics in references/project-tooling-snippets.md. -->
<!-- Omit this section entirely if context7 is not available. -->

For any library, API, framework, SDK, CLI tool, or cloud service documentation lookup, query **context7 first**. Only fall back to web search or training knowledge if context7 has no relevant results.

## UI Generation

<!-- CONDITIONAL: include ONLY if DESIGN.md exists at the project root. -->
<!-- Paths checked: ./DESIGN.md, ./docs/DESIGN.md, ./design/DESIGN.md. -->
<!-- Omit this section entirely if no DESIGN.md is present. -->
<!-- NEVER create DESIGN.md — point users to https://github.com/VoltAgent/awesome-design-md if they want examples. -->

Before generating any UI code, read `DESIGN.md` at the project root. It defines the color palette, typography, spacing scale, component patterns, and do's/don'ts that every UI must match. Match the tokens exactly — don't invent new colors or type scales.

## Key Conventions

<!-- Only include conventions that: -->
<!-- 1. Are NOT enforced by a linter/formatter -->
<!-- 2. Apply to EVERY session (not task-specific) -->
<!-- 3. Would cause real problems if violated -->

- [Convention 1 — e.g., "All API responses use the ApiResponse<T> wrapper type"]
- [Convention 2 — e.g., "Database migrations are created via `prisma migrate dev`, never edited by hand"]
- [Convention 3 — e.g., "Error handling uses the Result pattern, not try/catch"]

## Additional Context

<!-- Progressive disclosure: point to separate files for task-specific knowledge. -->
<!-- Only include this section if there are additional docs. -->
<!-- Use clear descriptions so the agent knows WHEN to read each file. -->

For task-specific guidance, see:

- `agent_docs/testing.md` — Test patterns, fixtures, and integration test setup
- `agent_docs/deploying.md` — Deployment pipeline, staging vs production, rollback
- `agent_docs/api-design.md` — API versioning, error codes, pagination patterns

---

## Sizing Guide

| Project Complexity | Target Lines | Sections to Include |
|---|---|---|
| Small (script, CLI tool) | 45-75 | Description, Agent Behavior, Dev commands, 1-2 conventions |
| Medium (web app, API) | 75-165 | All sections, light progressive disclosure |
| Large (monorepo, platform) | 165-315 | All sections, heavy progressive disclosure |

Baseline: the `Agent Behavior` section adds ~12 lines (always present). Each conditional tooling section (`Documentation Lookup`, `UI Generation`) adds ~5 lines. Progressive disclosure files don't count against this budget.

## Progressive Disclosure File Template

Each file should follow this structure:

```markdown
# [Topic]

<!-- When should the agent read this file? -->

## Overview
[2-3 sentences on what this covers]

## [Main Content Sections]
[Organized by what someone needs to know to do the task]

## Common Pitfalls
[Things that go wrong and how to avoid them]
```

Keep each file focused on one topic. Target 50-150 lines. If a file grows beyond 300 lines, split it or add a table of contents.

## Ordering Rules

Preserve this section order in the generated file:

1. Project name and one-liner
2. **Agent Behavior** (always)
3. Tech Stack
4. Project Structure
5. Development
6. **Documentation Lookup** (conditional: context7)
7. **UI Generation** (conditional: DESIGN.md)
8. Key Conventions
9. Additional Context (optional)

Rationale: behavior guides go first because they apply to every interaction. Tooling sections sit between mechanics and conventions because they modify *how* the agent researches and generates code — they're behavioral modifiers triggered by specific task types.
