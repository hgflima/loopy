# Plano de implementação: C-0017 — Telemetria SQLite (coleta insert-only, bugs, veredito humano, aba Insights)

> Companheiro do `spec.md` (mesma pasta). Narrativa, descobertas do código, fases, checkpoints,
> DAG e riscos. A lista executável pelo motor está em `todo.md`.

## Overview

A C-0017 substitui a persistência de métricas do loopy (hoje um `.loopy/metrics.json` **por-change**,
não-queryável, que recomeça do zero a cada change) por um **SQLite** em `<root>/.db/telemetry.db`:
insert-only para os fatos (step/task/change), mutável para anotações humanas (veredito de task, bugs).
Uma **4ª aba "Insights"** na GUI menubar lê esse `.db` e compara uma change contra a média histórica
(±desvio) e contra outra change escolhida, em absoluto e normalizado por churn. O objetivo são as três
perguntas que o loopy não responde hoje: *quanto custou esta change e onde (por task, por tentativa)?*,
*o pipeline está melhorando run a run?*, *onde o review deixou passar defeito?* (task `merged` +
`human_verdict='fail'`). A spec já fixou 27 decisões e as Open Questions; este plano as aterra no
código e ordena a execução.

O trabalho é inerentemente em camadas (DDL → motor → Rust → React), então as fatias verticais puras
("usuário faz X") cruzam todas as camadas. A estratégia é **fundação primeiro** (adapter + schema +
hashes) e depois incrementos que sobem a pilha, cada um deixando `typecheck+lint+test` verdes.

## Descobertas do código que moldam o plano (verificadas nesta sessão por 6 exploradores + 1 Plan)

A spec é prescritiva, mas 3 âncoras suas não batem com o código — e isso reorganiza o plano:

1. **Não existe medição por-Tentativa hoje.** A D3 ("uma linha por Tentativa") não é "instrumentar o
   que já emite `attempt_started`": `src/steps/agent.ts:232-282` **não drena usage/cost nem cronometra
   dentro do loop**. A única amostragem é por-**Visita**, no `timedExecute` do orquestrador
   (`orchestrator.ts:924-951`). A granularidade por-tentativa é **código novo** em `agent.ts` — a fatia
   de maior risco (T-007).
2. **`size_*`/"reconcile-parent" não existe no motor** (grep vazio por `size_|reconcile|numstat`). O
   `git diff --numstat` precisa ser **adicionado** (`GitPort.diffNumstat`) e capturado **antes do
   teardown** (o `cleanup` do yml apaga o branch dentro de `runTaskPipeline:1138`, antes de o status
   terminal ser conhecido em `launchTask`). E o churn (`size_added+size_removed`) é **load-bearing**
   para o toggle normalizado (SC3) — não é opcional.
3. **Remover `src/metrics/` e adicionar a instrumentação nova colidem no `timedExecute`.** O drain
   velho (`orchestrator.ts:938-942`) e o novo por-tentativa disputam o **mesmo acumulador**
   (`drainUsage()` é drain-and-reset). Adicionar o novo antes de remover o velho zeraria `Sample.usage`
   e quebraria asserções que a D27 já manda apagar (`tests/loop/orchestrator.test.ts:291-690`).
   **Desmontar primeiro é obrigatório**, não estético.

## Decisões arquiteturais

- **Sink `ctx.telemetry?` (não estender `StepResult`).** Novo campo opcional em `StepContext` e
  `OrchestratorDeps` (espelha `emit?`). O orquestrador liga, em `buildTaskStepContext:824-849`, um
  gravador por-Visita fechado sobre `{ taskId, changeId, stepName, kind, visitNo, configId, now }`.
  `agent.ts` **empurra** um sample por tentativa; `timedExecute` chama `recorder.finalize()` como
  **gatilho único de escrita**: tentativas presentes (agente) → N linhas; senão (não-agente) → 1 linha
  de Visita. Não polui o contrato congelado `StepResult` (ADR-0003); classifica `fail_reason` onde a
  informação vive.
