# Plano de Implementação: Unificar ação em falha dos steps em `on_fail` (C-0003 / ADR-0001)

## Context

O `loopy.yml` expõe hoje **três chaves** para o mesmo conceito — "a ação quando este step
falha": `verify.on_fail` (aninhado no bloco `verify` de steps `agent`), `on_expect_fail`
(step `agent`, quando `expect` não bate) e `on_conflict` (step `approval`, conflito de merge).
As três só aceitam `escalate` e o orchestrator já resolve tudo com o fallback `?? "escalate"` —
são o mesmo conceito com três nomes, sobrecarregando a linguagem ubíqua (`CONTEXT.md`) e obrigando
quem escreve o yml a decorar qual chave vale em cada tipo de step.

O ADR-0001 (accepted, 2026-07-04) decide **colapsar tudo em uma única chave `on_fail` por step**.
Não é mudança de comportamento — é renomeação/unificação de **config** (AD-1: o motor interpreta,
não decide). O único valor possível continua `escalate`, então o loop se comporta identicamente.
Resultado esperado: superfície de config menor, uma só palavra na linguagem de falha, e um
**breaking change bem-sinalizado** (erro guiado, não o `Unrecognized key` genérico do zod) para
configs antigas migrarem.

Semântica única depois da mudança:

| Step | `on_fail` dispara quando… |
|------|----------------------------|
| `shell` | comando com exit ≠ 0 (inalterado) |
| `checks` | a lista de checks falha (inalterado) |
| `agent` | `verify` esgota `max_attempts` **ou** `expect` não bate |
| `approval` | conflito de merge |

## Architecture Decisions

- **`on_fail` opcional em todos os steps, default `escalate`** (OQ-2). Coerente com
  `shell`/`checks`, que já são opcionais, e com o fallback `?? "escalate"` que o consumo já usa.
  Tornar obrigatório só adicionaria ruído — o único valor é `escalate`.
- **Fatiar por família-de-chave, não por camada** (AD-1). Os campos agent-side e approval-side
  são independentes em `types.ts`/`schema.ts`, então cada família é uma fatia vertical completa
  (tipo → schema → intérprete → dry-run → config → testes) e **independentemente verde**. O `.strict()`
  impede um estado transitório "aceita ambas as chaves", então dentro de uma família a mudança é
  atômica; entre famílias, sequencial e verde.
- **Migração = erro amigável guiado** (OQ-1, travado): pré-varredura **pura inline** no `load.ts`
  sobre o YAML cru, **antes** do zod, que **coleta todas** as ocorrências (OQ-3), casa **por nome
  em qualquer step** sem olhar `type` (OQ-4), identifica o step por `id` ou `pipeline[<i>]` (OQ-6),
  e dá mensagem especial para `verify.on_fail` explicando que a chave **sobe** de nível (OQ-5).
  Sem auto-migração/alias (Never do ADR).
- **Guarda-corpo em `agent` (OQ-7)**: `.refine` no `agentStepSchema` rejeita `on_fail` sem `verify`
  nem `expect` (chave órfã/inerte — o único outro caminho de falha, `stopReason ≠ end_turn`, não
  consulta `on_fail`). `approval` **não** recebe guarda equivalente: seu modo de falha é intrínseco.

## Pontos de consumo confirmados (grep — arquivo:linha)

- `src/types.ts` — `VerifyConfig.on_fail` (L105, obrigatório), `AgentStep.on_expect_fail` (L126),
  `ApprovalStep.on_conflict` (L149). `ShellStep.on_fail` (L133) / `ChecksStep.on_fail` (L141) **inalterados**.
- `src/config/schema.ts` — `verifySchema.on_fail` (L112), `agentStepSchema.on_expect_fail` (L126),
  `approvalStepSchema.on_conflict` (L154). `shell`/`checks` `on_fail` (L135/L144) inalterados.
- `src/steps/agent.ts` — `step.on_expect_fail ?? "escalate"` (L138) + msg `on_expect_fail:` (L141);
  `verify.on_fail` (L230). Docstrings L19/L22/L23.
- `src/steps/approval.ts` — `step.on_conflict ?? "escalate"` (L128) + msg `on_conflict:` (L131). Docstrings L6/L20/L24/L127.
- `src/loop/orchestrator.ts::resolveStep` (L191-235): verify desestrutura `on_fail` (L202-210);
  bloco `on_expect_fail` (L212-214); bloco `on_conflict` (L230-232). **Cuidado:** `shell`/`checks`
  já imprimem `on_fail=…` (L219/L224) via `setting("on_fail", …)` — os novos `on_fail` de
  agent/approval devem seguir **o mesmo formato**, sem colidir com essa semântica pré-existente.
