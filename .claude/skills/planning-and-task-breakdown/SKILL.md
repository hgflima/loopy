---
name: planning-and-task-breakdown
description: Breaks work into ordered tasks. Use when you have a spec or clear requirements and need to break work into implementable tasks. Use when a task feels too large to start, when you need to estimate scope, or when parallel work is possible.
---

# Planning and Task Breakdown

## Overview

Decompose work into small, verifiable tasks with explicit acceptance criteria. Good task breakdown is the difference between an agent that completes work reliably and one that produces a tangled mess. Every task should be small enough to implement, test, and verify in a single focused session.

## When to Use

- You have a spec and need to break it into implementable units
- A task feels too large or vague to start
- Work needs to be parallelized across multiple agents or sessions
- You need to communicate scope to a human
- The implementation order isn't obvious

**When NOT to use:** Single-file changes with obvious scope, or when the spec already contains well-defined tasks.

## What You Produce

Two files, written **next to the spec**. If the spec lives in `.harn/devy/changes/C-0042-csv-export/`, they go in that folder; if it lives in `docs/specs/`, they go there. The names are exact, because whatever runs the backlog points at them by name:

| File | Content |
|------|---------|
| `plan.md` | The narrative — overview, architecture decisions, dependency graph, phases with checkpoints, risks. What a human reads to understand the shape of the work. |
| `todo.md` | The executable backlog — one entry per task, in the format below. What tooling reads. |

Keep them complementary rather than redundant: `plan.md` explains why the work is shaped this way, `todo.md` carries the tasks themselves. Repeating the full task list in both means they drift apart the first time one is edited.

Both follow the language of the spec — if the spec is in Portuguese, so are they. The field labels (`Deps:`, `Files:`, `Size:`, `Risk:`) stay in English regardless, since the parser matches them as literal prefixes.

## The Planning Process

### Step 1: Enter Plan Mode

Before writing any code, operate in read-only mode:

- Read the spec and relevant codebase sections
- Identify existing patterns and conventions
- Map dependencies between components
- Note risks and unknowns

**Do NOT write code during planning.** The output is a plan document, not implementation.

### Step 2: Identify the Dependency Graph

Map what depends on what:

```
Database schema
    │
    ├── API models/types
    │       │
    │       ├── API endpoints
    │       │       │
    │       │       └── Frontend API client
    │       │               │
    │       │               └── UI components
    │       │
    │       └── Validation logic
    │
    └── Seed data / migrations
```

Implementation order follows the dependency graph bottom-up: build foundations first.

### Step 3: Slice Vertically

Instead of building all the database, then all the API, then all the UI — build one complete feature path at a time:

**Bad (horizontal slicing):**
```
Task 1: Build entire database schema
Task 2: Build all API endpoints
Task 3: Build all UI components
Task 4: Connect everything
```

**Good (vertical slicing):**
```
Task 1: User can create an account (schema + API + UI for registration)
Task 2: User can log in (auth schema + API + UI for login)
Task 3: User can create a task (task schema + API + UI for creation)
Task 4: User can view task list (query + API + UI for list view)
```

Each vertical slice delivers working, testable functionality.

### Step 4: Write Tasks

Each task is a checkbox line at column 0 carrying an id, followed by an indented body:

```markdown
- [ ] T-001: Short imperative title
    What this task delivers and why — one paragraph.
    Acceptance: a testable condition; another testable condition.
    Verification: npm test -- --grep "feature-name" && npm run build
    Deps: none
    Files: src/path/to/file.ts, tests/path/to/test.ts
    Size: S
    Risk: M
```

The shape isn't arbitrary — each part of it is load-bearing:

- **The checkbox at column 0 plus the id is what marks a task.** Everything indented below belongs to it, up to the next non-blank line at column 0. Ids are sequential and zero-padded (`T-001`, `T-002`).
- **The body is handed to whoever implements the task** — it becomes their entire briefing, since they won't have read the spec. `Acceptance` and `Verification` aren't paperwork: they're how the implementer knows when to stop and how they check themselves before claiming done.
- **One field per line, and `Deps:` holds nothing but comma-separated ids.** The parser cuts the prefix, splits on commas, and silently drops any token that isn't an id — so `Deps: T-001, T-002. Files: x.ts` parses as `["T-001"]`. The second dependency vanishes, the graph flattens, and nothing warns you. Of all the ways to get this format wrong, that one costs the most and shows the least.
- **No dependencies: leave the line out** (or write `Deps: none`).

