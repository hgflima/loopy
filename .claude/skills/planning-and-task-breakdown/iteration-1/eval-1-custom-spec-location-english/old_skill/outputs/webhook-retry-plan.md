# Implementation Plan: Webhook delivery retry with exponential backoff

> Source spec: `docs/specs/webhook-retry-spec.md`

## Overview

Replace the current silent-drop behavior in `src/webhooks/deliver.ts` with a retry
pipeline: transient failures (network errors, 5xx) are retried up to `maxAttempts`
(default 5) with exponentially backed-off, jittered delays; 4xx responses fail
permanently with no retry; exhausted events land in a new Postgres
`webhook_dead_letters` table; and an operator-facing replay CLI re-delivers
dead-lettered events. Configuration flows through the shared `src/config/index.ts`
with env-var overrides, and both retry and dead-letter events increment counters via
the existing `src/metrics/client.ts`.

## Architecture Decisions

- **Backoff schedule is a pure function** (`computeBackoffMs(attempt, baseMs, rng)`)
  with an injected RNG for jitter and no clock access. This makes the schedule
  deterministic in unit tests (spec requirement 6) and keeps the math independent of
  the scheduling mechanism.
- **Retries are scheduled off the hot path** using in-process timers (`setTimeout` /
  a small retry queue) — never `await`-ed inside the main delivery loop, satisfying
  the "must not regress the hot path" constraint without new runtime dependencies.
  Trade-off: in-flight scheduled retries do not survive a process restart; the
  dead-letter table + replay CLI is the durable safety net. (Recorded as an open
  question below in case stronger durability is wanted.)
- **Dead-letter access goes through one small repository module**
  (`src/webhooks/deadLetterRepo.ts`: `insert`, `listSince`, `deleteById`) so the
  delivery path and the replay CLI share the same Knex queries instead of
  duplicating SQL. Its interface is defined in the foundation phase so dependent
  tasks can be parallelized against a fixed contract.
- **Failure classification is explicit**: network error or 5xx → retryable;
  any 4xx → permanent (per spec; 429 is deliberately *not* special-cased — see Open
  Questions).
- **No new runtime dependencies**: jitter uses `Math.random` (injected), scheduling
  uses Node timers, persistence uses the existing Knex setup in `src/db/`.

## Dependency Graph

```
Task 1: Config (maxAttempts, base + env overrides)   Task 3: DB migration + dead-letter repo
    │                                                     │
Task 2: Pure backoff schedule + unit tests                │
    │                                                     │
    └────────────┬────────────────────────────────────────┤
                 │                                        │
        Task 4: Retry orchestration in deliver.ts         │
        (classification, scheduling, webhook.retry)       │
                 │                                        │
                 ├────────────────────────────────────────┤
                 │                                        │
        Task 5: Dead-letter on exhaustion         Task 6: Replay CLI
        (persist + webhook.dead_letter,           (npm run webhooks:replay --since)
         integration test)                                │
                 │                                        │
                 └──────────────┬─────────────────────────┘
                                │
                     Task 7: Docs (retry semantics + replay runbook)
```

## Task List

### Phase 1: Foundation (Tasks 1–3 are mutually independent — parallel-safe)

## Task 1: Webhook retry configuration

**Description:** Add `webhooks.maxAttempts` (default 5) and `webhooks.backoffBaseMs`
to the shared `src/config/index.ts`, read from env vars `WEBHOOK_MAX_ATTEMPTS` and
`WEBHOOK_BACKOFF_BASE_MS` when present, with validation (positive integers) and
sane fallbacks. `src/config/index.ts` is shared with other features, so the change
must be additive only — no restructuring of existing keys.

**Acceptance criteria:**
- [ ] Defaults apply when env vars are unset (`maxAttempts = 5`, documented base default)
- [ ] `WEBHOOK_MAX_ATTEMPTS` / `WEBHOOK_BACKOFF_BASE_MS` override the defaults and are parsed/validated as positive integers
- [ ] Existing config keys and their consumers are untouched

