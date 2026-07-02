---
disable-model-invocation: true
name: build-workflow
description: Design and run a resilient multi-agent Workflow that executes a refactoring plan to completion — follows plan.md's execution and parallelization instructions, drives off a todo.md checkbox ledger, runs the backend gate (typecheck → lint → quality gate → test) per item, routes failures through the debug-like-expert protocol, and gates every item behind adversarial review. Use whenever the user wants to autonomously execute a planned backend refactor end-to-end from a .harn/devy/specs/<dir> folder, "run the plan with a workflow", "fan out the todo", or finish a refactor where partial progress is not acceptable.
argument-hint: "<dir> — folder holding plan.md + todo.md (e.g. .harn/devy/specs/20260610-outbound-adapters-refactor)"
allowed-tools: Workflow, Task, Read, Write, Edit, Bash, Grep, Glob, Skill
model: opus
---

Author and launch a **resilient dynamic Workflow** (the `Workflow` tool — this command is an explicit opt-in to multi-agent orchestration / ultracode) that completes the refactoring described in the plan, using the todo checklist as the single source of iteration. This command BUILDS and PROVES the planned artifacts and then STOPS; it never autonomously performs a live/outward-facing run (installs, config wiring, migrations against real data) — any such step is `held` for explicit human approval. The Workflow runs in the background; invoking this command is the user's go-ahead to launch it.

## Inputs

```
DIR  = $ARGUMENTS                 # the spec folder
PLAN = $DIR/plan.md               # target architecture, rationale, acceptance criteria, ordering, risks, per-item SCOPE/paths
TODO = $DIR/todo.md               # checkbox checklist — SINGLE SOURCE OF ITERATION and durable ledger
```

If `$ARGUMENTS` is empty, ask for the folder before doing anything. If `plan.md` or `todo.md` is missing, stop and say so — this command does not invent a plan (that is `/devy:plan`). Read both files in full before authoring the script.

> Convention note: in this repo `plan.md` is the plan and `todo.md` is the checklist (see `/devy:plan`). If a folder ever ships them swapped, trust the *content* (which file holds checkboxes), not the filename.

## Non-negotiable contract

1. **TODO is the source of truth for WHAT.** Each item has a stable ID and a state: `pending | in_progress | done | verified | blocked`. The run finishes only when EVERY item is `verified` or explicitly `blocked` with a justification.
2. **PLAN is the authority for HOW.** Ordering, waves/batches, what runs in parallel vs serial, and sync points come from `plan.md`'s own execution instructions — not from generic heuristics. The disjoint-scope heuristic (below) applies only where PLAN is silent. The only thing that overrides a PLAN instruction is a safety invariant (serialized `test`, shared Postgres, overlapping scopes); when that happens, serialize and flag the deviation in the final report.
3. **Partial progress is never success.** If any item is still `pending`/`in_progress`, the run is NOT complete — keep going, or report exactly what remains and why. Never summarize partial progress as done.
4. **Idempotent and resumable via TODO.** The checkboxes are the durable ledger: `[x]` = `verified` → skip it. Re-running (even in a fresh session) resumes from the checkbox state.
5. **"Done" requires evidence.** No item becomes `verified` without (a) passing the verification gate and (b) surviving independent adversarial review.
6. **Scope discipline (write AND read hermeticity).** Each item may edit only the paths declared for it in PLAN/TODO. Touching anything outside that scope must be flagged explicitly in the report. Hermeticity also covers READS: if the plan includes a live/install/migration step that will MUTATE real repo files, tests must NOT read those live files as baselines — they must read FROZEN fixtures (e.g. snapshots captured from git HEAD) instead. A test coupled to pristine repo state is not hermetic: it passes the gate before the mutating step and then breaks after it.
7. **Never commit.** Leave every change in the working tree — the user commits at the end. The bookkeeping agent edits `todo.md` checkboxes in place; it does not run git.
8. **No single item can wedge the run (anti-stall).** The Workflow runtime retries an agent on the SAME cache key when it fails to emit a schema-valid StructuredOutput — a heavy item paired with a large per-item output schema can loop on that forever and leave the whole run stuck in `running`. To prevent this: keep each item's StructuredOutput schema LEAN (only the fields the ledger needs) and keep items SMALL and splittable — break a heavy item (e.g. large migration logic) into sub-items rather than one item with a fat schema. Treat an agent that still returns no valid structured result, after the runtime's own retries, as a `blocked` item: record it with that cause and continue — NEVER let one item block the whole run. Monitor the run; if you observe a single item being retried repeatedly with no result, stop it, split or simplify that item (and its schema), then resume.
9. **Build and STOP — never build-and-run.** This command BUILDS the artifacts the plan declares and PROVES them against frozen fixtures, then stops. It must NEVER autonomously execute a LIVE, outward-facing step — anything that mutates real repo state beyond the declared build artifacts: installing or enabling hooks, wiring real config files (e.g. `settings.json`, `.lintstagedrc.js`, the root `CLAUDE.md`, `.gitignore`), running a migration against real ADRs/data, or any other live run. Such an item is `held`, not run: the run STOPs before it, leaves it unchecked, and surfaces it in the final report for explicit human approval. A `held` live item is not a failure and does not count against any attempt budget — but the run is not `verified`-complete while one is outstanding.

