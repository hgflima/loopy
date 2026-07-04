---
name: adr_management
description: Gerenciamento de Architecture Decision Records (ADRs) — criação, transição de status, auditoria e reindexação com enforcement determinístico por hooks.
---

# Skill: adr_management

Harness portátil de ADRs instalado neste repo. Consciência + procedimento + obrigatoriedade via três camadas de enforcement (PreToolUse, PostToolUse, pre-commit).

## Configuração

- Config de time: `.harn/adrs/config.json` (`root_dir: "docs/adrs"`)
- Config local (gitignored): `.harn/adrs/config.local.json`
- Template canônico: `docs/adrs/template.md`
- Convenções de autoria: `docs/adrs/CLAUDE.md`

## Operações disponíveis

Use os slash commands `/adrs:*` para todas as operações. Cada comando delega para os scripts em `.harn/adrs/scripts/`.

| Comando | Script | Faz |
|---------|--------|-----|
| `/adrs:setup` | `setup.mjs` | Instala/reconfigura hooks e config (idempotente); migra ADRs pré-existentes para frontmatter |
| `/adrs:create` | `next-number.mjs` + template | Novo ADR a partir do template, com aprovação antes de gravar |
| `/adrs:supersede NNNN` | `validate.mjs` + `edit-*` | Cria ADR substituto + vira status do antigo para `superseded` + links bidirecionais |
| `/adrs:deprecate NNNN` | `validate.mjs` | Transiciona `accepted → deprecated` |
| `/adrs:reject NNNN` | `validate.mjs` | Transiciona `proposed → rejected` |
| `/adrs:status NNNN <novo>` | `validate.mjs` | Qualquer transição válida pela state machine |
| `/adrs:reindex` | `reindex.mjs` | Regenera `docs/adrs/README.md` (idempotente) |
| `/adrs:doctor` | `doctor.mjs` | Auditoria de consistência completa |
| `/adrs:list` | `reindex.mjs` (índice) | Lista ADRs e status atual |
| `/adrs:help` | — | Descreve os comandos disponíveis |

## Scripts (`.harn/adrs/scripts/`)

Invocação direta quando necessário:

```bash
node .harn/adrs/scripts/validate.mjs <path>
node .harn/adrs/scripts/next-number.mjs
node .harn/adrs/scripts/reindex.mjs
node .harn/adrs/scripts/doctor.mjs
node .harn/adrs/scripts/setup.mjs --verify
node --test '.harn/adrs/**/*.test.mjs'
```

## Máquina de estados

| De | Para |
|----|------|
| proposed | accepted, rejected |
| accepted | deprecated, superseded |
| rejected | (terminal) |
| deprecated | (terminal) |
| superseded | (terminal) |

`proposed` é desbloqueado (edição total liberada). Todo status além de `proposed` é travado: apenas `status`, `status_date`, `supersedes`, `superseded_by` podem mudar.

## Quando usar esta skill

Carregue antes de qualquer operação com ADRs:

- Criar um novo ADR → `/adrs:create`
- Propor substituição de decisão existente → `/adrs:supersede NNNN`
- Verificar saúde do acervo → `/adrs:doctor`
- Regenerar o índice após mudanças → `/adrs:reindex`
- Referenciar ADRs antes de mudar arquitetura → ler `docs/adrs/README.md` primeiro

## Regras de autoria

Leia `docs/adrs/CLAUDE.md` antes de criar ou editar um ADR. O resumo:

- Numeração sequencial derivada de arquivos (`max(NNNN)+1`)
- Frontmatter canônico obrigatório (campos `number/title/status/date/status_date/supersedes/superseded_by`)
- Três headings obrigatórios no corpo: `## Context`, `## Decision`, `## Consequences`
- ADR `accepted`/terminal: apenas campos mutáveis via transição válida
- `README.md` nunca editado à mão — sempre regenerado por `reindex.mjs`

## Hooks ativos

| Hook | Gatilho | Ação |
|------|---------|------|
| `hooks/pretooluse-validate.mjs` | PreToolUse Write/Edit/MultiEdit em `docs/adrs/NNNN-*.md` | Bloqueia (exit 2) edição ilegal antes de acontecer |
| `hooks/posttooluse-lint.mjs` | PostToolUse após gravar | Lint de template; feedback reativo se heading faltando |
| `hooks/precommit-validate.mjs` | pre-commit via lint-staged | Mesma validação para commits humanos |

Para desabilitar um hook individualmente: `/adrs:setup --disable <hook_name>`.
