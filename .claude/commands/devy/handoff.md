---
disable-model-invocation: true
name: handoff
description: Analyze the current conversation and create a handoff document for continuing this work in a fresh context
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - AskUserQuestion
  - WebSearch
  - WebFetch
---

Create a comprehensive, detailed handoff document that captures all context from the current conversation. This allows continuing the work in a fresh context with complete precision.

## Instructions

**PRIORITY: Comprehensive detail and precision over brevity.** The goal is to enable someone (or a fresh Claude instance) to pick up exactly where you left off with zero information loss.

Adapt the level of detail to the task type (coding, research, analysis, writing, configuration, etc.) but maintain comprehensive coverage:

1. **Original Task**: Identify what was initially requested (not new scope or side tasks)

2. **Work Completed**: Document everything accomplished in detail
   - All artifacts created, modified, or analyzed (files, documents, research findings, etc.)
   - Specific changes made (code with line numbers, content written, data analyzed, etc.)
   - Actions taken (commands run, APIs called, searches performed, tools used, etc.)
   - Findings discovered (insights, patterns, answers, data points, etc.)
   - Decisions made and the reasoning behind them

3. **Work Remaining**: Specify exactly what still needs to be done
   - Break down remaining work into specific, actionable steps
   - Include precise locations, references, or targets (file paths, URLs, data sources, etc.)
   - Note dependencies, prerequisites, or ordering requirements
   - Specify validation or verification steps needed

4. **Attempted Approaches**: Capture everything tried, including failures
   - Approaches that didn't work and why they failed
   - Errors encountered, blockers hit, or limitations discovered
   - Dead ends to avoid repeating
   - Alternative approaches considered but not pursued

5. **Critical Context**: Preserve all essential knowledge
   - Key decisions and trade-offs considered
   - Constraints, requirements, or boundaries
   - Important discoveries, gotchas, edge cases, or non-obvious behaviors
   - Relevant environment, configuration, or setup details
   - Assumptions made that need validation
   - References to documentation, sources, or resources consulted

6. **Current State**: Document the exact current state
   - Status of deliverables (complete, in-progress, not started)
   - What's committed, saved, or finalized vs. what's temporary or draft
   - Any temporary changes, workarounds, or open questions
   - Current position in the workflow or process

## Where to save

Save the handoff as `handoff.md` in the **current project work directory** — the folder where the `spec.md` / `plan.md` / `todo.md` you are currently working on live (by convention, `.harn/devy/specs/<YYYYmmdd>-<branch-kebab>/`).

To locate it, in priority order:

1. **Active (uncommitted) work directory — preferred.** Run `git status --short` and find directories under `.harn/devy/specs/` that have uncommitted, unstaged, or untracked changes (paths marked modified, added, or `??`). If exactly one such directory contains a `spec.md`, `plan.md`, or `todo.md`, that is the folder you are actively working on — use it. The current working tree is a stronger signal of "where I am now" than the branch name.
2. **Branch match — fallback.** If step 1 yields zero or more than one candidate, run `git branch --show-current` and look under `.harn/devy/specs/` for a directory whose `<branch-kebab>` matches the current branch and contains `spec.md`, `plan.md`, or `todo.md`. If exactly one matches, use it.
3. **Ask — last resort.** If the target is still not 100% clear (steps 1–2 leave zero or multiple candidates): **STOP and ask the user with `AskUserQuestion`** — present your best-guess directory first as the recommended option, then the other candidates. Never silently guess.

Write the document using the format below, then print the **absolute path** of the saved file.

## Output Format

```xml
<original_task>
[The specific task that was initially requested - be precise about scope]
</original_task>

<work_completed>
[Comprehensive detail of everything accomplished:
- Artifacts created/modified/analyzed (with specific references)
- Specific changes, additions, or findings (with details and locations)
- Actions taken (commands, searches, API calls, tool usage, etc.)
- Key discoveries or insights
- Decisions made and reasoning
- Side tasks completed]
</work_completed>

<work_remaining>
[Detailed breakdown of what needs to be done:
- Specific tasks with precise locations or references
- Exact targets to create, modify, or analyze
- Dependencies and ordering
- Validation or verification steps needed]
</work_remaining>

<attempted_approaches>
[Everything tried, including failures:
- Approaches that didn't work and why
- Errors, blockers, or limitations encountered
- Dead ends to avoid
- Alternative approaches considered but not pursued]
</attempted_approaches>

<critical_context>
[All essential knowledge for continuing:
- Key decisions and trade-offs
- Constraints, requirements, or boundaries
- Important discoveries, gotchas, or edge cases
- Environment, configuration, or setup details
- Assumptions requiring validation
- References to documentation, sources, or resources]
</critical_context>

<current_state>
[Exact state of the work:
- Status of deliverables (complete/in-progress/not started)
- What's finalized vs. what's temporary or draft
- Temporary changes or workarounds in place
- Current position in workflow or process
- Any open questions or pending decisions]
</current_state>
```