## Verification gate (derive it from the target type; an item passes only if EVERY gate step passes)

**Detect the target first.** Do not assume a backend-TypeScript target. From PLAN/TODO, classify what the plan actually builds and derive the matching gate: (a) the **backend package** → the four-step gate below; (b) a **Node `.mjs` / zero-dep harness** (e.g. files under `.harn/`) → the gate the plan itself prescribes, typically `node --test '<dir>/**/*.test.mjs'` (a glob — NEVER `node --test <dir>`, which Node v24 treats as a module entry and fails with MODULE_NOT_FOUND, yielding a false-negative suite checkpoint) plus the plan's other checks (e.g. a no-comments scan); (c) a **frontend** target → the frontend's own gate from PLAN. Whenever the derived gate is not the backend four-step gate below, run the plan's gate verbatim and flag the deviation in the final report (same as any safety-invariant override).

When the target is the backend package, the gate is (mandatory order, all four must pass):

```
pnpm --filter @liber/backend typecheck                                # tsc -p tsconfig.json --noEmit
pnpm --filter @liber/backend lint                                     # oxlint
bash .claude/hooks/quality-gate-staged.sh <files edited by the item>  # quality gate, blocking mode
pnpm --filter @liber/backend test                                     # vitest run — FULL backend suite
```

**Quality gate specifics.** `quality-gate-staged.sh` already sets `QUALITY_GATE_BLOCKING=1` internally — never skip it or downgrade it to advisory. Run it from the repo root with the item's edited file paths as arguments; ANY non-zero exit fails the gate (findings print on stderr). Findings are diff-scoped against HEAD, and the fallow tier audits the whole `apps/backend` workspace — so under parallel waves a finding may originate from ANOTHER in-flight item: a finding clearly outside the item's declared scope does not consume that item's attempt budget; log it for the Phase 3 sweep instead. Never clear a finding by stamping a debt file in `.harn/devy/debts/` or via `--no-verify` — accepting debt is the user's decision. A finding inside the item's scope that survives the attempt budget makes the item `blocked`, with the finding as evidence.

**Concurrency hazard — read this before fanning out.** The `test` step runs the integration suite against a **shared Postgres** (`localhost:5432`). Parallel agents running `vitest` simultaneously corrupt each other's data and produce flaky failures. Therefore:

