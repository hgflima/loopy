---
disable-model-invocation: true
description: Substitui um ADR existente — cria o novo, vira o antigo para superseded e estabelece links bidirecionais
---

Invoke the adr_management skill.

Usage: `/adrs:supersede NNNN` where NNNN is the four-digit number of the ADR being superseded.

Steps:

1. Read `docs/adrs/NNNN-*.md` to confirm it exists and its current status allows supersession (`accepted → superseded` is a valid transition).
2. Run `node .harn/adrs/scripts/next-number.mjs` to get the replacement number `MMMM`.
3. Ask the user for the new ADR title and the full decision context.
4. Draft the new ADR from `docs/adrs/template.md` with `supersedes: [NNNN]` in frontmatter.
5. Show both diffs (new ADR + patch to old ADR's frontmatter) and ask for approval before writing.
6. On approval:
   a. Write `docs/adrs/MMMM-slug.md`.
   b. Update `docs/adrs/NNNN-*.md`: set `status: superseded`, `status_date: today`, `superseded_by: MMMM`.
7. Run `node .harn/adrs/scripts/reindex.mjs`.
