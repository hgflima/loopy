# Implementation Plan: C-0108 — User preferences schema v2 (migration + settings UI)

> Derives from `spec.md` (same directory). Design decisions live in the spec —
> this plan decides the mechanics and the order, not the design.

## Overview

We introduce prefs schema v2 (namespaced keys + two new settings), an in-place
on-disk migration of v1 files, a namespaced store API rolled out across ~9 call
sites, and the settings UI for the new options. The migration is the dangerous
part: it rewrites a persisted file on thousands of machines, the old app version
cannot read the result, a half-written migration bricks the user's preferences,
and **there is no telemetry to tell us it happened**. Rated on the risk rubric
(blast radius: persisted schema; detection & reversal: silent failure, costly
reversal) the naive "implement the migration" task is **Risk XL — do not
implement as-is**. The plan therefore front-loads two cheap de-risking tasks
(T-001 fixture corpus + frozen decision table, T-002 atomic-write crash-safety
spike) and only then builds the migration in layers: pure function → I/O runner
→ torture tests. Everything that can go wrong must be provably survivable
*before* the runner exists, because we will never get a bug report — only a
user with wiped preferences.

## Architecture Decisions

- **De-risk before implement (skill rule for Risk XL).** The migration I/O task
  (T-005) is forbidden from starting until T-001 (semantics frozen as a decision
  table + fixture corpus) and T-002 (atomic temp-write + rename proven
  crash-safe by fault injection) are done. This converts an XL risk into an L.
- **Migration is layered: classify/transform is pure, I/O is thin.** The v1→v2
  transform (T-004) is a pure function `unknown → {kind: 'migrated'|'already-v2'|'corrupt', v2}`
  with no filesystem access, unit-tested over the whole fixture corpus. The
  runner (T-005) only does read → classify → atomic write → `.bak` handling.
  Pure code is where the mapping bugs would live, and pure code is exhaustively
  testable.
- **Fail-safe over fail-fast on the user's machine.** Since failures are
  invisible in the wild, every failure path must leave the user in a working
  state: corrupt/unreadable → defaults + original preserved as `prefs.json.bak`;
  crash mid-migration → original `prefs.json` untouched (temp+rename, never
  truncate — spec constraint); re-running the migration is idempotent, so a
  second launch self-heals any interrupted first attempt.
- **Atomicity mechanics**: write to a temp file **in the same directory** as
  `prefs.json` (rename across filesystems is not atomic), fsync, then rename.
  T-002 validates this on the target platform(s) with a fault-injection test
  before we depend on it.
- **Store API cutover is one serialized task.** The ~9 call sites move in a
  single task (T-008) after the new API lands (T-007), per the spec constraint
  to coordinate with the team before merging. Parallel edits to those files by
  other tasks are excluded by `Deps:` edges (T-009 edits `SettingsScreen.tsx`,
  which T-008 also touches — serialized).
- Everything else (v2 shape, key mapping, defaults, `.bak` policy) is inherited
  from the spec — do not reopen.

## Dependency graph

```
T-001 ──────────────┐
                    ├─► T-004 ─────┐
T-003 ─┬────────────┘              ├─► T-005 ─► T-006 ─┐
       │                           │                   ├─► T-010
T-002 ─┼───────────────────────────┘                   │
       │                                               │
       └─► T-007 ─► T-008 ─► T-009 ────────────────────┘
```

Initial Ready set (no deps): T-001, T-002, T-003.

Edges that exist for de-risking, not logic: T-005 → T-002 (the runner may not
be written until crash-safety is proven). Edge that exists only to serialize a
shared file: T-009 → T-008 (both touch `src/settings/SettingsScreen.tsx`).

## Vertical slicing (why this order)

- **Phase 1 runs three independent foundations in parallel** and is where the
  plan fails fast if it is going to fail: the fixture corpus + decision table
  freezes *what the migration means* for every input class (including the ugly
  ones: truncated JSON, empty file, unknown keys), and the atomic-write spike
  proves *the mechanism can't brick a file* before any migration code exists.
- **Phase 2 delivers the entire migration semantics as a pure function** —
  every fixture class in, correct classification out. At this checkpoint the
  risky logic is done and fully verified, yet nothing has touched a disk.
- **Phase 3 wires it to the filesystem and then attacks it** (torture tests:
  crash injection, idempotent re-run, `.bak` preservation, fresh install). After
  this checkpoint the scary part of the change is finished and green.
- **Phases 4–5 are the breadth work** (store API, call sites, UI), which is
  low-uncertainty and rides on the already-stable schema. The store track
  (T-007) can start in parallel with Phases 2–3 since it only depends on the
  schema (T-003) and the atomic writer (T-002).
