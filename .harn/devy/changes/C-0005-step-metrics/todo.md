# Backlog: C-0005 — Métricas de execução por Step

> Consumido pelo motor (`- [ ]` pendente / `- [x]` concluída; id `T-\d+`; corpo indentado).
> Narrativa, dependências, checkpoints e riscos: ver `plan.md` (mesma pasta).

## Fase 1 — Foundation (T-001 ∥ T-002 ∥ T-003)

- [x] T-001: Config `metrics` (schema zod + `LoopyConfig`) + interpolação `${change.*}`
    Bloco `metrics` opt-in: `report` opcional; se presente, `report.index` string não-vazia; `.strict()`. Espelhar em `LoopyConfig` (`readonly metrics?: MetricsConfig`). `buildScopeVars` + `ScopeVars` ganham `change.{id,dir}` derivado de `dirname(inputs.todo)`/`basename` (fallback `config.name` na raiz). Documentar em `examples/loopy.yml`.
    Aceite: config válido parseia; `report` sem `index` rejeitado; `${change.id}`/`${change.dir}` resolvem; var desconhecida fail-fast; ausência de `metrics` continua válida.
    Verificação: `npm test -- config` && `npm test -- interp` && `npm run typecheck`.
    Deps: nenhuma. Files: src/config/schema.ts, src/types.ts, src/interp/resolver.ts, src/loop/orchestrator.ts, examples/loopy.yml, testes. Scope: M.

- [x] T-002: Tipos de métrica + módulo puro `src/metrics/` (folds + metrics.json + formatação)
    Tipos aditivos: `TurnUsage`, `StepCost`, `Sample`, `StepMetrics`, `TaskMetrics`, `RunMetrics`, `ChangeMetrics`. Módulo puro: folds Amostra→Step→Task→Run→Change (soma tokens/tempo/visitas; cost = último snapshot não-nulo); load/merge/save de `.loopy/metrics.json` (atômico mkdir+.tmp+rename; load tolerante → vazio; invalidação por `change.id` divergente); formatação (tokens k/M, Δt h/m/s, custo). Sem wiring.
    Aceite: fold soma correto por nível; Visitas somadas; tokens `n/d` propagados; merge acrescenta Run em `runs[]` + refold da Change; troca de `change.id` → arquivo novo; load ausente/corrompido → vazio.
    Verificação: `npm test -- metrics` && `npm run typecheck`.
    Deps: nenhuma. Files: src/types.ts, src/metrics/* (novo), testes. Scope: M.

- [x] T-003: Captura ACP — `AgentSession.drainUsage()`/`readCost()` + acumulador + buffer de cost
    `AgentSession` ganha `drainUsage(): TurnUsage | null` (soma desde o último drain, reseta) e `readCost(): StepCost | null` (snapshot cumulativo). `SessionWrapper` soma `PromptResponse.usage` por-turno (espelha `TurnTextBuffer`, reset por-turno); cost via buffer alimentado no branch `usage_update` de `client.ts` após a barreira `flushSessionUpdates`. `notWiredSession` → null; `createLazySession` → delega ao aberto, null se não-aberta.
    Aceite: multi-turno soma; drain reseta; `usage` null → `available:false`; `/clear` = zeros inócuo; cost cumulativo → último snapshot; assinaturas públicas existentes inalteradas; `StepResult` intocado.
    Verificação: `npm test -- acp` && `npm run typecheck`.
    Deps: T-002. Files: src/types.ts, src/acp/session.ts, src/acp/client.ts, src/loop/orchestrator.ts, testes. Scope: M. RISCO ALTO.

## Fase 2 — Coleta e Run report (T-004 → T-005)

- [x] T-004: Orquestrador — cronometrar os 2 sites de execute + Amostra → RunMetrics
    Clock injetável em `OrchestratorDeps` (`now?: () => Date`, default `Date.now`). Envolver execute em `:723` (principal) e `:800` (teardown `always`) com `durationMs`; após execute, `drainUsage()`/`readCost()` → Amostra por Step efetivamente executado (guard de visits e no-op sem intérprete NÃO geram Amostra). Acumular → `RunMetrics` (soma por Step/Task, Visitas somadas). Estender `RunLoopResult` com `metrics`/`startedAt`/`finishedAt`.
    Aceite: `durationMs` determinístico com clock injetado; Amostra nos dois call-sites; Step pulado (visit-exceeded / sem intérprete) não gera Amostra; drain chamado após execute; `RunLoopResult.metrics` reflete o rollup.
    Verificação: `npm test -- orchestrator` && `npm run typecheck`.
    Deps: T-002, T-003. Files: src/loop/orchestrator.ts, testes. Scope: M.

- [x] T-005: index.ts — merge `metrics.json` + Run report (stderr), gated por `metrics`
    Após `runLoop`: resolver `metrics.report.index` uma vez a nível de Run (escopo run-level `change.*`/`inputs.*`/`workspace.*`, normalizado contra `root`); merge do `RunMetrics` em `.loopy/metrics.json` (append em `runs[]`, atômico); ler rollup da Change e emitir Run report em stderr (line-reporter, após a TUI parar no `finally`). Tudo gated pela presença de `config.metrics`.
    Aceite (com `metrics`): `.loopy/metrics.json` no shape esperado; Run report com breakdown por Step + linha "Change até agora". (Sem `metrics`): nenhum artefato novo, saída byte-idêntica. `usage`/`cost` null → Step sucede, mostra `n/d`.
    Verificação: `npm test -- index` && `npm run typecheck`.
    Deps: T-004, T-002, T-001. Files: src/index.ts, src/tui/line-reporter.ts, fixture com `metrics` (variante dedicada), testes. Scope: M.

## Fase 3 — Change report + docs (T-006 → T-007)

- [x] T-006: Change report — re-parse do `todo.md` (0 pendentes) → persistir `index.md` byte-preserving
    Renderer Markdown: `## <change.id>` + parágrafo de totais + tabela rica por Task (`| Task | Δt | in | out | cached | tokens | visits | custo |`). Após a Run, re-parsear o `todo.md`: se `pendingTasks === 0` E `report.index` setado, persistir a seção da Change byte-preserving (reescreve só a própria seção; preserva outras + preâmbulo; anexa nova ao fim; cria com título `#` se inexistente). Nunca dispara por `stoppedBy`.
    Aceite: backlog 100% `[x]` → seção escrita; re-persistir atualiza só aquela seção (outras byte-a-byte); `--task`/`skip_task` que não zeram o backlog não disparam; `report.index` ausente → sem `index.md`.
    Verificação: `npm test -- metrics` && aceite de integração && `npm run typecheck`.
    Deps: T-005, T-002. Files: src/metrics/*, src/index.ts, testes. Scope: M.

- [x] T-007: Docs — ADR-0003 + CONTEXT.md + fixture
    ADR-0003 (contrato aditivo + AD-1 + best-effort ACP). Promover ao `CONTEXT.md` os termos novos (Amostra/Uso/Custo/Agregado/Run report/Change report/Change) sem colidir com Iteração/Tentativa/Visita/Report de checks. Bloco `metrics` no `tests/fixtures/project/loopy.yml` se ainda não coberto.
    Aceite: ADR-0003 criado e indexado; glossário atualizado; fixture com `metrics`.
    Verificação: `npm run typecheck` && `npm run lint` && `npm test` verdes.
    Deps: T-006. Files: docs/adrs/0003-*.md, CONTEXT.md, tests/fixtures/project/loopy.yml. Scope: S.
