# Implementation Plan: Webhook delivery retry with exponential backoff

> Derives from `webhook-retry-spec.md` (same directory). Design decisions live in the spec —
> this plan decides the mechanics and the order, not the design.

## Overview

We replace silent webhook drop with a three-stage safety net: a scheduled, non-blocking retry
pipeline (exponential backoff + jitter, 4xx short-circuit), a `webhook_dead_letters` Postgres
table for terminally failed events, and a replay CLI that drains that table. The work splits
into three independent foundations (config, migration, pure backoff math) that fan into the
retry pipeline, which then fans out into verification, the replay CLI, and docs.

## Architecture Decisions

- **Retries are scheduled in-process (timer-based), never awaited on the hot path** — imposed
  by the spec constraints ("retries are scheduled, never block the main delivery loop"; "no new
  runtime dependencies"). No queue library, no worker process.
- **Backoff math and failure classification live in a pure module** (`src/webhooks/backoff.ts`)
  taking `(attempt, baseMs, rng)` — this is what makes the schedule deterministic under an
  injected clock/RNG, as the spec's test requirement demands.
- **Metrics are folded into the tasks that own the events**: `webhook.retry` increments inside
  the retry scheduler task (T-004), `webhook.dead_letter` inside the dead-letter task (T-005).
  A separate "metrics task" would be a third editor of the same files for two one-liners.
- **T-004 exports a reusable single-delivery seam** (`deliverOnce`) so the replay CLI (T-007)
  re-delivers without editing `deliver.ts` again.
- Requirements → tasks traceability: R1 → T-003+T-004 · R2 → T-002+T-005 · R3 → T-001 ·
  R4 → T-004+T-005 · R5 → T-007 · R6 → T-003/T-004 (unit) + T-006 (integration) · R7 → T-008.

## Dependency graph

```
T-001 (config) ────────┐
                       ├─► T-004 (retry scheduler) ─► T-005 (dead-letter) ─┬─► T-006 (integration tests) ─┐
T-003 (backoff, pure) ─┘                                  ▲                │                               ├─► T-008 (docs)
                                                          │                └─► T-007 (replay CLI) ────────┘
T-002 (migration) ────────────────────────────────────────┘
```

Initial Ready set (no deps): **T-001, T-002, T-003** — three lanes, safe to hand to three
agents at once. After T-005, **T-006 ∥ T-007** opens a second two-wide layer. Max useful
concurrency: 3.

Edges that exist (also) to serialize shared-file edits:

- **T-004 → T-005**: both touch `src/webhooks/retry.ts` (T-005 hooks dead-lettering into the
  final-attempt path). Logically dependent anyway, but this edge is load-bearing for the file.
- `src/config/index.ts` is a shared file other features read; **only T-001 touches it**, so no
  serialization edge is needed — do not let any other task "quickly add" a config key.

## Vertical slicing (why this order)

- **Phase 1** builds three self-contained foundations, each with its own unit tests, none
  touching `deliver.ts`. The system keeps working — nothing is wired yet.
- **Phase 2** is the risky heart: wiring scheduled retries into the delivery hot path (T-004),
  then terminal persistence (T-005). It comes as early as its deps allow because the
  non-blocking constraint is where the plan would sink if the approach is wrong (fail fast).
  After T-004 the system still works: failures retry and then drop (as today) until T-005 lands.
- **Phase 3** proves the end-to-end success criteria (T-006), adds the operator-facing drain
  (T-007) in parallel, and documents the settled semantics last (T-008) so docs never describe
  behavior that later changed.

## Phases & checkpoints

### Phase 1 — Foundations (T-001 ∥ T-002 ∥ T-003)

Config keys with env overrides, the reversible `webhook_dead_letters` migration, and the pure
backoff/classification module with deterministic unit tests.

**Checkpoint: Foundations**
- [ ] `npm test` and `npm run typecheck` green
- [ ] `npx knex migrate:latest` then `npx knex migrate:rollback` both succeed (migration reversible)
- [ ] Backoff unit tests are deterministic (injected RNG/clock, no real sleeps)

### Phase 2 — Retry pipeline (T-004 → T-005)

Scheduled retries wired into `deliver.ts` without blocking the delivery loop; 4xx
short-circuit; dead-letter persistence after the final attempt; both counters emitting.

**Checkpoint: Pipeline**
- [ ] Flaky-endpoint unit test (2 failures then success) shows exactly-once delivery
- [ ] Hot-path test proves the delivery loop continues while a retry is pending
- [ ] Dead-letter row written with attempts, last error, failed_at after exhaustion
- [ ] Review with human before proceeding

### Phase 3 — Verification, replay & docs (T-006 ∥ T-007, then T-008)

End-to-end integration proof of the success criteria, the replay CLI, and the runbook.

**Checkpoint: Complete**
- [ ] All four spec success criteria demonstrably met
- [ ] `npm run webhooks:replay -- --since <date>` empties the table on success
- [ ] `docs/webhooks.md` matches implemented semantics
- [ ] `npm test` and `npm run typecheck` green
- [ ] Review with human before merge

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Retry scheduling blocks or slows the delivery hot path | High | Pure timer-based scheduling, never `await`ed by the loop; explicit non-blocking unit test in T-004; highest-risk task placed first in phase 2 |
| Jitter/backoff nondeterminism makes tests flaky | Med | Backoff isolated as a pure function of `(attempt, baseMs, rng)`; injected clock (fake timers) everywhere; no real sleeps in tests |
| In-process pending retries are lost on process restart (event never reaches dead-letter) | Med | Accepted for this change (spec forbids new runtime deps; durability of *pending* retries is out of scope) — flagged as open question #2 |
| Parallel agents editing shared files (`src/config/index.ts`, `retry.ts`) | Med | Single-owner rule for config (T-001 only); T-004 → T-005 edge serializes `retry.ts`; no other file overlaps across parallel lanes |
| Replay double-delivers if endpoint succeeds but delete fails | Low | Delete row only after confirmed success, one row per transaction; document at-least-once semantics for replay in the runbook |
| Migration wrong shape discovered late by dependents (T-005/T-007) | Med | Migration lands in phase 1 with reversible down; column set fixed verbatim from spec R2 |

## Open questions

1. **Do 4xx permanent failures get dead-lettered?** The spec says 4xx = no retry (R1) and
   "after the final failed attempt, persist" (R2). Default taken here: **yes** — a 4xx is a
   final failed attempt (`attempts = 1`), and the spec's core problem is "customers lose
   events". Veto by making T-005 drop 4xx instead; only T-005/T-006 change.
2. **Is losing in-flight (not yet dead-lettered) retries on process restart acceptable?**
   Assumed yes — durable pending-retry state would need a queue/table and contradicts the
   "no new runtime dependencies" constraint. Revisit as a follow-up change if not.
3. **Replay delivery semantics**: default taken — one immediate delivery attempt per row
   (no backoff cascade inside the CLI); on success delete the row, on failure keep it and
   update attempts/last error. Veto in T-007 if full retry-pipeline replay is preferred.
