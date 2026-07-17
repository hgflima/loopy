# Backlog: C-0108 — User preferences schema v2 (migration + settings UI)

> Machine-parseable backlog (`- [ ]` pending / `- [x]` done; id `T-\d+`; indented body).
> Narrative, dependency graph, checkpoints and risks: see `plan.md` (same folder).
> **De-risk gate:** the on-disk migration can brick a user's prefs with zero telemetry.
> Tasks T-001..T-003 prove the migration in isolation; **T-006 (wiring into app start) must not
> land before a human has reviewed the failure-path evidence of T-003** (Checkpoint 1 in
> `plan.md`). Every failure path must leave the original v1 bytes recoverable on disk.
> Each `Deps:` line is isolated, clean ids, no trailing text.

## Phase 1 — De-risk the migration core (pure, offline; sequential chain)

- [ ] T-001: v2 schema, zod validation and defaults
    `src/prefs/schema.ts`: v2 shape — namespaces `appearance` (`theme`, `fontSize`,
    `density: comfortable|compact`) and `updates` (`auto`, `channel: stable|beta`) — with a
    mandatory `schemaVersion: 2` literal, plus a `v2Defaults()` factory (defaults:
    `channel: "stable"`, `density: "comfortable"`). Pure module, zero I/O.
    Tests: schema rejects missing `schemaVersion` and out-of-enum values; `v2Defaults()` output
    passes the schema.
    Acceptance: schema + defaults exported and fully typed; no I/O in the module.
    Verification: `npm test -- prefs/schema` and `npm run typecheck`
    Deps: nenhuma
    Files: src/prefs/schema.ts, tests/prefs/schema.test.ts
    Scope: S

- [ ] T-002: pure input classification + v1-to-v2 migration function
    `src/prefs/migrate.ts`, pure: (a) classifier over raw file content returning
    `v1 | v2 | corrupt` (no `schemaVersion` + parseable flat keys ⇒ v1; `schemaVersion: 2` +
    schema-valid ⇒ v2; truncated/half-written/garbage/empty ⇒ corrupt — never throws);
    (b) `migrateV1ToV2(v1)`: `theme → appearance.theme`, `fontSize → appearance.fontSize`,
    `autoUpdate → updates.auto`, fill `updates.channel`/`appearance.density` with defaults,
    stamp `schemaVersion: 2`, drop unknown v1 keys.
    Tests: **golden test against the real production fixture `tests/fixtures/prefs-v1.json`**
    asserting every migrated key; classifier cases for v1 happy path, already-v2, truncated
    JSON, empty file, non-JSON garbage; migrated output always passes the zod schema;
    already-v2 input is never re-migrated.
    Acceptance: the heart of the risk proven pure, without touching any real file.
    Verification: `npm test -- prefs/migrate` and `npm run typecheck`
    Deps: T-001
    Files: src/prefs/migrate.ts, tests/prefs/migrate.test.ts
    Scope: S

- [ ] T-003: atomic, recoverable, self-verifying disk migration runner (NOT wired to app start)
    `src/prefs/migration-runner.ts`: `runPrefsMigration(prefsPath)`. v1 flow: (1) copy the
    original bytes to `prefs.json.v1.bak`; (2) write migrated JSON to a temp file in the SAME
    directory; (3) rename over `prefs.json`; (4) read back and validate against the zod schema —
    on failure restore the original bytes and return a defaults-fallback result. Corrupt ⇒
    preserve as `prefs.json.bak` + return defaults, never crash. Absent ⇒ `fresh` result, no
    write. v2 ⇒ no-op (idempotent). Append every outcome (timestamp, source, result, error) to
    a small journal file next to the prefs file — the only forensic trail given zero telemetry.
    Never truncate `prefs.json` in place.
    Tests (temp dirs): happy path with the prod fixture; corrupt input; stale temp file left
    behind (ignored/cleaned, original intact); re-run idempotence; unwritable directory ⇒
    in-memory defaults without crash; read-back failure ⇒ original restored.
    Acceptance: every failure path leaves the original v1 bytes recoverable (`.v1.bak`, `.bak`,
    or untouched original) and returns a usable result instead of throwing. **This task feeds
    Checkpoint 1 (human de-risk gate) — see plan.md.**
    Verification: `npm test -- prefs/runner` and `npm run typecheck`
    Deps: T-002
    Files: src/prefs/migration-runner.ts, tests/prefs/migration-runner.test.ts
    Scope: M

