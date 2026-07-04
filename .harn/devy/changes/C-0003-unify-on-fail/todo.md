# Backlog: C-0003 — Unificar ação em falha dos steps em `on_fail` (ADR-0001)

> Formato consumível pelo próprio `loopy` (`- [ ] T-NNN: título` + corpo indentado).
> Spec em `spec.md`; acceptance criteria e verificação completos em `plan.md` (ao lado).
> Invariante (AD-1): `on_fail` é config; zero mudança de comportamento de runtime (único
> valor continua `escalate`). Regressão zero é critério de aceite.

## Fase 1 — Renomeação do core (por família de chave)

- [ ] T-023: Agent-side — `verify.on_fail` + `on_expect_fail` → `on_fail` no nível do step
      Fatia vertical agent-side (tipo→schema→intérprete→dry-run→config→testes),
      independentemente verde. types.ts: VerifyConfig vira { run, max_attempts }
      (remove on_fail L105); AgentStep ganha on_fail?, remove on_expect_fail (L126).
      schema.ts: verifySchema sem on_fail (L112); agentStepSchema troca on_expect_fail
      → on_fail (L126). agent.ts: lê step.on_fail no verdict gate (era on_expect_fail,
      L138) e no verify esgotado (era verify.on_fail, L230); msgs/docstrings (L19/22/23)
      citam on_fail. orchestrator.ts resolveStep: verify imprime run=… max_attempts=…
      sem on_fail (L202-210); on_fail do step no slot pós-expect via setting("on_fail",…)
      — mesmo formato de shell/checks, sem colidir. Migra steps agent de loopy.yml
      (L51/L63/L77) e tests/fixtures/project/loopy.yml (L43/L52). Testes: agent.test
      (L93/106/160/165/179/186/216), dry-run.test (L208/216/237/245), orchestrator.test
      (L60/70), e2e-agent.test (L147/155/165). Sem dependências.
      Verify: npm run typecheck && npm run lint; npx vitest run tests/steps/agent.test.ts
      tests/cli/dry-run.test.ts; npx tsx src/index.ts <dir> --dry-run (verify sem on_fail).

- [ ] T-024: Approval-side — `on_conflict` → `on_fail` no nível do step
      Fatia vertical approval-side, independente de T-023. types.ts: ApprovalStep ganha
      on_fail?, remove on_conflict (L149). schema.ts: approvalStepSchema troca on_conflict
      → on_fail (L154). approval.ts: lê step.on_fail (era on_conflict, L128); msg L131 e
      docstrings (L6/20/24/127) citam on_fail. orchestrator.ts resolveStep: bloco
      on_conflict → on_fail (L230-232), formato setting("on_fail",…). Migra step merge de
      loopy.yml (L90) e fixture (L58); comentários tests/git/worktree.test.ts:127 e
      src/git/worktree.ts:16. Testes: approval.test (L213/221/230/233), dry-run.test
      (L221/250), orchestrator.test (L76), run-loop.test (L646), e2e-agent.test (L176).
      Sem dependências.
      Verify: npm run typecheck && npm run lint; npx vitest run tests/steps/approval.test.ts
      tests/loop/orchestrator.test.ts tests/loop/run-loop.test.ts tests/e2e/e2e-agent.test.ts.

## Checkpoint A — typecheck/lint/test verdes; grep zero de on_expect_fail/on_conflict/verify.on_fail em src/; regressão zero (casos "esgota max_attempts" e "veredito FAIL bloqueia" seguem passando lendo step.on_fail). Revisão humana antes da Fase 2.

## Fase 2 — Guarda-corpos (aditivos)

- [ ] T-025: `.refine` em `agentStepSchema` — `on_fail` exige `verify` ou `expect` (OQ-7)
      schema.ts: .refine no agentStepSchema rejeita on_fail órfão (sem verify e sem
      expect) com mensagem pt-BR ancorada no path on_fail. approval NÃO recebe guarda
      (modo de falha intrínseco). Depende de T-023 (agentStepSchema já com on_fail).
      Verify: npx vitest run tests/config/schema*.test.ts — caso órfão rejeitado;
      com verify OU expect presente → aceito.

- [ ] T-026: Pré-varredura de migração no `load.ts` — erro guiado (OQ-3/4/5/6)
      Função pura inline no load.ts, ANTES do zod, sobre o YAML cru. Percorre o pipeline,
      detecta as três chaves removidas por step (match por nome em qualquer step, sem
      olhar type — OQ-4), coleta TODAS (OQ-3) e lança ConfigError reaproveitando o
      cabeçalho "Config inválido em <path>:" com uma linha por ocorrência: id do step
      (step.id ou pipeline[<i>] — OQ-6) + chave antiga → on_fail + ponteiro docs/MIGRATION.md.
      verify.on_fail tem msg especial "mova para 'on_fail' no nível do step" (OQ-5).
      schema.ts sem chaves-fantasma (.strict() é a rede final). Depende de T-023, T-024.
      Verify: npx vitest run tests/config/load.test.ts — 3 casos (uma chave cada) + 1 caso
      com duas chaves antigas no mesmo relatório.

## Checkpoint B — npm test verde; erros guiados verificados nos 4 casos novos.

## Fase 3 — Documentação

- [ ] T-027: `docs/MIGRATION.md` + revalidar `CONTEXT.md`
      docs/MIGRATION.md NOVO: guia enxuto com tabela antiga→on_fail (3 chaves), diffs yml
      por caso, nota "escalate é o único valor", header citando ADR-0001. CONTEXT.md:
      revalidar o verbete "Ação em falha (on_fail)" já migrado (sem mudança prevista).
      Depende de T-023…T-026.
      Verify: revisão manual; links coerentes com o ADR-0001.

## Checkpoint C — Todos os Success Criteria do spec (1–7): verify só { run, max_attempts }; on_expect_fail/on_conflict inexistentes; erro guiado nas 3 chaves; loopy.yml + fixture migrados; dry-run correto; docs/MIGRATION.md + CONTEXT.md coerentes; regressão zero. typecheck/lint/test verdes antes do commit.
