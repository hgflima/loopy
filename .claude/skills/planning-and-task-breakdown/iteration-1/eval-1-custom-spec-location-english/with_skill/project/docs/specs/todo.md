# Backlog: Webhook delivery retry with exponential backoff

> Consumed by tooling (`- [ ]` pending / `- [x]` done; id `T-\d+`; indented body).
> Narrative, dependency graph, checkpoints and risks: see `plan.md` (same directory).
> Derives from `webhook-retry-spec.md` (same directory).

## Phase 1 — Foundations (T-001 ∥ T-002 ∥ T-003)

- [ ] T-001: Add webhook retry settings to shared config with env overrides
    Add `webhook.maxAttempts` (default 5) and `webhook.backoffBaseMs` to `src/config/index.ts`,
    overridable via `WEBHOOK_MAX_ATTEMPTS` and `WEBHOOK_BACKOFF_BASE_MS`, following the file's
    existing key/env-parsing pattern. This is a shared file other features read — this is the
    only task allowed to touch it; change nothing outside the new keys.
    Acceptance: defaults apply when env vars are unset; env vars override and are parsed as integers; invalid env values fail loudly (or fall back per the file's existing convention); existing config keys and their tests are untouched.
    Verification: `npm test -- config && npm run typecheck`
    Deps: none
    Files: src/config/index.ts, tests/config/webhook.test.ts
    Size: S
    Risk: M

- [ ] T-002: Create reversible Knex migration for webhook_dead_letters
    New migration in the existing Knex setup (`src/db/`) creating `webhook_dead_letters` with
    columns: event id, endpoint, payload (jsonb), attempts, last error, failed_at — plus a
    primary key and an index on `failed_at` (the replay CLI filters by `--since`). Include the
    down migration dropping the table.
    Acceptance: `knex migrate:latest` creates the table with all spec R2 columns; `knex migrate:rollback` removes it cleanly; migration follows the naming/style of existing migrations in src/db/.
    Verification: `npx knex migrate:latest && npx knex migrate:rollback && npm run typecheck`
    Deps: none
    Files: src/db/migrations/XXXXXXXXXXXXXX_create_webhook_dead_letters.ts
    Size: S
    Risk: M

- [ ] T-003: Implement pure backoff schedule and failure classification module
    New `src/webhooks/backoff.ts` with two pure functions: `computeDelayMs(attempt, baseMs, rng)`
    returning `baseMs * 2^attempt` plus jitter derived from the injected `rng`, and
    `isRetryable(failure)` returning true for network errors and 5xx responses, false for 4xx.
    No imports from config or db — parameters only, so the module is deterministic under test.
    Acceptance: unit tests assert the exact schedule for attempts 0..4 with a fixed rng (no real timers or sleeps); jitter stays within its documented bound; 4xx classified permanent, 5xx and network errors retryable.
    Verification: `npm test -- backoff && npm run typecheck`
    Deps: none
    Files: src/webhooks/backoff.ts, tests/webhooks/backoff.test.ts
    Size: S
    Risk: S

## Phase 2 — Retry pipeline (T-004 → T-005)

- [ ] T-004: Wire scheduled non-blocking retries into webhook delivery
    New `src/webhooks/retry.ts` scheduling re-delivery via timers using T-003's schedule and
    T-001's config; wire it into `src/webhooks/deliver.ts` so a retryable failure schedules the
    next attempt and returns immediately — the delivery loop must never await a backoff. 4xx
    short-circuits as permanent failure (no retry scheduled). Increment `webhook.retry` via
    `src/metrics/client.ts` on each scheduled retry. Export a reusable `deliverOnce` seam for
    the replay CLI (T-007) so it never has to edit this file.
    Acceptance: with fake timers and an injected clock, a flaky endpoint (2 failures then success) receives the event exactly once and retries fire at the computed backoff times; a 4xx response schedules no retry; a test proves the delivery loop processes the next event while a retry is pending; `webhook.retry` increments once per retry.
    Verification: `npm test -- retry && npm run typecheck`
    Deps: T-001, T-003
    Files: src/webhooks/retry.ts, src/webhooks/deliver.ts, tests/webhooks/retry.test.ts
    Size: M
    Risk: L

- [ ] T-005: Persist exhausted deliveries to the dead-letter table
    New `src/webhooks/deadLetter.ts` inserting into `webhook_dead_letters` via the existing
    Knex setup (`src/db/`); hook it into `src/webhooks/retry.ts` on the final failed attempt —
    including 4xx permanent failures with `attempts = 1` (default from plan.md open question 1).
    Record event id, endpoint, payload, attempts, last error, failed_at. Increment
    `webhook.dead_letter` via `src/metrics/client.ts` on each insert.
    Acceptance: after `maxAttempts` exhausted, exactly one row exists with correct attempts/last error/failed_at; a 4xx failure dead-letters with attempts = 1; successful (including eventually-successful) deliveries write no row; `webhook.dead_letter` increments once per insert.
    Verification: `npm test -- deadLetter && npm run typecheck`
    Deps: T-002, T-004
    Files: src/webhooks/deadLetter.ts, src/webhooks/retry.ts, tests/webhooks/deadLetter.test.ts
    Size: M
    Risk: M

## Phase 3 — Verification, replay & docs (T-006 ∥ T-007 → T-008)

- [ ] T-006: Add integration tests covering the spec success criteria
    Integration test against a real (test) Postgres and a stub HTTP endpoint driving the full
    pipeline with fake timers: dead endpoint → row in `webhook_dead_letters` after 5 attempts
    with jittered, strictly-increasing backoff timestamps; flaky endpoint (2 failures then
    success) → delivered exactly once, table stays empty; 4xx → no retries, short-circuit
    behavior per T-005's decision.
    Acceptance: all three scenarios pass deterministically (injected clock/rng, no real sleeps); assertions check attempt timestamps against the computed schedule, not wall-clock tolerances.
    Verification: `npm test -- integration && npm run typecheck`
    Deps: T-005
    Files: tests/integration/webhook-retry.test.ts
    Size: M
    Risk: M

- [ ] T-007: Build the dead-letter replay CLI
    New `src/cli/webhooks-replay.ts` plus npm script `webhooks:replay` so that
    `npm run webhooks:replay -- --since <date>` selects rows with `failed_at >= since`,
    re-delivers each via T-004's `deliverOnce` seam, deletes the row on success (delete only
    after confirmed success), and on failure keeps the row updating attempts/last error
    (single immediate attempt per row — plan.md open question 3). No new runtime dependencies:
    parse `--since` with `process.argv`/`util.parseArgs`.
    Acceptance: replay of a table where all endpoints succeed empties the table; a still-failing row survives with updated last error; invalid or missing `--since` exits non-zero with a usage message; rows outside the window are untouched.
    Verification: `npm test -- replay && npm run typecheck`
    Deps: T-005
    Files: src/cli/webhooks-replay.ts, package.json, tests/cli/webhooks-replay.test.ts
    Size: M
    Risk: M

- [ ] T-008: Document retry semantics and replay runbook
    Update `docs/webhooks.md`: backoff formula (`base * 2^attempt` + jitter), defaults and the
    `WEBHOOK_MAX_ATTEMPTS`/`WEBHOOK_BACKOFF_BASE_MS` env overrides, 4xx-vs-5xx policy, the
    dead-letter table shape, the non-blocking scheduling model (including the restart caveat
    from plan.md open question 2), and an operator runbook for `npm run webhooks:replay`.
    Acceptance: every documented behavior matches the implemented semantics (formula, defaults, env names, dead-letter columns, replay flags); runbook includes a worked `--since` example and the failure-row behavior.
    Verification: `npm run typecheck && npm test`
    Deps: T-006, T-007
    Files: docs/webhooks.md
    Size: XS
    Risk: S