- Comentários de doc a alinhar: `src/config/CLAUDE.md:26`, `src/steps/CLAUDE.md:11`, `src/git/worktree.ts:16`.

Superfície de testes/fixtures (arquivo:linha confirmados):
- `loopy.yml` raiz: L51, L63 (`verify.on_fail`), L77 (`on_expect_fail`), L90 (`on_conflict`)
- `tests/config/load.test.ts:51` (`verify.on_fail` em fixture inline)
- `tests/cli/dry-run.test.ts`: L208/L237 (verify `on_fail=escalate`), L216/L245 (`on_expect_fail:`), L221/L250 (`on_conflict:`) — strings esperadas exatas
- `tests/steps/agent.test.ts`: L93 (`verifyStep`), L106 (`auditStep` `on_expect_fail`), L160/L165/L186 (overrides `verify`), L179 assert `"escalate"`, L216 nome do teste
- `tests/steps/approval.test.ts`: L213/L221/L230/L233 (`on_conflict` + assert `"escalate"`)
- `tests/fixtures/project/loopy.yml`: L43 (`verify.on_fail`), L52 (`on_expect_fail`), L58 (`on_conflict`)
- `tests/e2e/e2e-agent.test.ts`: L147/L155 (`verify.on_fail`), L165 (`on_expect_fail`), L176 (`on_conflict`)
- `tests/loop/orchestrator.test.ts`: L60 (`verify.on_fail`), L70 (`on_expect_fail`), L76 (`on_conflict`)
- `tests/loop/run-loop.test.ts:646` (`on_conflict` — só approval)
- `tests/git/worktree.test.ts:127` (só comentário `on_conflict`)

## Tasks (detalhe)

### T-023 — Agent-side: `verify.on_fail` + `on_expect_fail` → `on_fail` no nível do step

**Descrição:** Colapsar as duas chaves de falha de `agent` numa `on_fail?` no nível do step.
`VerifyConfig` perde `on_fail` (vira `{ run, max_attempts }`); `AgentStep` ganha `on_fail?`,
perde `on_expect_fail`. `agent.ts` passa a ler `step.on_fail` no verdict gate (era `on_expect_fail`)
e no verify esgotado (era `verify.on_fail`); mensagens/docstrings citam `on_fail`. Dry-run: verify
sem `on_fail`; `on_fail` do step no slot pós-`expect`, no formato `setting("on_fail", …)`. Migra
steps `agent` de `loopy.yml` e do fixture, e os testes agent-side.

**Acceptance criteria:**
- [ ] `VerifyConfig` = `{ run, max_attempts }`; `AgentStep.on_fail?: OnFailAction`; `on_expect_fail` some de tipos e schema.
- [ ] `agent.ts` lê `step.on_fail` nos dois pontos (L138, L230); log/docstring citam `on_fail`.
- [ ] Dry-run: `verify: run=… max_attempts=…` (sem `on_fail`); `on_fail=…` do step como campo próprio.
- [ ] `loopy.yml` e `tests/fixtures/project/loopy.yml` com steps `agent` migrados e válidos.

**Verification:** `npm run typecheck && npm run lint`; `npx vitest run tests/steps/agent.test.ts tests/cli/dry-run.test.ts`; `npx tsx src/index.ts <dir> --dry-run`.
**Dependencies:** Nenhuma. **Scope:** L.

### T-024 — Approval-side: `on_conflict` → `on_fail` no nível do step

**Descrição:** `ApprovalStep` ganha `on_fail?`, perde `on_conflict`. `approval.ts` lê `step.on_fail`
(era `on_conflict`); dry-run imprime `on_fail=…` no slot pós-comandos. Migra steps `approval` de
`loopy.yml`/fixture e os testes approval-side.

**Acceptance criteria:**
- [ ] `ApprovalStep.on_fail?: OnFailAction`; `on_conflict` some de tipos e schema.
- [ ] `approval.ts` lê `step.on_fail` (L128); log/docstring citam `on_fail`.
- [ ] Dry-run: `approval` imprime `on_fail=…` como campo próprio.
- [ ] `loopy.yml`/fixture com `approval` migrado; comentário em `tests/git/worktree.test.ts:127` e `src/git/worktree.ts:16` atualizados.

