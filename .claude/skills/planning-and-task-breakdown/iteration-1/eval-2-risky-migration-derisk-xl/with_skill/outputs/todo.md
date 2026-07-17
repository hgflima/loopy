# Backlog: C-0108 — User preferences schema v2 (migration + settings UI)

> Consumed by tooling (`- [ ]` pending / `- [x]` done; id `T-\d+`; indented body).
> Narrative, dependency graph, checkpoints and risks: see `plan.md` (same directory).

## Phase 1 — De-risk the migration (T-001 ∥ T-002 ∥ T-003)

- [ ] T-001: Build the v1 fixture corpus and freeze the migration decision table
    Curate `tests/fixtures/` with one file per input class: the provided real production v1 file (`prefs-v1.json`), corrupt JSON, half-written/truncated file, already-v2 file, empty file, v1 with unknown extra keys, plus a golden expected-v2 output for the prod fixture. Write the decision table (input class → outcome: migrate / no-op / defaults+`.bak`) as `tests/fixtures/README.md`; every later migration task implements this table, and it gets human sign-off at the Phase 1 checkpoint (including the downgrade-insurance question from `plan.md`).
    Acceptance: every input class from spec req 2 has a fixture file; the decision table assigns exactly one outcome per class; golden v2 output for the prod fixture exists and is reviewed.
    Verification: `ls tests/fixtures` && `npx prettier --check tests/fixtures/README.md`
    Deps: none
    Files: tests/fixtures/prefs-v1.json, tests/fixtures/prefs-corrupt.json, tests/fixtures/prefs-half-written.json, tests/fixtures/prefs-v2.json, tests/fixtures/prefs-empty.json, tests/fixtures/prefs-v1-unknown-keys.json, tests/fixtures/prefs-v1.expected-v2.json, tests/fixtures/README.md
    Size: S
    Risk: M

- [ ] T-002: Spike — atomic write primitive proven crash-safe by fault injection
    Implement `writeFileAtomic(path, data)`: write to a temp file in the same directory, fsync, rename over the target. Add a fault-injection test that kills/aborts between temp-write and rename and asserts the original file is byte-identical (never truncated, never half-written). This is the de-risking spike for the Risk-XL migration: T-005 may not start until this proof exists. Record any platform caveats (rename atomicity, Windows) in the module docstring.
    Acceptance: fault-injection test proves an interrupted write leaves the target file untouched; a completed write is the full new content; no code path truncates the target in place.
    Verification: `npm test -- --grep "atomicWrite"` && `npm run typecheck`
    Deps: none
    Files: src/prefs/atomicWrite.ts, tests/prefs/atomicWrite.test.ts
    Size: S
    Risk: M

- [ ] T-003: Define prefs schema v2 with zod and exported defaults
    Create `src/prefs/schema.ts`: v2 shape with namespaced groups (`appearance.theme`, `appearance.fontSize`, `appearance.density`, `updates.auto`, `updates.channel`), mandatory `schemaVersion: 2`, enums for `updates.channel` (`stable|beta`) and `appearance.density` (`comfortable|compact`), and an exported `defaultPrefs` object (the pure-v2 defaults fresh installs receive). Export inferred TS types for the store and UI.
    Acceptance: zod schema rejects objects missing `schemaVersion: 2` and invalid enum values; `defaultPrefs` parses against the schema; types are exported.
    Verification: `npm test -- --grep "prefs schema"` && `npm run typecheck`
    Deps: none
    Files: src/prefs/schema.ts, tests/prefs/schema.test.ts
    Size: S
    Risk: S

## Phase 2 — Pure migration (T-004)

- [ ] T-004: Implement the pure v1→v2 migration and classification function
    In `src/prefs/migrate.ts`, implement a pure, I/O-free function `classifyAndMigrate(input: unknown)` returning `{ kind: 'migrated' | 'already-v2' | 'corrupt', prefs }` per T-001's decision table: map flat v1 keys to namespaced ones, fill `updates.channel` and `appearance.density` with defaults, stamp `schemaVersion: 2`; anything unparseable or unclassifiable resolves fail-safe to `corrupt` + defaults. Unit-test it over the entire T-001 fixture corpus, asserting the prod fixture migrates to the golden v2 output.
    Acceptance: one test per fixture class, all green; prod fixture output deep-equals the golden file; function performs no filesystem access.
    Verification: `npm test -- --grep "migrate v1"` && `npm run typecheck`
    Deps: T-001, T-003
    Files: src/prefs/migrate.ts, tests/prefs/migrate.test.ts
    Size: S
    Risk: M

## Phase 3 — Migration I/O (T-005 → T-006)