**Verification:**
- [ ] Unit tests pass: `npm test -- --grep "config"`
- [ ] `npm run typecheck` green
- [ ] Manual check: grep confirms no existing config export changed shape

**Dependencies:** None

**Files likely touched:**
- `src/config/index.ts`
- `tests/config/webhooks.test.ts` (new)

**Estimated scope:** S (1–2 files)

## Task 2: Pure backoff schedule with deterministic tests

**Description:** Create a pure module exporting `computeBackoffMs(attempt, baseMs, rng)`
implementing `base * 2^attempt` plus jitter, and `isRetryable(error | response)`
classifying network errors and 5xx as retryable and 4xx as permanent. No I/O, no
clock, no config reads — all inputs injected. Unit-test the full schedule for the
default 5 attempts with a seeded/stubbed RNG (spec requirement 6: deterministic with
injected clock/RNG).

**Acceptance criteria:**
- [ ] Schedule for attempts 0..4 equals `base * 2^attempt` plus the injected jitter, verified exactly with a stubbed RNG
- [ ] `isRetryable` returns true for network errors and 5xx, false for every 4xx
- [ ] Module has zero imports from config, db, or metrics (pure)

**Verification:**
- [ ] Unit tests pass: `npm test -- --grep "backoff"`
- [ ] `npm run typecheck` green

**Dependencies:** None

**Files likely touched:**
- `src/webhooks/backoff.ts` (new)
- `tests/webhooks/backoff.test.ts` (new)

**Estimated scope:** S (1–2 files)

## Task 3: Dead-letter migration + repository module

**Description:** Add a reversible Knex migration creating `webhook_dead_letters`
(columns: event id, endpoint, payload, attempts, last error, `failed_at`; index on
`failed_at` for the replay `--since` query) and a repository module
`src/webhooks/deadLetterRepo.ts` exposing `insert(row)`, `listSince(date)`, and
`deleteById(id)`. This module is the contract Tasks 5 and 6 build against — freeze
its interface here.

**Acceptance criteria:**
- [ ] Migration up creates the table with all spec'd columns; migration down drops it cleanly (reversible, per constraint)
- [ ] Repository round-trips: insert → listSince finds it → deleteById removes it
- [ ] `listSince` filters on `failed_at >= date`

