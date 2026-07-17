# Implementation Plan: C-0108 — User preferences schema v2 (migration + settings UI)

> Companion to `spec.md` (same folder). Narrative, dependency graph, phases, checkpoints and
> risks. The machine-parseable backlog is in `todo.md` (same folder).

## Overview

Move persisted user preferences from flat schema v1 (`theme`, `fontSize`, `autoUpdate`) to
namespaced schema v2 (`appearance.*`, `updates.*`), add two new settings
(`updates.channel`, `appearance.density`), migrate existing on-disk v1 files in place, rewrite
the prefs store API to namespaced paths (~9 call sites), surface the new settings in the
settings UI, and document everything.

**The plan is shaped by one governing constraint:** the on-disk migration is the highest-risk
part of the change. The old app version cannot read v2 files, a failed or half-written migration
bricks the user's preferences, and there is **no telemetry** to tell us it happened. Therefore
the migration core is built and proven **first**, as pure functions plus an atomic/recoverable
disk runner, in complete isolation from app startup — and it does not get wired into the app
until a human checkpoint has reviewed the failure-path evidence. High-risk work is front-loaded
(fail fast); every failure path must leave the user's original v1 bytes recoverable on disk.

## Architecture Decisions

1. **Pure migration core, proven before any wiring.** `migrateV1ToV2` (v1 object → v2 object)
   and the input classifier (`v1 | v2 | corrupt | absent`) are pure functions with exhaustive
   unit tests — including the real production fixture `tests/fixtures/prefs-v1.json` as a golden
   test — before a single byte is written to disk by app code. The repo stays green while the
   risky logic is proved.
2. **Never destroy the v1 bytes — on any path.** Beyond the spec's `.bak` for corrupt files, a
   *successful* migration first copies the original file to `prefs.json.v1.bak` before the atomic
   rename. Rationale: with zero telemetry, recoverability is the only mitigation for a wrong-but-
   valid-looking migration, and it also gives users who downgrade the app (old version cannot
   read v2) a restore path. Cost: one extra file. (Additive to spec — flagged in Open Questions.)
3. **Self-verifying migration.** After the temp-file write + rename, the runner re-reads the
   migrated file and validates it against the zod schema. Read-back failure ⇒ restore the
   original bytes and fall back to in-memory defaults. Since no one will tell us it broke, the
   migration checks itself.
4. **Local forensic breadcrumb instead of telemetry.** The runner records the migration outcome
   (timestamp, source schema, result, error if any) in a small journal file next to the prefs
   file. It is the only diagnostic a support conversation with an affected user will ever have.
5. **Atomicity via temp-file + rename in the same directory** (spec constraint): never truncate
   in place; a crash between write and rename leaves the original file untouched and a stale
   temp file that the next start ignores/cleans.
6. **Store API lands as new-alongside-old, then call sites flip, then the shim dies.** The
   namespaced `get`/`set` is introduced with a temporary flat-key compat shim so the repo stays
   green; the ~9 call sites flip in one type-driven task; removing the shim makes `tsc` prove
   completion. Avoids a long-lived broken build and confines the "touches many files" risk to
   one coordinated task (spec constraint: coordinate with the team before merging).
7. **Fresh installs never write at startup.** No prefs file ⇒ pure v2 defaults in memory; the
   file is created on the first explicit `set`. Keeps the fresh-install path write-free and
   trivially safe.
8. **Defaults for new settings:** `updates.channel: "stable"` (safest), `appearance.density:
   "comfortable"` (matches current visual behavior). Unknown v1 keys are dropped during
   migration (they were never meaningful to the app), and this is documented.

## Dependency Graph

