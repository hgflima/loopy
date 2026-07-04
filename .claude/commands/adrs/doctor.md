---
disable-model-invocation: true
description: Auditoria de consistência do acervo de ADRs — detecta divergências estruturais e oferece correção
---

Invoke the adr_management skill.

Run `node .harn/adrs/scripts/doctor.mjs` from the repo root.

The doctor checks six things and reports PASS/FAIL for each:

1. `config.json` is valid and versioned; `root_dir` exists.
2. Hooks declared in config are actually installed in `.claude/settings.json` and `.lintstagedrc.js`.
3. Every ADR record follows the template (valid frontmatter + `## Context`, `## Decision`, `## Consequences` present) and has a valid status.
4. No duplicate numbers (detects parallel-branch collisions).
5. Supersede links are bidirectional and consistent (if A supersedes B, B must have `superseded_by: A`).
6. `docs/adrs/README.md` is current (regenerating it would produce zero diff).

Exit code is non-zero if any check fails. Offer to fix auto-correctable issues (e.g., regenerate the README) before touching anything.
