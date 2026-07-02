---
name: agent-md-writer
description: >
  Generate and maintain high-quality CLAUDE.md and AGENTS.md files for any project.
  These files serve the same purpose — onboarding a code agent to a codebase — but target
  different agents: CLAUDE.md for Claude Code, AGENTS.md for others (Codex, Cursor, Gemini
  CLI, OpenCode, Google Stitch, etc.). Every generated file includes Karpathy-inspired
  behavior principles, and when available, context7-first docs lookup and DESIGN.md
  consultation for UI generation.
  Use this skill whenever the user wants to create, audit, or improve either file, set up
  progressive disclosure with agent_docs/, migrate a legacy AGENT.md to AGENTS.md, or asks
  how to make any AI code agent work better with their codebase. Also trigger on mentions
  of "agent harness", "project instructions", "agent onboarding", "CLAUDE.md", "AGENTS.md",
  or "AGENT.md".
---

# Agent MD Writer

You are a specialist in writing high-quality agent onboarding files — the single highest-leverage file in any AI-assisted codebase.

## What Are These Files?

**CLAUDE.md** and **AGENTS.md** serve the exact same purpose: they onboard a code agent to a project. The only difference is which agent reads them:

- **CLAUDE.md** → Claude Code
- **AGENTS.md** → Other code agents (Codex, Cursor, Gemini CLI, OpenCode, Google Stitch, etc.)

The structure, principles, and best practices are identical. Both answer the same questions: what is this project, how is it built, how should the agent *behave*, and what conventions matter. When this skill says "agent onboarding file" it means either one.

**Note on naming:** `AGENTS.md` (plural) is the emerging standard used by Codex, Cursor, and Google Stitch. The older singular `AGENT.md` still exists in some projects — when you encounter it, propose renaming to `AGENTS.md` as part of any audit or update.

## Why This Matters

LLMs are stateless. Every session starts from zero. The agent onboarding file is the only mechanism for a code agent to learn your project's purpose, structure, conventions — and crucially, *how to behave*. But there's a hard constraint: frontier LLMs can follow roughly 150–200 instructions with reasonable consistency. Claude Code's system prompt already uses ~50 of those. That leaves ~100–150 instructions for your entire project context. Every line must earn its place.

## Core Principles

**Conciseness over completeness.** Best-in-class onboarding files are under 75 lines (small projects) to 315 lines (large). If you're writing more, content likely belongs in separate files (progressive disclosure) or in tooling (linters, formatters).

**WHY → BEHAVIOR → WHAT → HOW.** Structure around four questions:
- **WHY** — What does this project do and what problem does it solve? (1-3 sentences)
- **BEHAVIOR** — How should the agent act? (Karpathy principles — always present)
- **WHAT** — Tech stack, folder structure, key architectural decisions
- **HOW** — How to build, test, deploy. The commands someone needs on day one.

**Behavior over mechanics.** An onboarding file that only lists the tech stack misses the most valuable leverage: telling the agent *how to act*. Linters catch style, type-checkers catch types, but nothing in the toolchain catches an agent silently picking an interpretation, overengineering, refactoring adjacent code, or failing to define "done". Those holes are patched by the `Agent Behavior` section (Karpathy-inspired principles — see `references/karpathy-principles.md`). Always include it.

**Progressive disclosure.** Don't tell the agent everything upfront. Tell it where to find information so it can look it up when relevant. Store task-specific docs in a directory (e.g., `agent_docs/`, `docs/agent/`) and reference them with clear descriptions of when to read each file.

**Don't be a linter.** Style rules like "use 2-space indentation" or "always add trailing commas" belong in deterministic tools (ESLint, Prettier, Biome, Ruff). Never send an LLM to do a linter's job — it's unreliable and wastes instruction budget.

**Universal applicability.** Only include information relevant to every session. If something only matters when working on the auth module, it belongs in a progressive-disclosure file.

**Deliberate authorship.** Avoid auto-generating with `/init`. Every line should be intentionally written and regularly reviewed. The best source of improvements is code review — every reviewer comment on an AI-assisted PR signals missing context.

## Workflow

Follow these steps. Ask questions **one at a time**. When presenting choices, use **numbered options** and ask the user to reply with the number.

### Step 0: Detect What Exists

Scan the project root for `CLAUDE.md`, `AGENTS.md`, and `AGENT.md` (legacy singular). Then follow the appropriate path:

**Legacy `AGENT.md` detected → Propose rename first:**