### Step 5: Order and Checkpoint

Arrange tasks so that:

1. Dependencies are satisfied (build foundation first)
2. Each task leaves the system in a working state
3. Verification checkpoints occur after every 2-3 tasks
4. High-risk tasks are early (fail fast)

Add explicit checkpoints:

```markdown
## Checkpoint: After Tasks 1-3
- [ ] All tests pass
- [ ] Application builds without errors
- [ ] Core user flow works end-to-end
- [ ] Review with human before proceeding
```

## Sizing and Risk

Two independent axes, and conflating them is how dangerous work gets scheduled late. Size tells you whether a task fits in one session. Risk tells you what happens if it goes wrong. A schema migration can touch a single file and still be the most dangerous thing in the plan.

**Size** — one ruler, based on how much surface the task moves:

| Size | Files | Example |
|------|-------|---------|
| **XS** | 1 | A validation rule, a config value |
| **S** | 1-2 | One endpoint, one component |
| **M** | 3-5 | One feature slice |
| **L** | 5-8 | A multi-component feature |

There is no XL. A task that lands above L isn't a size — it's a signal to split. An agent does its best work at S and M.

**Break a task down further when:**
- It would take more than one focused session (roughly 2+ hours of agent work)
- You cannot state its acceptance criteria in 3 or fewer bullets
- It touches two or more independent subsystems (e.g., auth and billing)
- You find yourself writing "and" in the title — usually two tasks wearing one hat

**Risk** — what raises it, independent of size:
- It writes a **persisted format** (a schema, a file on the user's disk); mistakes outlive the run
- Failure would be **silent** — nothing in CI or the UI would surface it
- It's **hard to reverse**: a migration, a published API, a release
- Much depends on it, so a wrong call propagates outward

A high-risk task earns a cheap spike or confirmation task *before* it, with the real implementation depending on that spike via `Deps:`. The expensive work then starts from a checked assumption instead of a hoped-for one — and when the assumption turns out wrong, you find out in the task that cost nothing.

## `plan.md` Template

Phases reference tasks by id rather than restating them — the tasks themselves live in `todo.md`, and a second copy here would go stale the moment one of them is edited.

```markdown
# Implementation Plan: [Feature/Project Name]

## Overview
[One paragraph summary of what we're building]

## Architecture Decisions
- [Key decision 1 and rationale]
- [Key decision 2 and rationale]

## Dependency Graph
[The graph, as a diagram or as an ordered reading of the edges]

## Phases

### Phase 1: Foundation — T-001, T-002
[What this phase establishes and why it comes first]
**Checkpoint:** tests pass, builds clean

### Phase 2: Core Features — T-003, T-004 (parallel), T-005
[What becomes possible once the foundation is in]
**Checkpoint:** end-to-end flow works

### Phase 3: Polish — T-006
**Checkpoint:** all acceptance criteria met, ready for review

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| [Risk] | [High/Med/Low] | [Strategy — often "de-risked by T-00N"] |

## Open Questions
- [Question needing human input]
```

## Parallelism Is the Default

Nobody asks what can run together — anything whose dependencies are satisfied runs. So what you declare with `Deps:` isn't the parallelism, it's the **serialization**: edges are how you say "not yet".

That inversion has one consequence worth internalizing:

> **Two tasks that edit the same file need an edge between them**, even when they're logically independent.

Without one they run concurrently in separate worktrees, never see each other's work, and collide at merge. Rebasing doesn't rescue that — both sides genuinely changed the same region, so a human has to decide. An edge costs a little wall-clock; a merge conflict mid-run costs a person's attention.

Beyond shared files, add an edge when a task needs another's output to exist (the migration before the code reading the new column), or when both mutate shared state. Everything else stays unconstrained — and the widest layer of the resulting graph is what determines how many tasks can actually run at once.

## Before You Hand It Over

- [ ] Every task has acceptance criteria and a verification step — none says "implement the feature" and leaves it there
- [ ] Every `Deps:` line holds ids and nothing else, and every id it names exists
- [ ] Dependency order is right, and any two tasks touching the same file have an edge
- [ ] No task is above L; high-risk ones sit early and have their spike ahead of them
- [ ] Checkpoints exist between phases
- [ ] The human has reviewed and approved the plan
