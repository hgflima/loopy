---
description: Cria um novo ADR a partir do template, com aprovação antes de gravar
---

Invoke the adr_management skill.

Steps:

1. Run `node .harn/adrs/scripts/next-number.mjs` to get the next sequential number `NNNN`.
2. Ask the user for the ADR title (slug: lowercase, hyphens) and initial status (`proposed` or `accepted`).
3. Read `docs/adrs/template.md` and fill in the frontmatter (`number`, `title`, `status`, `date` = today, `status_date` = today, `supersedes: []`, `superseded_by: null`).
4. Show the complete draft to the user and ask for approval before writing.
5. On approval, write `docs/adrs/NNNN-slug.md`.
6. Run `node .harn/adrs/scripts/reindex.mjs` to regenerate `docs/adrs/README.md`.