- **Escritor único de fatos = `write.ts`, chamado pelo motor.** `node:sqlite`/`bun:sqlite` síncronos,
  **uma conexão-escritora** (D9), WAL **1× no bootstrap** (D8). Toda escrita em try/catch estilo
  `safeEmit` (`orchestrator.ts:803-810`) — a coleta **nunca lança** para dentro do motor.
- **Gate opt-in por `metrics:` (AD-1 à letra).** DB aberto **só** com `config.metrics` presente (o gate
  `index.ts:841`), em `defaultRunLive`; injetado via `deps.telemetry`; fechado no `finally`
  (`index.ts:726-733`, para o WAL flushar). Ausente → `ctx.telemetry` undefined → `?.` no-op → nenhum
  `.db`, `RunLoopResult` byte-idêntico.
- **`seq` derivado no INSERT** (D25): `COALESCE((SELECT MAX(seq) FROM step WHERE task_id=:tid),0)+1`
  numa só sentença — race-free pela conexão única, sobrevive a resume/goto sem colidir no
  `UNIQUE(task_id, seq)`.
- **Delta de custo por-tentativa** (D10): `before=readCost()` no início da tentativa (após o `clear()`
  de `agent.ts:241`), `after=readCost()` após `prompt()` (`:250`); delta só com ambos non-null, senão
  NULL. `costCarry` mantém `readCost()` monotônico através de `clear_context`. `SUM(cost_usd)` por task
  paga o **D-0008**.
- **GUI lê por Rust, escreve por subprocesso** (D6/D19/D20): Rust `rusqlite` SELECT-only nas views;
  escrita (verdict/bug/change) invoca o CLI `loopy` one-shot, padrão `probe_agent`
  (`project_fs.rs:94-147`).

## Fases

**Fase 1 — Fundação & desmonte** (T-001, T-002, T-003)
Adapter runtime-guarded, schema+views+hashes de identidade, e o desmonte de `src/metrics/` +
`RunLoopResult.metrics` (aterrissando verde com telemetria OFF, liberando o acumulador).

**Fase 2 — Coleta de fatos** (T-004, T-005, T-006, T-007)
Port + gravador por-Visita + lifecycle → dimensão `change` → linha `task` + `size_*` → o núcleo de
risco: instrumentação por-Tentativa em `agent.ts` + `human_seconds`. Ordem justificada: cada passo
prova o port num caminho mais barato antes de chegar ao delta de custo/drain por-tentativa.

**Fase 3 — CLI de anotações** (T-008)
`annotate.ts` + `query.ts` + `verdict set/clear`, `bug add`, `change --abandoned/--failed`.

**Fase 4 — Ponte GUI (Rust)** (T-009)
`telemetry.rs` com `rusqlite` SELECT-only nas views + escrita por subprocesso; degradação graciosa sem
`.db`.

**Fase 5 — Aba Insights (React)** (T-010, T-011)
View-model puro testável isolado → `InsightsPane` + 4º segmento do `ViewSwitcher` + header 3-col +
tri-estado + badge de defeito escapado + write-back.

**Fase 6 — Documentação** (T-012)
ADR-0011 (estende a ADR-0003), fecho do D-0008, `.gitignore` `.db/`, bump `engines`, docs.

## Grafo de dependências

```
T-001 ─▶ T-002 ─▶ T-004 ─▶ T-005 ─▶ T-006 ─▶ T-007 ─▶ T-008 ─▶ T-009 ─▶ T-011 ─▶ T-012
T-003 ────────────▲                                    T-002 ─▶ T-010 ─────────▲
```