**Verification:**
- [ ] Migration applies and rolls back: `npx knex migrate:latest && npx knex migrate:rollback` (or the project's equivalent scripts)
- [ ] Integration tests pass: `npm test -- --grep "dead-letter repo"`
- [ ] `npm run typecheck` green

**Dependencies:** None

**Files likely touched:**
- `src/db/migrations/<timestamp>_create_webhook_dead_letters.ts` (new)
- `src/webhooks/deadLetterRepo.ts` (new)
- `tests/webhooks/deadLetterRepo.test.ts` (new)

**Estimated scope:** M (3 files)

### Checkpoint: Foundation
- [ ] All Phase 1 tests pass, `npm run typecheck` green
- [ ] Migration proven reversible (up + down)
- [ ] Repository interface reviewed — it is the contract for Tasks 5 and 6
- [ ] Review with human before proceeding

### Phase 2: Core delivery path (sequential: Task 4 → Task 5)

## Task 4: Retry orchestration in the delivery path

**Description:** Wire retry behavior into `src/webhooks/deliver.ts`: on a retryable
failure (per Task 2's classifier), schedule the next attempt after the backoff delay
using non-blocking timers — the main delivery loop must never await a backoff sleep.
Read `maxAttempts`/`backoffBaseMs` from Task 1's config. Increment `webhook.retry`
via `src/metrics/client.ts` on every scheduled retry. 4xx responses short-circuit to
permanent failure with zero retries. (Dead-letter persistence on exhaustion is
Task 5 — here, exhaustion may temporarily log.)

**Acceptance criteria:**
- [ ] Flaky endpoint (2 failures then success) receives the event exactly once and delivery succeeds (spec success criterion 1)
- [ ] 4xx response produces no retry attempts and no `webhook.retry` increment (spec requirement 6: short-circuit test)
- [ ] Retries never block the hot path: the delivery loop returns before backoff timers fire (assert via injected fake timers/clock)
- [ ] `webhook.retry` incremented once per retry attempt

**Verification:**
- [ ] Tests pass: `npm test -- --grep "deliver retry"` (fake timers for determinism)
- [ ] `npm run typecheck` green
- [ ] Manual check: no `await sleep(...)` in the main delivery loop code path

**Dependencies:** Tasks 1, 2

**Files likely touched:**
- `src/webhooks/deliver.ts`
- `src/webhooks/retryScheduler.ts` (new, if the timer queue warrants its own module)
- `tests/webhooks/deliver.retry.test.ts` (new)

**Estimated scope:** M (3–4 files)

## Task 5: Dead-letter persistence on exhaustion

**Description:** After the final failed attempt (attempt `maxAttempts`), persist the
event to `webhook_dead_letters` through Task 3's repository — event id, endpoint,
payload, attempts count, last error message, `failed_at` — and increment
`webhook.dead_letter`. Add the integration test for the dead-letter path (spec
requirement 6) covering the spec's dead-endpoint success criterion.

**Acceptance criteria:**
- [ ] A permanently failing (5xx/network-error) endpoint produces exactly one `webhook_dead_letters` row after 5 attempts, with `attempts = 5` and the last error recorded
- [ ] Backoff timestamps between attempts are jittered and exponentially spaced (assert against the injected clock/RNG)
- [ ] `webhook.dead_letter` incremented exactly once per dead-lettered event

**Verification:**
- [ ] Integration test passes: `npm test -- --grep "dead-letter path"`
- [ ] `npm run typecheck` green

**Dependencies:** Tasks 3, 4

**Files likely touched:**
- `src/webhooks/deliver.ts`
- `tests/webhooks/deadLetter.integration.test.ts` (new)

**Estimated scope:** S (2 files)

### Checkpoint: Core delivery path
- [ ] `npm test` and `npm run typecheck` green
- [ ] End-to-end: flaky endpoint → exactly-once delivery; dead endpoint → dead-letter row (spec success criteria 1–2)
- [ ] Metrics counters observed incrementing in tests
- [ ] Review with human before proceeding

### Phase 3: Operator tooling and docs (Tasks 6 and 7 parallel-safe with each other)

## Task 6: Replay CLI

**Description:** Add a `webhooks:replay` npm script backed by
`src/webhooks/replayCli.ts` that parses `--since <date>`, loads matching rows via
`deadLetterRepo.listSince`, re-delivers each through the existing delivery function
(with normal retry semantics), and deletes the row on success — leaving it in place
on failure. Exit non-zero if any replay fails.

**Acceptance criteria:**
- [ ] `npm run webhooks:replay -- --since <date>` re-delivers only rows with `failed_at >= date`
- [ ] Rows are deleted on successful delivery and retained on failure (spec success criterion 3: table empties on success)
- [ ] Invalid/missing `--since` exits non-zero with a usage message

**Verification:**
- [ ] Tests pass: `npm test -- --grep "replay"`
- [ ] `npm run typecheck` green
- [ ] Manual check: seed a dead-letter row, run the CLI against a healthy endpoint, confirm the table is empty

**Dependencies:** Tasks 3, 4

**Files likely touched:**
- `src/webhooks/replayCli.ts` (new)
- `package.json` (add `webhooks:replay` script)
- `tests/webhooks/replayCli.test.ts` (new)

**Estimated scope:** M (3 files)

## Task 7: Documentation

**Description:** Update `docs/webhooks.md` with the retry semantics (backoff formula,
jitter, retryable vs. permanent failures, defaults and the two env vars) and a replay
runbook (when to replay, the exact command, how to verify the table drained, what a
failed replay means).

**Acceptance criteria:**
- [ ] Retry semantics section documents the formula, `maxAttempts`/`base` defaults, and `WEBHOOK_MAX_ATTEMPTS`/`WEBHOOK_BACKOFF_BASE_MS`
- [ ] Runbook section gives the copy-pasteable replay command and verification steps
- [ ] Dead-letter table schema and its non-durability trade-off (in-flight retries lost on restart) are documented

**Verification:**
- [ ] Manual check: every documented command and env var matches the implementation
- [ ] Docs reviewed against spec requirement 7

**Dependencies:** Tasks 4, 5, 6 (documents final behavior; a draft may start earlier)

**Files likely touched:**
- `docs/webhooks.md`

**Estimated scope:** XS (1 file)

### Checkpoint: Complete
- [ ] All four spec success criteria verified (exactly-once on flaky endpoint; dead-letter after 5 jittered attempts; replay empties table; `npm test` + `npm run typecheck` green)
- [ ] Migration down still applies cleanly
- [ ] No new runtime dependencies introduced (`git diff package.json` shows only the script addition)
- [ ] Ready for review

## Parallelization Map (for multiple agents/sessions)

| Wave | Tasks | Notes |
|------|-------|-------|
| 1 | 1, 2, 3 in parallel | Fully independent files; three agents can run concurrently |
| 2 | 4 | Sequential — integrates Tasks 1+2 into the shared `deliver.ts` |
| 3 | 5 and 6 in parallel | Both build on the frozen `deadLetterRepo` contract from Task 3; Task 5 touches `deliver.ts`, Task 6 touches only new CLI files + `package.json` — disjoint file sets |
| 4 | 7 | Documents the finished behavior (draft may start during wave 3) |

**Coordination rules:**
- **Must be sequential:** the Knex migration (Task 3) relative to any other migration work in flight; anything editing `src/webhooks/deliver.ts` (Tasks 4 → 5).
- **Needs a contract first:** Tasks 5 and 6 depend on the `deadLetterRepo` interface — Task 3 defines it and it must not change afterward without notifying both.
- **Shared-file caution:** `src/config/index.ts` is read by other features — Task 1 is additive-only and should merge before unrelated config changes land.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Jitter/timing makes tests flaky | High | Pure backoff function with injected RNG; fake timers/injected clock in all retry tests (Tasks 2, 4, 5) |
| Retry scheduling accidentally blocks the hot path | High | Architecture decision: fire-and-forget timer queue; explicit non-blocking assertion in Task 4's tests |
| Duplicate delivery (at-least-once drift) on flaky endpoints | Med | Exactly-once success criterion tested in Task 4; retries only scheduled after a definitive failure result |
| In-flight retries lost on process restart | Med | Accepted trade-off (no new deps); dead-letter + replay is the recovery path; documented in Task 7; escalate if durability is required |
| Migration irreversibility breaks rollback | Med | Down migration written and exercised in Task 3's verification |
| `src/config/index.ts` merge conflicts with other features | Low | Task 1 is additive-only and lands first (wave 1) |

## Open Questions

- Should HTTP 429 (rate-limited) be treated as retryable, possibly honoring
  `Retry-After`? The spec classifies all 4xx as permanent — following the spec, but
  this is a likely follow-up.
- Is losing in-flight scheduled retries on process restart acceptable, or should
  retry state be persisted (e.g., dead-letter earlier and rely on replay)? Current
  plan accepts the loss per the no-new-dependencies constraint.
- Replay CLI at scale: does `--since` need batching/pagination or a concurrency cap
  for large dead-letter backlogs? Plan assumes sequential replay is acceptable.
- Where should the retryable/permanent boundary live for ambiguous cases (e.g.,
  DNS failures vs. TLS errors)? Plan treats all network-level errors as retryable.