```
Phase 1 — de-risk the migration core (pure, no wiring)
  T-001 v2 schema + zod + defaults
     │
  T-002 pure classify + migrate (golden test on prod fixture)
     │
  T-003 atomic/recoverable disk runner (backup, read-back, journal — NOT wired)
     │
  ── CHECKPOINT 1: human reviews failure-path evidence (the de-risk gate) ──
     │
Phase 2 — store API + wiring
  T-004 store API v2 (namespaced get/set + compat shim)   ◄── T-001   (∥ with T-002/T-003)
     │
  T-005 flip ~9 call sites + remove shim                  ◄── T-004
     │
  T-006 wire migration into app start                     ◄── T-003, T-004
     │
  ── CHECKPOINT 2: all four start states green end-to-end; team merge window ──
     │
Phase 3 — UI + docs (parallel)
  T-007 settings UI: two new settings                     ◄── T-005
  T-008 docs/preferences.md                               ◄── T-006
```

Maximum useful parallelism is 2 (T-004 alongside T-002/T-003; T-007 alongside T-008).

## Task List

### Phase 1: De-risk the migration core (pure, offline)

- [ ] Task 1 (T-001): v2 schema, zod validation and defaults
- [ ] Task 2 (T-002): pure input classification + v1→v2 migration function
- [ ] Task 3 (T-003): atomic, recoverable, self-verifying disk migration runner (not wired)

### Checkpoint 1: The de-risk gate (after Tasks 1–3)
- [ ] All migration unit tests pass, including the production fixture golden test
- [ ] Every failure path demonstrably leaves the original v1 bytes recoverable on disk
      (corrupt ⇒ `prefs.json.bak`; crash-before-rename ⇒ original untouched; read-back
      failure ⇒ original restored)
- [ ] Migration is idempotent (re-run on v2 is a byte-level no-op)
- [ ] **Human reviews the failure-path test evidence and approves wiring the migration into
      app start. Nothing past this point may land before this approval.**

### Phase 2: Store API and wiring

- [ ] Task 4 (T-004): prefs store API v2 — namespaced `get`/`set` + temporary compat shim
- [ ] Task 5 (T-005): flip the ~9 call sites and remove the shim (team-coordinated)
- [ ] Task 6 (T-006): wire the migration runner into app start

### Checkpoint 2: End-to-end start states (after Tasks 4–6)
- [ ] App starts correctly from all four states: fresh install (pure v2 defaults, no file
      written), v1 file (migrated, `prefs.json.v1.bak` present), v2 file (no write),
      corrupt file (defaults + `prefs.json.bak` preserved)
- [ ] Full suite green; typecheck clean
- [ ] Team coordination done for the call-site-wide merge (spec constraint)

### Phase 3: UI and docs

- [ ] Task 7 (T-007): settings UI — `appearance.density` and `updates.channel`
- [ ] Task 8 (T-008): `docs/preferences.md` — v2 format, migration, recovery

### Checkpoint: Complete
- [ ] All spec success criteria met (prod fixture migrates; corrupt never crashes with `.bak`
      preserved; fresh installs get pure v2 defaults; tests green; typecheck clean)
- [ ] Ready for review

---

## Task Details

## Task 1: v2 schema, zod validation and defaults

**Description:** Define the v2 preference shape and its zod schema in `src/prefs/schema.ts`:
namespaces `appearance` (`theme`, `fontSize`, `density: comfortable|compact`) and `updates`
(`auto`, `channel: stable|beta`), with a mandatory `schemaVersion: 2` literal. Export a
`v2Defaults()` factory (defaults: `channel: "stable"`, `density: "comfortable"`). Pure module,
no I/O. This is the foundation every other task types against.

**Acceptance criteria:**
- [ ] Zod schema rejects any object missing `schemaVersion: 2` and any out-of-enum value
- [ ] `v2Defaults()` returns a fully valid v2 object (validated by the schema itself in a test)
- [ ] No I/O in the module

**Verification:**
- [ ] Tests pass: `npm test -- prefs/schema`
- [ ] Typecheck clean: `npm run typecheck`

**Dependencies:** None

