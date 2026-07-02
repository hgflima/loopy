---
disable-model-invocation: true
name: quality-assessment
description: Fowler-grounded, read-only quality assessment of a code module or your current diff. Names code smells with file:line, prescribes specific refactorings (Extract Function, Replace Conditional with Polymorphism, …), reports test coverage against the 90% target, and emits a prioritized action plan. Reports only — it never edits. Use whenever the user wants to audit code health, assess refactoring debt, find coverage gaps, get a "how good is this module" read, or asks for a quality assessment / code-quality report on a path or on recent changes.
argument-hint: "[path] — optional; defaults to the current diff"
allowed-tools: Bash, Read, Grep, Glob, Skill, Task
---

Invoke the **refactor-guide** skill — it is the Fowler knowledge base (code smells, the refactoring catalog, the Two Hats, the role of tests). Ground every finding in it and use Fowler's exact vocabulary throughout.

This is an **assessment**: produce a report, never edit code. (Acting on the report afterward is `/devy:code-simplify`.)

## 1. Resolve scope

- If an argument was passed, the target is that path: **$ARGUMENTS**
- If no argument was passed, the target is the **current diff** — `git diff --name-only HEAD` plus staged files; collapse those to the directories they live in.
- Ignore `build/`, `dist/`, `node_modules/`, `vendor/`, generated files, and lockfiles. Focus on production code; read tests as a signal of testability and as the basis for the coverage metric.
- Identify which workspace owns the target by reading the nearest `package.json` `name` — you need it for the coverage command. Workspaces live under `apps/*`, `apps/mock-servers/*`, `apps/spikes/*`, and `packages/*`.

## 2. Gather objective signal (don't eyeball what a tool can measure)

Run these against the scope and fold the results into your reading:

- **fallow** — token-level duplication, complexity hotspots, and dead code (unused files/exports/deps). It scopes by cwd, so run it from inside the target directory: `cd <target-dir> && npx fallow dupes` (plus the other reports). For a subfolder, run inside that subfolder so consumers living above it don't read as false dead-code.
- **qlty smells** — structural duplication and complexity above threshold. fallow and qlty catch *different* duplication (token-level vs structural), so run both and cross-reference — one being clean doesn't mean the other is.
- **coverage** — `pnpm --filter <workspace-name> test:coverage` (every app/package defines `test:coverage` → `vitest run --coverage`). The backend's coverage run exits non-zero because it sits below its configured thresholds — that's a pre-existing config state, not a failing test; read the printed table regardless.

## 3. Read and evaluate (Fowler's vocabulary)

1. **Code smells** — name them explicitly (Long Function, Large Class, Feature Envy, Data Clumps, Primitive Obsession, Shotgun Surgery, Divergent Change, Duplicated Code, …). Cite `file:line` for each, and prefer smells corroborated by the tool output above.
2. **Recommended refactorings** — name the specific technique (Extract Function, Replace Conditional with Polymorphism, Introduce Parameter Object, …) and describe the conceptual before → after.
3. **Design** — cohesion, coupling, separation of concerns, dependencies pointing in the right direction.
4. **Testability & readability** — naming, clear intent, small functions.

## 4. Coverage (target > 90%)

- Report current line and branch coverage, both global and per-module within the scope.
- Treat any file/module below 90% as a high-priority finding.
- List the most relevant uncovered paths (critical/business logic, error handling) and the specific test cases needed to cross 90%.
- Coverage is a means, not an end: flag fragile or trivial tests that inflate the number without protecting behavior — per Fowler, tests exist to give you the confidence to refactor.

## 5. Prioritize

Rank each finding by **impact × effort**; start with the highest return at the lowest risk. Don't propose a rewrite — Fowler favors small, safe, incremental refactoring under the protection of tests.

## Output format

ALWAYS use this structure:

1. **Executive summary** (3–5 lines): overall state, current coverage vs. the 90% target, and the 3 most serious issues.
2. **Findings**: table of `smell | location (file:line) | refactoring | priority`.
3. **Coverage**: table of `module | % lines | % branches | meets >90%? | missing tests`.
4. **Action plan**: ordered — what to tackle first and why.
5. **What's good**: call out the strengths, not only the problems.

If context about the scope is missing (language, purpose, conventions), state your assumptions explicitly.