- `typecheck`, `lint`, and the quality gate are stateless and may run per-item in parallel (the quality gate's lint/metrics/smells tiers are scoped to the files passed; its fallow tier reads the workspace but never writes).
- `test` MUST be **serialized**: route it through a single gate runner that executes one suite run at a time. Run it at each wave/sync point — never concurrently from multiple item agents.
- Item agents work in the **shared working tree** with **disjoint declared scopes** (not isolated worktrees — those start from a stale base here and lack `node_modules`). If two `pending` items declare overlapping paths, serialize them instead of parallelizing.

## Phases (encode these as the Workflow script)

**Phase 0 — PLAN + TODO ingestion.** Read `plan.md` in full FIRST and extract its execution instructions: prescribed ordering, waves/batches, which items it says may run in parallel and which must be serial, sync points, per-item scope/paths and acceptance criteria. These instructions are the spine of the execution graph — do not replace them with your own grouping. Then parse the TODO checkboxes into items with a stable ID (reuse existing numbering; if an item has none, assign `T-01`, `T-02`… in order and persist the ID inline in `todo.md`); build the dependency graph following PLAN's instructions, filling gaps with the disjoint-scope heuristic only where PLAN is silent. Read current checkbox state — `[x]` items are already `verified`; do not redo them.

**Phase 1 — Adversarial plan validation (BEFORE any edit).** Fan out independent agents that stress PLAN + TODO from different angles: contradictions, missing steps, dangerous ordering, ambiguous items, scope overlaps, regression risk. Consolidate a validated execution graph. A genuine conceptual blocker → STOP and report before any edit is made.

**Phase 2 — Per-item execution (core loop over TODO).** For each not-yet-verified item, following the execution order and parallelization PLAN prescribes (its waves, batches, and serial sections). Where PLAN is silent: parallelize independent items with disjoint scope, respecting the concurrency cap; serialize dependent or scope-overlapping ones. If a PLAN parallelization suggestion collides with a safety invariant (serialized `test`, shared Postgres, overlapping scopes), the invariant wins — serialize and flag the deviation in the final report.

- ONE owner agent applies the change for that item, restricted to its declared scope, then runs the gate: `typecheck` → `lint` → quality gate (`quality-gate-staged.sh` on the item's files) → (serialized) `test`.
- On ANY gate failure: route the diagnosis through the **debug-like-expert** skill/protocol (systematic evidence → hypothesis → test → verify) in a dedicated debug step, apply the fix, re-run the gate. Budget: up to **3 corrective attempts** per item, each routed through debug-like-expert.
- A **separate adversarial reviewer agent** checks the change against the item's acceptance criteria and against regressions. The reviewer MUST also reject tests that are not hermetic on the READ side — any test that reads live repo files as baselines when the plan has a later live/install/migration step that mutates those files must be sent back to read FROZEN fixtures instead. A rejection bounces back to the owner and consumes from the same 3-attempt budget (via debug-like-expert).
- 3 attempts exhausted without passing → mark `blocked` with the debug-like-expert diagnosis. Do NOT check the box.
- Only after passing the gate AND review → mark `verified`.

**Phase 3 — Cross-cutting consistency.** Run the full gate on the whole package — including `quality-gate-staged.sh` over EVERY file touched during the run (this also settles the out-of-scope findings deferred from Phase 2) — plus a sweep for dead code, lingering references to the old API, and formatting drift. Any regression **reopens** the originating item in the ledger (same 3-attempt debug-like-expert loop).

**Phase 4 — Reconciliation, persistence, final gate.** A single bookkeeping agent writes `todo.md` checkboxes ONLY at sync points (end of each wave/phase and at the very end), checking `[x]` only for `verified` items — this avoids write races between parallel agents on the same file. Re-read the entire TODO: invariant = every item is `verified` or `blocked`. Anything still open → keep going or report; never conclude.

## Efficiency

- Parallelize independent, disjoint-scope items; serialize by dependency or scope overlap.
- Use a cheaper model for mechanical edits; the strongest model for risky items, for adversarial review, and for the debug-like-expert step. In the Workflow, omit `opts.model` by default (inherit the session model) and only override where a tier genuinely fits.
- Keep intermediate state in script variables (the dependency graph, per-item verdicts, attempt counters). Only the final report returns to context.

## Final report (return this from the Workflow)

- **Per-item table:** ID | description | final state | evidence (which gate command(s) passed) | review result.
- **Blocked items:** cause + debug-like-expert diagnosis + concrete next step.
- **Held live steps:** any build-and-stop item that performs a live/outward-facing run (hook install/enable, real config wiring, migration against real data) — list it explicitly as `held`, awaiting human approval; never run it as part of this command.
- **Changes:** files/diffs touched per item, plus any cross-cutting edits; flag anything edited outside an item's declared scope.
- **Final gate verdict:** `N/N items verified` — or the exact list of what blocks completion. Do not report success while anything is open.