**Files likely touched:**
- `src/prefs/schema.ts`
- `tests/prefs/schema.test.ts`

**Estimated scope:** S (1–2 files)

## Task 2: Pure input classification + v1→v2 migration function

**Description:** Still in pure land: a classifier that takes raw file content and returns
`{ kind: "v1" | "v2" | "corrupt" }` (no `schemaVersion` + parseable flat keys ⇒ v1;
`schemaVersion: 2` + schema-valid ⇒ v2; unparseable JSON, half-written/truncated content, or
schema-invalid ⇒ corrupt), and `migrateV1ToV2(v1)` mapping `theme → appearance.theme`,
`fontSize → appearance.fontSize`, `autoUpdate → updates.auto`, filling `updates.channel` and
`appearance.density` with defaults and stamping `schemaVersion: 2`. Unknown v1 keys are dropped.
The real production fixture `tests/fixtures/prefs-v1.json` is a golden test: its migrated output
is asserted key by key. This is the heart of the risk, proved without touching a single real file.

**Acceptance criteria:**
- [ ] Production fixture migrates to the exact expected v2 object (golden assertion)
- [ ] Classifier: v1 happy path ⇒ `v1`; already-v2 ⇒ `v2`; truncated/half-written JSON, empty
      file and non-JSON garbage ⇒ `corrupt` — never a throw
- [ ] `migrateV1ToV2` output always passes the zod schema (asserted in tests); already-v2 input
      is never re-migrated

**Verification:**
- [ ] Tests pass: `npm test -- prefs/migrate`
- [ ] Typecheck clean: `npm run typecheck`

**Dependencies:** Task 1

**Files likely touched:**
- `src/prefs/migrate.ts`
- `tests/prefs/migrate.test.ts`
- `tests/fixtures/prefs-v1.json` (read-only fixture, provided)

**Estimated scope:** S (1–2 files)

## Task 3: Atomic, recoverable, self-verifying disk migration runner (not wired)

**Description:** The on-disk runner `runPrefsMigration(prefsPath)` — deliberately **not** called
from app start yet. Flow for a v1 file: (1) copy original bytes to `prefs.json.v1.bak`;
(2) write the migrated JSON to a temp file in the same directory; (3) rename over `prefs.json`;
(4) read back and validate against the zod schema — on failure restore the original bytes and
return a defaults-fallback result. Corrupt input ⇒ preserve as `prefs.json.bak`, return defaults,
never crash. Absent file ⇒ `fresh` result, no write. v2 file ⇒ no-op (idempotent). Every outcome
is appended to a small journal file next to the prefs file (timestamp, source, result, error) —
our only forensic trail given zero telemetry. Tests run against temp directories and simulate
crash-adjacent states: stale temp file left behind (ignored/cleaned, original intact), corrupt
input, re-run idempotence, unwritable directory (falls back to in-memory defaults, no crash).

**Acceptance criteria:**
- [ ] `prefs.json` is never truncated in place: at any observable intermediate state the
      original file is either fully intact or already fully replaced (temp+rename)
- [ ] Every failure path leaves the original v1 bytes recoverable (`.v1.bak`, `.bak`, or
      untouched original) and returns a usable result instead of throwing
- [ ] Read-back validation gates success; journal records every outcome; re-run on v2 is a no-op

**Verification:**
- [ ] Tests pass: `npm test -- prefs/runner`
- [ ] Typecheck clean: `npm run typecheck`
- [ ] Manual check: run the runner in a scratch dir against the prod fixture, a corrupt file and
      a v2 file; inspect resulting files, backups and journal by hand

**Dependencies:** Task 2

**Files likely touched:**
- `src/prefs/migration-runner.ts`
- `tests/prefs/migration-runner.test.ts`

**Estimated scope:** M (2–3 files)

## Task 4: Prefs store API v2 — namespaced get/set + temporary compat shim

