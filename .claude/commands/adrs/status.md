---
disable-model-invocation: true
description: Executa uma transição de status validada em um ADR
---

Invoke the adr_management skill.

Usage: `/adrs:status NNNN <new-status>` where NNNN is the four-digit ADR number and `<new-status>` is the target status.

Valid transitions (from the state machine):
- `proposed` → `accepted` or `rejected`
- `accepted` → `deprecated` or `superseded`
- `rejected`, `deprecated`, `superseded` are terminal — no transitions allowed

Steps:

1. Read `docs/adrs/NNNN-*.md` to get its current status.
2. Validate the transition using the state machine (`node .harn/adrs/scripts/validate.mjs`). If invalid, explain why and stop.
3. Show the user the proposed change (`status: <new-status>`, `status_date: today`) and ask for confirmation.
4. On approval, update only the `status` and `status_date` fields in the ADR's frontmatter.
5. Run `node .harn/adrs/scripts/reindex.mjs`.
