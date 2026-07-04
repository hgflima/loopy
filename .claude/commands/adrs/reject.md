---
disable-model-invocation: true
description: Marca um ADR proposto como rejected
---

Invoke the adr_management skill.

Usage: `/adrs:reject NNNN` where NNNN is the four-digit number of the ADR to reject.

Steps:

1. Read `docs/adrs/NNNN-*.md` to confirm it exists and its current status is `proposed` (the only status that can transition to `rejected`).
2. Show the user the proposed frontmatter change: `status: rejected`, `status_date: today`.
3. Ask for confirmation before writing.
4. On approval, update only the `status` and `status_date` fields in the ADR's frontmatter (all other fields and the body remain unchanged).
5. Run `node .harn/adrs/scripts/reindex.mjs`.