**Description:** Rewrite `src/prefs/store.ts` around namespaced paths (`get("appearance.theme")`,
`set("updates.channel", "beta")`), typed against the v2 schema so an invalid path or value is a
compile-time error where possible and a zod error otherwise. Keep the existing flat-key API as a
thin deprecated shim delegating to the new one, so the ~9 call sites keep compiling until Task 5
flips them — the repo never goes red between tasks. No call-site changes here.

**Acceptance criteria:**
- [ ] New namespaced `get`/`set` covers every v2 field, validates writes through the schema
- [ ] Old flat-key API still works (delegating), marked deprecated
- [ ] Store unit tests cover get/set round-trips and rejection of invalid values

**Verification:**
- [ ] Tests pass: `npm test -- prefs/store`
- [ ] Typecheck clean: `npm run typecheck`

**Dependencies:** Task 1

**Files likely touched:**
- `src/prefs/store.ts`
- `tests/prefs/store.test.ts`

**Estimated scope:** M (2 files)

## Task 5: Flip the ~9 call sites and remove the shim

**Description:** Mechanical, type-driven sweep: grep the flat-key usages across `src/`
(~9 call sites per the spec, including the existing reads in `src/settings/SettingsScreen.tsx`),
convert each to the namespaced API, then delete the compat shim — `tsc` failing on any leftover
flat-key call is the completion proof. This is the task the spec's "coordinate with the team
before merging" constraint targets: it is deliberately a single task (splitting it would invite
parallel edits to the same files and merge conflicts) and should land in an agreed merge window.

**Acceptance criteria:**
- [ ] Zero flat-key API usages remain (`grep` clean) and the shim is deleted
- [ ] Behavior at every call site is unchanged (existing tests still pass)
- [ ] Merge is coordinated with the team (agreed window / heads-up)

**Verification:**
- [ ] Full suite passes: `npm test`
- [ ] Typecheck clean: `npm run typecheck` (the real proof — shim gone, nothing references it)

**Dependencies:** Task 4

**Files likely touched:**
- ~9 call sites across `src/` (incl. `src/settings/SettingsScreen.tsx`), plus `src/prefs/store.ts`
  (shim removal)

**Estimated scope:** L (6–10 files — mechanical and type-driven; kept as one task on purpose,
see description)

## Task 6: Wire the migration runner into app start

**Description:** Call `runPrefsMigration` during app bootstrap, before the prefs store
initializes, and hand its result to the store. Fresh install ⇒ store starts from pure v2
defaults and writes nothing until the first `set`. Corrupt ⇒ defaults + `.bak` preserved, app
starts normally. Integration tests cover the four start states end-to-end (fresh / v1 / v2 /
corrupt). This only lands after Checkpoint 1's human approval.

**Acceptance criteria:**
- [ ] All four start states boot the app with correct prefs and correct on-disk artifacts
- [ ] Fresh install performs no startup write
- [ ] A failed migration (simulated) still boots the app on defaults with the original file
      recoverable

**Verification:**
- [ ] Tests pass: `npm test -- integration/prefs-startup`
- [ ] Typecheck clean: `npm run typecheck`
- [ ] Manual check: launch the app once with a real v1 file in place; confirm migrated file,
      `.v1.bak`, journal entry and working settings

**Dependencies:** Task 3, Task 4

**Files likely touched:**
- app bootstrap module (entry point)
- `src/prefs/store.ts` (init path)
- `tests/integration/prefs-startup.test.ts`

**Estimated scope:** M (3 files)

## Task 7: Settings UI — density and update channel

**Description:** Add `appearance.density` (comfortable|compact) and `updates.channel`
(stable|beta) to `src/settings/SettingsScreen.tsx`, grouped under the existing "Appearance" and
"Updates" sections, reading and writing exclusively through the namespaced store API. Render
tests assert grouping, current-value display, and that changing a control issues the right
`set` call.