"I found `AGENT.md` (singular) in your project. The emerging standard is `AGENTS.md` (plural), used by Codex, Cursor, Google Stitch, and others. Would you like me to:

1. Rename `AGENT.md` → `AGENTS.md` and then audit/update it
2. Keep the singular `AGENT.md` name (not recommended)
3. Create a new `AGENTS.md` from scratch and delete the old one after review"

Default recommendation: option 1.

**Neither exists → Ask what to create:**

"Your project doesn't have an agent onboarding file yet. Which would you like to create?

1. CLAUDE.md only (for Claude Code)
2. AGENTS.md only (for other code agents like Codex, Cursor, Gemini CLI, OpenCode, Google Stitch)
3. Both (I'll write the content once and set up both files)"

If the user picks option 3: write the full content in AGENTS.md, then create a CLAUDE.md that references it (see "Dual-file setup" below).

**Only CLAUDE.md exists → Audit and improve it.** Proceed to Step 0.5, then Step 1 (Audit mode).

**Only AGENTS.md (or renamed AGENT.md) exists → Audit and improve it.** Proceed to Step 0.5, then Step 1 (Audit mode).

**Both exist → Consolidate.** Read both files. Analyze the content of each. Then:
1. Merge all unique content into AGENTS.md as the canonical source of truth
2. Rewrite CLAUDE.md as a thin reference to AGENTS.md
3. Present the user with what changed and why

This eliminates duplication. AGENTS.md becomes the single source because it's agent-agnostic. CLAUDE.md simply points to it.

#### Dual-file setup

When both files exist, CLAUDE.md should look like this:

```markdown
# Project Onboarding

This project's agent onboarding documentation lives in AGENTS.md to support multiple code agents.

See [AGENTS.md](./AGENTS.md) for all project context, conventions, and workflows.
```

That's it — 3 lines. All the real content lives in AGENTS.md.

### Step 0.5: Detect Project Tooling (parallelized)

Before proceeding, check which tooling integrations the project has. Findings drive which conditional sections appear in the generated file.

**Delegation strategy.** This step runs up to three detection subagents **in parallel** to protect the main context window from filesystem noise. The prompt templates live in the skill's own `agents/` subdirectory — do not invoke them as standalone agents; read the prompt file, substitute placeholders, and pass the content to `Task` with `subagent_type: "Explore"`.

| Purpose | Prompt file | Substitutions |
|---|---|---|
| context7 availability | `agents/context7-detector.md` | `{project_path}` |
| DESIGN.md + UI framework | `agents/design-md-detector.md` | `{project_path}` |
| Tech stack + folder structure | `agents/stack-scanner.md` | `{project_path}` (only in Create/Update modes, not Audit) |

**Spawn all applicable subagents in a single message** (multiple `Task` tool calls in one response). Do not run them sequentially — that defeats the purpose of the parallelization.

While the subagents run, you may ask Round 1 (WHY) of Step 2 so the human conversation overlaps the detection work.

Full heuristics (what the detectors check and where) live in `references/project-tooling-snippets.md`. You should rarely need to read them — the detectors encode the heuristics internally.

**After detection returns**, parse the structured reports and present a short summary to the user:

```
Tooling detection:
- context7: [detected via <method> at <path> / not detected]
- DESIGN.md: [found at <path> / not present but UI detected (<framework>) / not applicable]
- Stack: <language> / <framework> / <runtime>  (only if stack-scanner ran)
```

If the `design-md-detector` reports `RECOMMENDATION=suggest-creating-design-md`, ask the user:

*"This project generates UI but has no `DESIGN.md`. A `DESIGN.md` is a markdown design system that AI agents read before generating UI, keeping components visually consistent. Curated examples: https://github.com/VoltAgent/awesome-design-md. Want me to add a reminder in the onboarding file?"*

**The skill does NOT create `DESIGN.md`.** Out of scope. Only add the consultation instruction if one exists, or optionally add a reminder if the user wants it.

**When to skip subagents.** For very small projects (single-file scripts, throwaway prototypes) or when you are confident of the detection state from the current conversation context, you may do the checks inline without spawning subagents. Use judgment — the subagent overhead is ~5–20s startup, so for a file you've already scanned this session, inline is cheaper.

### Step 1: Detect Mode

For whichever file you're working on:

1. If it exists, read it and assess against the core principles → **Audit & Improve** mode
2. If it doesn't exist → **Create** mode

**Audit mode** — present a diagnostic report covering:
- Line count vs. the 75/165/315 target (small/medium/large)
- Whether it follows WHY/BEHAVIOR/WHAT/HOW structure
- **Whether `Agent Behavior` section is present** (flag as missing if absent)
- **Whether `Documentation Lookup` section is present** (flag only if context7 was detected)
- **Whether `UI Generation` section is present** (flag only if DESIGN.md exists)
- **Whether the file is named `AGENT.md` (legacy singular)** — flag for rename
- Linter-like rules that should move to tooling
- Task-specific content that should move to progressive disclosure files
- Missing critical information (build commands, test commands, folder structure)
- Estimated instruction count vs. the ~150 budget

**Delegation for large files.** If the target file is **≥100 lines**, delegate the analysis to a subagent rather than reading it inline. Use the prompt template at `agents/audit-analyzer.md`, substituting `{target_file}` (absolute path), `{context7_available}`, and `{design_md_exists}` from the Step 0.5 results. Spawn via `Task` with `subagent_type: "Explore"`. The subagent returns a structured diagnostic that you pass through to the user with light synthesis.

For files under 100 lines, do the audit inline — subagent overhead isn't justified.

Then ask: "Would you like me to rewrite this file based on these findings?"

### Step 2: Gather Project Context (Create mode)

Ask these questions **one at a time**, waiting for each answer. Skip any question where the answer is obvious from the codebase (check for package.json, Cargo.toml, pyproject.toml, go.mod, Gemfile, etc.).

**Round 1 — WHY:**
"What does this project do, in 1-2 sentences? Who is it for?"

**Round 2 — WHAT:**
"What's the tech stack? (language, framework, database, key libraries)"

If you can read the codebase, propose what you found and ask the user to confirm or correct.

**Round 3 — WHAT (structure):**
"Are there any non-obvious folder conventions or architectural patterns I should know about?"

If you can read the codebase, propose a summary and ask for corrections.

**Round 4 — HOW:**
"What are the essential commands for building, testing, and running this project?"

**Round 5 — Conventions:**
"Are there any critical conventions that aren't enforced by tooling? (e.g., naming patterns, API design rules, commit message format)"

Push back gently if the user lists things a linter should handle.

**Round 6 — Progressive Disclosure:**
"Are there task-specific workflows the agent should know about only when relevant? (e.g., deployment, migrations, API design guidelines, testing strategies)"

For each one, propose creating a separate file referenced from the onboarding file.

**Note on Agent Behavior:** Do NOT ask the user whether to include the `Agent Behavior` section. It is always included by default — it's the highest-leverage part of the file. If the user explicitly asks to omit it, honor that, but don't prompt for a choice.

### Step 3: Generate the File

Use the template in `references/template.md` as starting structure. Adapt it to the project — not every section is needed, and some projects need sections not in the template.

**Sections to always include:**
1. Project name + one-liner (WHY)
2. **`Agent Behavior`** — compressed Karpathy principles (~12 lines, pasted from `references/karpathy-principles.md` inline snippet). Always present.
3. Tech Stack
4. Project Structure
5. Development

**Conditional sections (based on Step 0.5 findings):**
- **`Documentation Lookup`** — include ONLY if context7 was detected or confirmed. Paste the 2-line snippet from `references/project-tooling-snippets.md`.
- **`UI Generation`** — include ONLY if `DESIGN.md` exists at project root. Paste the 2-line snippet from `references/project-tooling-snippets.md`.

**Ordering** (enforced):
1. Title + one-liner
2. Agent Behavior
3. Tech Stack
4. Project Structure
5. Development
6. Documentation Lookup (conditional)
7. UI Generation (conditional)
8. Key Conventions
9. Additional Context (optional, progressive disclosure)

**Quality checks before presenting:**

1. **Line count** — Under 315? Small project should be under 75.
2. **Agent Behavior present** — all 4 Karpathy principles in one compressed block, not duplicated in other sections.
3. **Conditional sections match detection** — `Documentation Lookup` only if context7 detected; `UI Generation` only if DESIGN.md exists.
4. **No linter rules** — All style rules delegated to tooling?
5. **Progressive disclosure** — Task-specific content in separate files?
6. **Build/test commands** — Can someone build and test from this alone?
7. **No redundancy** — Nothing said twice?
8. **Filename correct** — `AGENTS.md` (plural), not `AGENT.md`, unless user explicitly chose the legacy name.

### Step 4: Progressive Disclosure Setup

If the user mentioned task-specific workflows, generate the directory and files:

```
agent_docs/
├── building.md       — Environment setup, dependencies
├── testing.md        — Test strategy, patterns, fixtures
├── deploying.md      — Deployment process, environments, rollback
└── conventions.md    — Code patterns, architectural decisions
```

Only create files the project actually needs. Each should be self-contained and focused (50-150 lines).

### Step 5: Present and Iterate

Show the generated file(s) and ask:

"Here's the [CLAUDE.md / AGENTS.md] I've drafted. Let me know:

1. Anything missing that you'd want in every agent session?
2. Anything too specific that should move to a separate doc?
3. Any corrections?"

Iterate until satisfied. Show only changed sections after feedback rounds (not the whole file) unless the user asks for the full version.

## Anti-patterns to Watch For

When auditing or reviewing, flag these common mistakes:

- **The Encyclopedia** — Tries to document everything. Fix: move 80% to progressive disclosure.
- **The Style Guide** — Full of linter rules. Fix: use Biome/ESLint/Prettier/Ruff.
- **The Auto-generated Wall** — Output of `/init` untouched. Fix: rewrite deliberately.
- **The Stale Doc** — References outdated patterns or deleted files. Fix: audit against codebase.
- **The Instruction Overload** — 150+ distinct instructions. Fix: ruthlessly prioritize.
- **The Duplicate Pair** — CLAUDE.md and AGENTS.md with the same content. Fix: consolidate into AGENTS.md, make CLAUDE.md a reference.
- **The Unsupervised Loop** — No success criteria, no behavior guides. Agent assumes freely, overcomplicates, edits adjacent code, and has no way to verify "done". Fix: add the `Agent Behavior` section (Karpathy principles).
- **The Duplicate Singular** — Project uses legacy `AGENT.md` (singular) while the emerging standard is `AGENTS.md` (plural). Fix: rename.
- **The Mechanical File** — Lists tech stack, folder structure, and commands but says nothing about *how* the agent should act. Fix: add `Agent Behavior` section and, when relevant, `Documentation Lookup` (context7) and `UI Generation` (DESIGN.md).

## Slash Command Shortcuts

The harness ships three imperative commands that wrap this skill's workflow with parallelized detection. Use them when the user invokes them directly; otherwise the conversational skill workflow still works end-to-end.

- **`/agent-md:create`** — creates a new `CLAUDE.md` / `AGENTS.md` from scratch. Pre-loads the three detection subagents (context7, DESIGN.md, stack) in parallel.
- **`/agent-md:update`** — updates an existing file with drift detection and best-practice gap analysis. Runs four subagents (audit + 3 detectors) in parallel.
- **`/agent-md:audit`** — read-only diagnostic, no writes. Parallelizes audit-analyzer + tooling detectors. Ends with "run `/agent-md:update` to apply".

The commands are thin wrappers around this skill. When in doubt about an edge case, consult this file — the slash commands defer here for anything non-trivial.

## References

- `references/template.md` — The structural template for generated files (both CLAUDE.md and AGENTS.md).
- `references/karpathy-principles.md` — Full text of the 4 behavior principles plus the compressed inline snippet. Pasted into every generated file's `Agent Behavior` section.
- `references/project-tooling-snippets.md` — Detection heuristics and inline snippets for context7 and DESIGN.md. Consult before generating conditional sections.

## Subagent Prompts

The skill delegates noisy or parallelizable work to `Task`-spawned Explore subagents. Each prompt template lives in the `agents/` directory and is consumed by reading the file, substituting placeholders, and passing the content as the `Task` prompt. These files are **not** standalone subagents — they are prompt templates specific to this skill.

- `agents/context7-detector.md` — detects context7 availability (skill or MCP). Used in Step 0.5. Substitute `{project_path}`.
- `agents/design-md-detector.md` — detects `DESIGN.md` + UI frameworks. Used in Step 0.5. Substitute `{project_path}`.
- `agents/stack-scanner.md` — scans tech stack, folder structure, day-one commands. Used in Step 0.5 for Create/Update modes (not Audit). Substitute `{project_path}`.
- `agents/audit-analyzer.md` — analyzes an existing `CLAUDE.md` / `AGENTS.md` against core principles. Used in Step 1 for files ≥100 lines. Substitute `{target_file}`, `{context7_available}`, `{design_md_exists}`.

**Parallelization rule.** When multiple subagents can run independently (e.g., the three detectors in Step 0.5), spawn them in a single message with multiple `Task` calls. Sequential invocation negates the whole point.

**Inline fallback.** For small projects or small files, doing the check inline is cheaper than the subagent round-trip (~5–20s). Use judgment.