- [ ] T-005: Wire the startup migration runner with atomic write, .bak and fresh-install path
    Add `runMigration(prefsPath)` to `src/prefs/migrate.ts` and call it from app start (assumed `src/main.ts` — adjust to the real entry point): read the file, `classifyAndMigrate`, then act — `migrated` ⇒ write via `writeFileAtomic`; `already-v2` ⇒ no-op; `corrupt` ⇒ preserve original as `prefs.json.bak` and write defaults atomically; missing file (fresh install) ⇒ write `defaultPrefs`. Never truncate in place; never crash the app on any input. Integration tests cover all five paths using the fixture corpus in a temp dir.
    Acceptance: all five integration paths green (v1 happy, corrupt→`.bak`+defaults, already-v2 no-op, half-written→`.bak`+defaults, missing file→defaults); `prefs.json.bak` content is byte-identical to the broken original; app start never throws on any fixture.
    Verification: `npm test -- --grep "migration runner"` && `npm run typecheck`
    Deps: T-002, T-004
    Files: src/prefs/migrate.ts, src/main.ts, tests/prefs/migrate.integration.test.ts
    Size: M
    Risk: L

- [ ] T-006: Torture-test the migration — crash injection and idempotency
    Extend the integration suite with adversarial runs: (a) simulate a crash between temp-write and rename during a real migration, then relaunch and assert the second run completes correctly from the untouched v1 file (self-healing); (b) run the migration N times over an already-migrated file and assert byte-identical output every time (idempotent); (c) run it over a directory with a stale temp file left behind and assert it still succeeds. These tests are the substitute for the telemetry we do not have.
    Acceptance: crash-then-relaunch test green; idempotency test green; stale-temp-file test green.
    Verification: `npm test -- --grep "migration torture"` && `npm run typecheck`
    Deps: T-005
    Files: tests/prefs/migrate.torture.test.ts
    Size: S
    Risk: S

## Phase 4 — Store API + call sites (T-007 → T-008)

- [ ] T-007: Move the prefs store API to namespaced paths
    Rework `src/prefs/store.ts`: `get`/`set` take namespaced paths (e.g. `appearance.theme`), typed from the T-003 schema; persistence goes through `writeFileAtomic`; defaults come from `defaultPrefs`. Keep the old flat-key surface intact in this task (removal happens with the T-008 cutover) so the app builds at every commit. Store API unit tests per spec req 5.
    Acceptance: namespaced `get`/`set` round-trip all v2 keys with correct types; invalid paths are compile-time errors or explicit runtime errors; store tests green.
    Verification: `npm test -- --grep "prefs store"` && `npm run typecheck`
    Deps: T-002, T-003
    Files: src/prefs/store.ts, tests/prefs/store.test.ts
    Size: S
    Risk: M

- [ ] T-008: Cut all call sites over to the namespaced store API
    Update the ~9 flat-key call sites across `src/` (grep for the old `get`/`set` usage) to namespaced paths, then delete the flat-key surface from `src/prefs/store.ts`. Single serialized task per the spec constraint — coordinate with the team before merging (Phase 4 checkpoint). If grep reveals more than 8 distinct files, split this task by subsystem before starting instead of growing it.
    Acceptance: zero flat-key call sites remain (grep clean); flat-key API removed; whole-repo typecheck and full test suite green.
    Verification: `npm run typecheck` && `npm test`
    Deps: T-007
    Files: src/prefs/store.ts, src/settings/SettingsScreen.tsx, src/ (call sites found by grep)
    Size: L
    Risk: M

## Phase 5 — Settings UI (T-009)

- [ ] T-009: Add the two new settings to the settings screen
    In `src/settings/SettingsScreen.tsx`, add `updates.channel` (stable|beta selector) under an "Updates" section and `appearance.density` (comfortable|compact selector) under "Appearance", reading/writing through the namespaced store. Render tests per spec req 5: sections and controls render, changing a control persists the value via the store. Serialized after T-008 because both tasks edit `SettingsScreen.tsx`.
    Acceptance: both settings render in their named sections; changing each persists through the store and survives remount; render tests green.
    Verification: `npm test -- --grep "SettingsScreen"` && `npm run typecheck`
    Deps: T-008
    Files: src/settings/SettingsScreen.tsx, tests/settings/SettingsScreen.test.tsx
    Size: S
    Risk: S

## Phase 6 — Docs (T-010)

- [ ] T-010: Document the v2 format and the migration
    Write `docs/preferences.md`: the v2 file format (namespaces, `schemaVersion`, defaults), the v1→v2 migration behavior per the T-001 decision table (including `.bak` semantics, fresh-install path, atomicity guarantee, and what a user/support person should do with a `prefs.json.bak`), and the downgrade caveat (old app versions cannot read v2).
    Acceptance: doc covers format, every decision-table outcome, `.bak` recovery guidance, and the downgrade caveat; examples match the actual fixtures.
    Verification: `npx prettier --check docs/preferences.md`
    Deps: T-006, T-009
    Files: docs/preferences.md
    Size: S
    Risk: S
