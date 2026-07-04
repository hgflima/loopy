---
disable-model-invocation: true
description: Lista todos os ADRs com número, título, status e data
---

Invoke the adr_management skill.

Read `.harn/adrs/config.json` to get `root_dir`, then scan `<root_dir>/[0-9][0-9][0-9][0-9]-*.md` for ADR records.

Parse the frontmatter of each file and output a table sorted by number:

| Number | Title | Status | Date |
|--------|-------|--------|------|
| 0001   | ...   | accepted | YYYY-MM-DD |

Include `supersedes` and `superseded_by` columns only when any ADR has non-empty values for those fields.

If `docs/adrs/README.md` exists and is current, you may read it instead of re-parsing all files — but always parse directly if the README might be stale (use `node .harn/adrs/scripts/doctor.mjs` output to judge).
