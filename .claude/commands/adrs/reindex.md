---
disable-model-invocation: true
description: Regenera docs/adrs/README.md a partir do frontmatter dos ADRs e do histórico git
---

Invoke the adr_management skill.

Run `node .harn/adrs/scripts/reindex.mjs` from the repo root.

This regenerates `docs/adrs/README.md` in full — index table (number, title, status, date, supersede links) plus changelog (creation/transition events derived from git). The operation is idempotent: running it twice produces zero diff.

Never edit `docs/adrs/README.md` by hand. If the README is out of date, always run this command to regenerate it.