Paralelismo real: `T-003 ∥ T-001/T-002` (mas precede T-004 pela aresta cruzada); `T-010 ∥ cadeia do
motor` (só depende de T-002). **A cadeia do motor é serializada de propósito** — tasks concorrentes em
`orchestrator.ts`/`index.ts` geram conflito de merge (lição das changes anteriores). As arestas
cruzadas T-004→T-003 e T-011→T-010 existem para isso — **não remover**.

## Checkpoints

- **Fundação (após T-003):** `typecheck`(raiz+app)+`lint`+`test` verdes; DB idempotente; views num
  `.db` semeado; hashes estáveis; sistema roda sem métricas antigas (nada de `metrics.json`/stderr
  report/`index.md`).
- **Coleta (após T-007):** dogfood real com `metrics:` popula `.db` com change/task/step (por-tentativa,
  delta de custo, `size_*`); run **sem** `metrics:` não cria `.db`; `RunLoopResult` byte-idêntico
  on/off; insert-only (zero UPDATE em step/task).
- **Completo (após T-012):** os 4 Success Criteria passam manualmente na aba Insights; degradação
  graciosa sem `.db`; D-0008 pago; ADR-0011 Accepted.

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Dupla-drenagem de `drainUsage()` (velho×novo) | Alto | Desmontar métricas **antes** (T-003); `finalize` ramifica "tentativas presentes" e nunca re-drena p/ agente |
| Delta de custo errado através de `clear_context` | Alto | Pareamento before/after na **mesma** sessão; `costCarry` garante monotonicidade; NULL quando indisponível; teste dedicado |
| `size_*` perdido pelo teardown que apaga o branch | Médio | Capturar numstat **antes** do loop de teardown; guardar no `PipelineRunResult`; NULL p/ failed |
| `fail_reason` heurístico por nome-de-check custom | Baixo | Sem match → NULL + `fail_detail`; primeiro check reprovado vence; documentar |
| FK `step.config_id → agent_config` derruba insert | Médio | INSERT OR IGNORE `agent_config` antes da linha `step`; se falhar, `config_id=NULL` |
| Vazamento de secret em `resolved_json` | Alto (segurança) | Serializar `AgentDef` forma declarada (templates `${env.KEY}`); **nunca** `resolvedEnv`; teste de não-vazamento |
| Escrita síncrona no hot path | Baixo | WAL+conexão única (sub-ms); 1 sentença preparada/linha; try/catch, nunca lança |
| `bun build --compile` não resolve `bun:sqlite`/`node:sqlite` | Médio | `external:["bun:sqlite"]` no tsup; import dinâmico runtime-guarded; validar no `npm run menubar` |

## Decisões que estou tomando (vetáveis)

- **`task.status` só `merged`/`failed` pelo motor** — o motor não conhece o step "de merge" (AD-1);
  `abandoned` de task nunca é gravado (fica no CHECK p/ simetria/futuro).
- **`fail_reason` de não-agente:** step `checks` reusa a heurística de nome; step `shell`/ação de
  approval falhos → NULL (sem bucket limpo).

## Verificação end-to-end

1. **Fundação:** `npm run typecheck && npm run lint && npm test` verdes; DB idempotente + views num
   `.db` semeado.
2. **Coleta:** dogfood — rodar o próprio loopy (com `metrics:`) numa change de ≥2 tasks com um
   fix-loop; inspecionar `<root>/.db/telemetry.db` e conferir linhas por-tentativa, delta de custo,
   `size_*` vs `git diff --numstat`, `SUM(step.cost_usd)`=custo da task. Rodar **sem** `metrics:` e
   confirmar que **nenhum** `.db` nasce e o `RunLoopResult` é idêntico.
3. **CLI:** `verdict set/clear`, `bug add`, `change --abandoned` contra o `.db` dogfood.
4. **GUI:** `npm run dev -w apps/menubar`, abrir Insights e validar os **4 Success Criteria** +
   degradação sem `.db`.
5. **Empacotamento:** `npm run menubar` builda o `.app` com `rusqlite` e `bun:sqlite` externalizado.