## Phase 2 — Store API + wiring (T-004 may run parallel to T-002/T-003)

- [ ] T-004: prefs store API v2 — namespaced get/set + temporary compat shim
    `src/prefs/store.ts`: rewrite around namespaced paths (`get("appearance.theme")`,
    `set("updates.channel", "beta")`), typed against the v2 schema; writes validate through
    zod. Keep the old flat-key API as a thin deprecated shim delegating to the new one so the
    ~9 call sites keep compiling until T-005 — the repo never goes red between tasks. No
    call-site changes here.
    Tests: get/set round-trips for every v2 field; invalid values rejected; shim delegates.
    Verification: `npm test -- prefs/store` and `npm run typecheck`
    Deps: T-001
    Files: src/prefs/store.ts, tests/prefs/store.test.ts
    Scope: M

- [ ] T-005: flip the ~9 flat-key call sites and remove the shim (team-coordinated merge)
    Mechanical, type-driven sweep: grep flat-key usages across `src/` (~9 call sites per the
    spec, including the existing reads in `src/settings/SettingsScreen.tsx`), convert each to
    the namespaced API, then DELETE the compat shim — `tsc` failing on any leftover flat-key
    call is the completion proof. Kept as one task on purpose: splitting would invite parallel
    edits to the same files and merge conflicts. This is the task the spec's "coordinate with
    the team before merging" constraint targets — land it in an agreed merge window.
    Acceptance: zero flat-key usages remain (grep clean); shim deleted; behavior unchanged
    (existing tests pass).
    Verification: `npm test && npm run typecheck`
    Deps: T-004
    Files: ~9 call sites across src/ (incl. src/settings/SettingsScreen.tsx), src/prefs/store.ts
    Scope: L

- [ ] T-006: wire the migration runner into app start (only after the Checkpoint 1 human gate)
    App bootstrap calls `runPrefsMigration` BEFORE the prefs store initializes and hands the
    result to the store. Fresh install ⇒ store starts from pure v2 defaults and writes nothing
    until the first `set`. Corrupt ⇒ defaults + `.bak` preserved, app starts normally.
    Integration tests cover the four start states end-to-end: fresh / v1 / v2 / corrupt; plus a
    simulated failed migration still boots on defaults with the original file recoverable.
    **Precondition (process, not code): Checkpoint 1 approval in plan.md — a human reviewed the
    failure-path evidence of T-003.**
    Verification: `npm test -- integration/prefs-startup` and `npm run typecheck`; manual:
    launch once with a real v1 file, confirm migrated file + `.v1.bak` + journal + working
    settings
    Deps: T-003, T-004
    Files: app bootstrap entry, src/prefs/store.ts, tests/integration/prefs-startup.test.ts
    Scope: M

## Phase 3 — UI + docs (T-007 parallel to T-008)

- [ ] T-007: settings UI — appearance.density and updates.channel
    `src/settings/SettingsScreen.tsx`: add `appearance.density` (comfortable|compact) under the
    "Appearance" section and `updates.channel` (stable|beta) under "Updates", reading/writing
    exclusively through the namespaced store API — no direct file access from the UI layer.
    Render tests: both settings appear in the correct sections with correct current values;
    changing each control issues the right `set` call (store spy/mock).
    Verification: `npm test -- settings` and `npm run typecheck`; manual: toggle both settings,
    restart, values persist
    Deps: T-005
    Files: src/settings/SettingsScreen.tsx, tests/settings/SettingsScreen.test.tsx
    Scope: M

- [ ] T-008: docs/preferences.md — v2 format, migration and recovery
    Document: the v2 file format (shape, defaults, `schemaVersion`); when and how the migration
    runs (atomic temp+rename, idempotent); and the recovery story with first-class treatment —
    `prefs.json.v1.bak` after a successful migration, `prefs.json.bak` for corrupt input, the
    journal file, and the downgrade caveat (old app versions cannot read v2; restore from
    `.v1.bak`). A support person must be able to tell an affected user exactly which file to
    restore in each scenario, from the doc alone.
    Verification: manual review of the doc against the actual runner behavior (file names,
    journal format)
    Deps: T-006
    Files: docs/preferences.md
    Scope: XS