**Acceptance criteria:**
- [ ] Both settings render in the correct sections with correct current values
- [ ] Changing each control persists through the store (asserted via store spy/mock)
- [ ] No direct file access from the UI layer

**Verification:**
- [ ] Tests pass: `npm test -- settings`
- [ ] Typecheck clean: `npm run typecheck`
- [ ] Manual check: toggle both settings in the running app; restart; values persist

**Dependencies:** Task 5

**Files likely touched:**
- `src/settings/SettingsScreen.tsx`
- `tests/settings/SettingsScreen.test.tsx`

**Estimated scope:** M (2–3 files)

## Task 8: docs/preferences.md — v2 format, migration and recovery

**Description:** Document the v2 file format (shape, defaults, `schemaVersion`), the migration
behavior (when it runs, atomicity, idempotence), and — critically — the recovery story:
`prefs.json.v1.bak` after a successful migration, `prefs.json.bak` for corrupt input, the
journal file, and the downgrade caveat (old app versions cannot read v2; restore from
`.v1.bak`). This page is what support will use with an affected user, so failure paths get
first-class treatment.

**Acceptance criteria:**
- [ ] A reader can determine from the doc alone which backup file to restore in each failure
      scenario
- [ ] v2 format and defaults fully documented, including both new settings

**Verification:**
- [ ] Manual check: doc reviewed against the actual runner behavior (file names, journal format)

**Dependencies:** Task 6

**Files likely touched:**
- `docs/preferences.md`

**Estimated scope:** XS (1 file)

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Failed/half-written migration bricks a user's prefs, and no telemetry will ever report it | High | Migration core is pure + exhaustively tested first (Tasks 1–3); atomic temp+rename; v1 bytes always preserved (`.v1.bak` on success, `.bak` on corrupt, untouched on crash); read-back self-verification; local journal breadcrumb; **human gate at Checkpoint 1 before any wiring** |
| Migration is subtly wrong but schema-valid (silent data corruption) | High | Golden test against the real production fixture asserts every migrated key; `.v1.bak` retained so even a wrong-but-valid migration is recoverable |
| User downgrades the app after migration — old version cannot read v2 | Medium | `.v1.bak` kept after successful migration + documented restore path in `docs/preferences.md` |
| Crash mid-migration (power loss, kill) | High | Same-directory temp file + rename; stale temp ignored on next start; original intact until the rename; idempotent re-run |
| Store API flip touches ~9 files → merge conflicts / breaking teammates | Medium | New-API-plus-shim keeps repo green (Task 4); flip is one coordinated, type-driven task (Task 5) landed in an agreed merge window (spec constraint) |
| Fresh-install regression (no file ever existed) | Medium | Dedicated start-state integration tests; fresh installs never write at startup |
| Corrupt/unreadable file crashes app start | High | Classifier never throws; corrupt ⇒ defaults + `.bak`; covered by unit and integration tests |

## Parallelization Opportunities

- **Safe to parallelize:** T-004 (store API) alongside T-002/T-003 (both depend only on T-001);
  T-007 (UI) alongside T-008 (docs).
- **Must be sequential:** the entire migration chain T-001 → T-002 → T-003 → (checkpoint) →
  T-006; the call-site flip T-005 after T-004.
- **Needs coordination:** T-005 (team-wide call-site change — agreed merge window).

## Open Questions

- Confirm with the team: is keeping `prefs.json.v1.bak` after a *successful* migration
  acceptable (one extra file in `~/.config/acme/`)? This plan recommends yes — it is the only
  recovery path for a wrong-but-valid migration and for app downgrades. If rejected, drop step
  (1) of Task 3 and update Task 8.
- Confirm defaults for the new settings (`updates.channel: "stable"`,
  `appearance.density: "comfortable"`) with product before Task 1 lands.
- Should the journal file have a retention/size cap? (Plan assumes append with a small cap,
  e.g. last 20 entries.)