- **Phase 6 documents** the now-validated behavior.

The system stays working at every checkpoint: the migration is inert until
wired in T-005; the store keeps its old surface until T-007/T-008 land
together as a coordinated cutover; the UI lands last.

## Phases & checkpoints

### Phase 1 — De-risk the migration (T-001 ∥ T-002 ∥ T-003)

Freezes migration semantics, proves crash-safety of the write path, and lands
the v2 schema — the three foundations everything else builds on.

**Checkpoint: De-risk gate (after T-001..T-003)**
- [ ] Decision table covers every input class (v1, v2, corrupt, half-written, empty, missing, unknown keys) with an agreed outcome for each
- [ ] Fault-injection test demonstrates: kill between temp-write and rename ⇒ original `prefs.json` byte-identical
- [ ] Schema v2 compiles, typecheck clean, defaults exported
- [ ] **Human review**: sign off on the decision table (incl. the downgrade open question below) before any migration code is written

### Phase 2 — Pure migration (T-004)

The complete v1→v2 transform and input classification, no I/O.

**Checkpoint: Semantics (after T-004)**
- [ ] Unit tests green over the entire fixture corpus, including the real production v1 fixture
- [ ] Migration of the prod fixture output matches the reviewed golden v2 file

### Phase 3 — Migration I/O (T-005 → T-006)

Wires the pure transform to disk behind the proven atomic writer, then tries to
break it.

**Checkpoint: Crash-safe on disk (after T-006)**
- [ ] Integration tests green: happy path, corrupt→`.bak`+defaults, already-v2 no-op, half-written, fresh install (no file)
- [ ] Torture tests green: crash mid-migration then relaunch self-heals; migration is idempotent across repeated runs
- [ ] **Human review**: the riskiest work is done — review before starting the wide store cutover

### Phase 4 — Store API + call sites (T-007 → T-008)

Namespaced `get`/`set`, then the coordinated ~9-call-site cutover.

**Checkpoint: Cutover (after T-008)**
- [ ] Whole-repo typecheck and full test suite green (no flat-key call site remains)
- [ ] **Coordinate with the team before merging** (spec constraint — wide-touch change)

### Phase 5 — Settings UI (T-009)

**Checkpoint: Feature complete (after T-009)**
- [ ] New settings render, persist via the store, and survive an app restart
- [ ] Render tests green

### Phase 6 — Docs (T-010)

**Checkpoint: Complete**
- [ ] All spec success criteria met; all tests green; typecheck clean
- [ ] Review with human before closing the change

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Half-written/failed migration bricks a user's prefs, silently (no telemetry, old app can't read v2) | High | De-risk first: T-002 proves temp-write+rename crash-safety by fault injection before the runner exists; T-005 never truncates in place; T-006 torture-tests crash + idempotent re-run (second launch self-heals); corrupt input always preserved as `prefs.json.bak` |
| Wrong migration semantics (a key mapped wrong ships to thousands of machines) | High | T-001 freezes a human-reviewed decision table + golden fixtures incl. a real prod v1 file; T-004 is pure and exhaustively unit-tested against the corpus before any disk I/O exists |
| `rename` not atomic on some target platform/filesystem | Med | T-002 spike validates on target platforms; temp file created in the same directory; fallback strategy decided in the spike, not mid-implementation |
| ~9-call-site store cutover causes merge conflicts / breaks teammates | Med | Single serialized task (T-008) with a team-coordination checkpoint before merge; `Deps:` edges keep other tasks out of those files (T-009 waits on T-008) |
| Fresh-install path regresses (user never had a prefs file) | Med | Explicit fixture class in T-001; dedicated integration test in T-005 acceptance |
| Fixture corpus misses a real-world input shape | Med | Corpus includes the provided production fixture; unknown-keys and empty-file classes added; decision table defaults every unclassified input to fail-safe (defaults + `.bak`) |

## Open questions

- **Downgrade insurance**: the spec mandates `.bak` only for corrupt files, but
  since the old app version cannot read v2, a *successful* migration also makes
  downgrade lossy. Recommend T-001's decision table adopt "keep a one-time
  `prefs.json.v1.bak` on successful migration" as cheap insurance — needs human
  sign-off at the Phase 1 checkpoint (it slightly extends the spec).
- **App entry point**: the spec says "on app start" but does not name the entry
  file; T-005 assumes a single startup wiring point (listed as `src/main.ts` —
  adjust to the actual entry module when implementing).
