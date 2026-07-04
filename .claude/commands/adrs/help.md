---
disable-model-invocation: true
description: Descreve os comandos /adrs:* disponíveis
---

Invoke the adr_management skill.

Discover and describe the nine other `/adrs:*` commands by reading `.claude/commands/adrs/`. Do not hardcode the list — read the directory and extract each file's `description` from its frontmatter.

Output a table with two columns: **Command** and **Description**. Sort alphabetically. Include this command itself (`/adrs:help`) at the end.

Then print:

```
Para qualquer operação com ADRs, carregue a skill adr_management primeiro.
Config: .harn/adrs/config.json  |  root_dir: docs/adrs
Scripts: node .harn/adrs/scripts/<script>.mjs
```
