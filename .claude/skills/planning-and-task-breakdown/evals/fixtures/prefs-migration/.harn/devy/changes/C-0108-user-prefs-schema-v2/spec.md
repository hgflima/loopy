# Spec: C-0108 — User preferences schema v2 (migration + settings UI)

## Context

The desktop app persists user preferences as JSON at `~/.config/acme/prefs.json`,
currently schema v1 (flat keys: `theme`, `fontSize`, `autoUpdate`). Thousands of
installs already have v1 files on disk. We need schema v2: preferences grouped by
namespace (`appearance.theme`, `appearance.fontSize`, `updates.auto`,
`updates.channel`), plus two new settings (`updates.channel`: `stable|beta`;
`appearance.density`: `comfortable|compact`).

## Requirements

1. **Schema v2 + validation**: define the v2 shape and a zod schema in
   `src/prefs/schema.ts`. A `schemaVersion: 2` field is mandatory.
2. **On-disk migration v1 → v2**: on app start, if the file has no `schemaVersion`
   (v1), migrate it in place: map old keys to namespaced ones, fill new settings
   with defaults, write `schemaVersion: 2`. Corrupt or unreadable files must not
   crash the app — fall back to defaults and keep the broken file as
   `prefs.json.bak`. **The old app version cannot read v2 files** — a failed or
   half-written migration bricks the user's preferences, and there is no telemetry
   to tell us if it happens in the wild.
3. **Settings UI**: add the two new settings to the existing settings screen
   (`src/settings/SettingsScreen.tsx`), grouped under "Appearance" and "Updates"
   sections, reading/writing through the prefs store (`src/prefs/store.ts`).
4. **Prefs store API**: `get`/`set` move from flat keys to namespaced paths; every
   call site updates (grep suggests ~9 call sites across `src/`).
5. **Tests**: migration unit tests (v1 happy path, corrupt file, already-v2,
   half-written file), store API tests, settings screen render tests.
6. **Docs**: `docs/preferences.md` documents the v2 format and the migration.

## Constraints

- Migration must be atomic: write to a temp file and rename, never truncate in place.
- No breaking the app for users who never had a prefs file (fresh install path).
- The store API change touches many files — coordinate with the team before merging.

## Success criteria

- A real v1 file from production migrates correctly (fixture provided in
  `tests/fixtures/prefs-v1.json`).
- Corrupt input never crashes; `.bak` is preserved.
- Fresh installs get pure v2 defaults.
- All tests green; typecheck clean.