**Verification:** `npm run typecheck && npm run lint`; `npx vitest run tests/steps/approval.test.ts tests/loop/orchestrator.test.ts tests/loop/run-loop.test.ts tests/e2e/e2e-agent.test.ts`.
**Dependencies:** Nenhuma (independente de T-023). **Scope:** M.

### Checkpoint — Fase 1
`npm run typecheck && npm run lint && npm test` verdes; grep zero de `on_expect_fail`/`on_conflict`/`verify.on_fail` em `src/`; regressão zero (casos "esgota max_attempts" e "veredito FAIL" seguem passando lendo `step.on_fail`).

### T-025 — `.refine` em `agentStepSchema`: `on_fail` exige `verify` ou `expect` (OQ-7)

**Descrição:** Rejeitar `on_fail` órfão num step `agent` (sem `verify` e sem `expect`), com
mensagem pt-BR clara ancorada no path `on_fail`.

**Acceptance criteria:**
- [ ] `agent` com `on_fail` sem `verify` nem `expect` → rejeitado pelo `.refine` (msg pt-BR, path `on_fail`).
- [ ] `agent` com `on_fail` + (`verify` **ou** `expect`) → aceito.
- [ ] `approval` sem guarda equivalente.

**Verification:** `npx vitest run tests/config/schema*.test.ts`.
**Dependencies:** T-023. **Scope:** S.

### T-026 — Pré-varredura de migração no `load.ts`: erro guiado (OQ-3/4/5/6)

**Descrição:** Função **pura inline** no `load.ts` que inspeciona o YAML cru **antes** do zod,
detecta as três chaves removidas por step, e lança `ConfigError` reaproveitando o cabeçalho
`Config inválido em "<path>":`, **uma linha por ocorrência** (coleta-todas), citando id do step
(ou `pipeline[<i>]`), chave antiga → `on_fail`, e ponteiro para `docs/MIGRATION.md`.

**Acceptance criteria:**
- [ ] Cada uma das três chaves → erro guiado citando step + `on_fail` + `docs/MIGRATION.md` (não o `Unrecognized key`).
- [ ] Msg do `verify.on_fail` diz "mova para 'on_fail' no nível do step" (OQ-5).
- [ ] Duas chaves antigas → ambas no mesmo relatório multi-linha (OQ-3).
- [ ] Match por nome em qualquer step (OQ-4); id via `step.id` ou `pipeline[<i>]` (OQ-6); `schema.ts` sem chaves-fantasma.

**Verification:** `npx vitest run tests/config/load.test.ts`.
**Dependencies:** T-023, T-024. **Scope:** M.

### Checkpoint — Fase 2
`npm test` verde; erros guiados verificados nos 4 casos novos.

### T-027 — `docs/MIGRATION.md` + revalidar `CONTEXT.md`

**Descrição:** Guia enxuto — tabela antiga→`on_fail` (3 chaves), diffs yml por caso, nota
"`escalate` é o único valor", header citando ADR-0001. Revalidar o verbete "Ação em falha
(on_fail)" já migrado no `CONTEXT.md`.

**Acceptance criteria:**
- [ ] `docs/MIGRATION.md` documenta o antes→depois das três chaves com diffs yml.
- [ ] `CONTEXT.md` reflete a chave única (revalidado, sem mudança prevista).

**Verification:** revisão manual; links coerentes com o ADR.
**Dependencies:** T-023…T-026. **Scope:** S.

### Checkpoint — Completo
Todos os Success Criteria da spec (1–7); `npm run typecheck && npm run lint && npm test` verdes; pronto para revisão.

## Risks and Mitigations

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Ponto de rename esquecido (blast radius raso mas amplo) | Med | Gate `typecheck`+`test` por task; grep zero de chaves antigas em `src/` no checkpoint da Fase 1 |
| Breaking change silencioso p/ configs antigas | Alto | T-026 (erro guiado) + `docs/MIGRATION.md`; `.strict()` como rede final |
| Regressão de comportamento | Alto | Único valor é `escalate`; suíte cobre "max_attempts esgotado" e "veredito FAIL" — devem seguir verdes |
| Novo `on_fail` de agent/approval colidir com o `on_fail` já existente de shell/checks no dry-run | Baixo | Reusar `setting("on_fail", …)`; asserts de dry-run (T-023/T-024) travam o formato |

## Open Questions

Nenhuma — as sete OQs da spec (OQ-1…OQ-7) estão **resolvidas** e travadas pelo ADR-0001.
