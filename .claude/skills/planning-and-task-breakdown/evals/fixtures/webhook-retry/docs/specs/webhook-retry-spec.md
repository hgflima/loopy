# Spec: Webhook delivery retry with exponential backoff

## Context

Our Node/TypeScript service (`src/`) delivers webhooks to customer endpoints via
`src/webhooks/deliver.ts`. Today a failed POST is dropped silently. Customers lose
events whenever their endpoint blips.

## Requirements

1. **Retry with exponential backoff**: on delivery failure (network error or 5xx),
   retry up to `maxAttempts` (default 5) with backoff `base * 2^attempt` plus jitter.
   4xx responses are permanent failures — no retry.
2. **Dead-letter table**: after the final failed attempt, persist the event to a new
   `webhook_dead_letters` table (Postgres, via the existing Knex setup in
   `src/db/`): columns for event id, endpoint, payload, attempts, last error,
   failed_at. Include the migration.
3. **Config**: `maxAttempts` and `base` come from `src/config/index.ts` (shared file —
   other features read it too), overridable via env vars `WEBHOOK_MAX_ATTEMPTS` /
   `WEBHOOK_BACKOFF_BASE_MS`.
4. **Metrics**: increment counters `webhook.retry` and `webhook.dead_letter` through
   the existing `src/metrics/client.ts`.
5. **Replay CLI**: `npm run webhooks:replay -- --since <date>` re-delivers dead-letter
   rows and deletes them on success.
6. **Tests**: unit tests for the backoff schedule (deterministic with injected clock),
   integration test for the dead-letter path, test for 4xx short-circuit.
7. **Docs**: update `docs/webhooks.md` with the retry semantics and replay runbook.

## Constraints

- The delivery hot path must not regress: retries are scheduled, never block the
  main delivery loop.
- The migration must be reversible (down migration included).
- No new runtime dependencies without justification.

## Success criteria

- A flaky endpoint (2 failures then success) receives the event exactly once.
- A dead endpoint ends up in `webhook_dead_letters` after 5 attempts with jittered
  backoff timestamps.
- Replay CLI empties the table on success.
- `npm test` and `npm run typecheck` green.
