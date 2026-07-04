---
disable-model-invocation: true
description: Instala ou reconfigura o harness ADR — migra ADRs pré-existentes para frontmatter e liga os hooks
---

Invoke the adr_management skill.

Run `node .harn/adrs/scripts/setup.mjs $ARGUMENTS` from the repo root.

Steps:

1. If `$ARGUMENTS` contains `--disable <hook>` or `--enable <hook>`, apply that toggle and stop.
2. If `$ARGUMENTS` contains `--verify`, run the hook verification against fixtures and report pass/fail.
3. Otherwise, run the full setup flow:
   a. Read `.harn/adrs/config.json` (create if absent, asking the user for `root_dir`).
   b. Detect ADRs in `root_dir` that lack YAML frontmatter (line 1 ≠ `---`).
   c. For each non-conforming ADR, propose the generated frontmatter (`number` from filename, `title` from H1, `status` lowercased with 0001→accepted, `date`/`status_date` from prose `**Data:**`, `supersedes:[]`, `superseded_by:null`) and show the diff.
   d. Ask for user approval before writing. On approval, rewrite each ADR with the new frontmatter; preserve the body and any extra prose.
   e. Only after all ADRs are migrated: install/enable the three hooks (edit `.claude/settings.json` and `.lintstagedrc.js` surgically — never touch the four existing third-party hooks).
   f. Add `.harn/adrs/config.local.json` to `.gitignore` if not already present.
4. Confirm idempotence: a second run with the same args is a no-op.
