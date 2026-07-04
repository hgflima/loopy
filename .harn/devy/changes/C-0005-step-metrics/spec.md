# Spec: Métricas de execução por Step — tokens, tempo, custo (rollup Step→Task→Run→Change)

> Feature spec derivada do `SPEC.md`-mãe do projeto e do glossário `CONTEXT.md`.
> **Introduz** o ADR-0003 (a criar): captura de uso/tempo por Step, contrato aditivo
> e um bloco de config `metrics` opt-in. Invariante mantido (AD-1): o motor ganha a
> **mecânica** de medir e relatar; **se/onde/como** relatar são 100% `loopy.yml`.
> A palavra "change" é do **devy**, não do motor — o motor só a conhece como um
> valor de config derivado de `dirname(inputs.todo)` (ver Enquadramento §3).

## Objective

Instrumentar o Pipeline para **medir tokens e tempo de execução de cada Step** e
**acumular** esses números em quatro níveis de contenção — **Step → Task → Run
("execução") → Change** — expondo dois artefatos:

1. **Relatório de execução (Run report):** ao fim de **cada Run**, exibir (stderr/TUI)
   o breakdown por Step da execução corrente **mais** o total acumulado da Change
   até aquele momento.
2. **Relatório de change (Change report):** ao **finalizar a Change** (backlog 100%
   `[x]` na Run corrente), **persistir** um relatório por-change em um arquivo de
   índice configurável (o pedido: `.harn/devy/changes/index.md`) — uma seção por
   Change com o total + tabela por Task.

**Usuário-alvo:** quem opera o `loopy` sobre um backlog devy e quer visibilidade de
custo/tempo por Task e por Change, acumulada entre execuções (resume, `--task`,
re-runs após escalação).

**Critérios de aceite (do pedido), reenquadrados como Success Criteria** — ver
seção *Success Criteria*. Em resumo: cada Step é medido (tempo sempre; tokens/custo
best-effort via ACP); os rollups por Step/Task/Run/Change são corretos; todo fim de
Run emite relatório; todo fim de Change persiste no índice; **ausência do bloco
`metrics` = regressão zero**.

## Enquadramento (o que o pedido esconde)

1. **Tokens existem no ACP, mas o loopy os descarta hoje.** O SDK expõe
   `PromptResponse.usage` (`Usage`: `inputTokens`/`outputTokens`/`cachedRead/
   WriteTokens`/`thoughtTokens`/`totalTokens`) e um stream `session/update:
   usage_update` com `Cost` (`amount`+`currency`) — ambos `@experimental/UNSTABLE`.
   **Validado por spike contra o `claude-agent-acp` real (v0.26.0):** `usage` vem
   **não-null e rico**, e é **por-turno** — `inputTokens`/`outputTokens` são o custo
   daquele turno (3/4 num prompt trivial, constantes entre turnos), e os `cached*`
   refletem a atividade de cache do turno (turn1 *escreve* ~18k, turn2 *lê* ~18k).
   **⚠️ A doc do `.d.ts` diz "across session" mas o agente real emite por-turno** —
   logo **SOMA-se** o `usage` de cada turno (o design original). `cost` vem **não-
   null e é cumulativo da Sessão** (`$` monotônico entre turnos; `/clear` não reseta
   nem emite `usage_update`; retorna `usage` = **zeros**, não null → inócuo na soma).
   Hoje `SessionWrapper.runTurn` (`src/acp/session.ts:165-177`) recebe o
   `PromptResponse` inteiro mas retorna **só** `response.stopReason`, jogando `usage`
   fora. **Decisão (OQ4/OQ5): ACP best-effort** — a Sessão **soma** o `usage` dos
   turnos (por-Step) e guarda o último snapshot de `cost`; quando `null`, `n/d`,
   **nunca** falhar o Step por falta de métrica. Sem tokenizer, sem dependência nova.
   (Tokens são dominados por cache; o `cost` é a métrica mais informativa.)

2. **Não existe medição de tempo em lugar nenhum.** Não há `Date.now`/
   `performance.now`/`hrtime` no fluxo de Steps; a única ocorrência de clock é o
   timestamp de linha de log (`src/logging/logger.ts:63`, clock injetável). O tempo
   é **campo livre** — e será medido em **todos** os tipos de Step (Agente/Shell/
   Checks/Aprovação), não só Agente.

3. **"Change" não é um conceito do motor — é do devy.** O `src/` não conhece
   `.harn/`, "change" nem `C-000N` (grep confirma zero ocorrências). O único elo em
   runtime é o path de `config.inputs.todo` (ex.:
   `.harn/devy/changes/C-0005-step-metrics/todo.md`). Hardcodar `.harn/devy/...` no
   motor **feriria AD-1**. **Decisão (confirmada): config-driven** — o path do
   índice vive só no `loopy.yml`; o motor deriva mecanicamente
   `change.dir = dirname(inputs.todo)` e `change.id = basename(change.dir)`, sem
   nenhuma semântica de devy. `${change.dir}/../index.md` resolve exatamente para
   `.harn/devy/changes/index.md` no layout devy.

4. **"Acumular por Change até aquele momento" cruza execuções.** Uma Change pode
   abranger várias Runs (resume após `pause`, `--task`, re-run pós-escalação). Para
   o Run report mostrar "o total da change até aqui", é preciso **estado persistido
   entre Runs**. **Decisão: `.loopy/metrics.json`** (gitignored, escrita atômica no
   estilo `saveState`), **sem tocar** o schema congelado `RunState`/`TaskCheckpoint`.
   O `index.md` (versionado, `.harn/` **não** é gitignored) recebe só o snapshot
   final por Change.

5. **Um Step pode ser medido mais de uma vez.** Com `goto`/retry (C-0004), um Step
   é **visitado** N vezes por Task (teto `max_step_visits`). Cada Visita gera uma
   **Amostra**; o rollup por Step soma as Amostras daquela Task. O modelo tem de
   somar tudo — tokens/tempo gastos são custo real, incluindo retries.

## Linguagem ubíqua (adições — a promover em `CONTEXT.md` + ADR-0003)

O motor **interpreta** estas palavras; cada uma tem um único significado. Não
intercambiar com termos existentes (Iteração/Tentativa/Visita/Report de checks).

- **Amostra** (*Sample*) = a medição de **uma Visita** a um Step: `{ durationMs,
  usage?, cost? }`. Unidade mínima de coleta. `usage` = **soma** dos tokens dos
  turnos daquela Visita (usage é por-turno — validado por spike); `cost` = snapshot
  cumulativo da Sessão ao fim da Visita.
- **Uso** (*Usage*) = tokens de **um turno ACP** (`input/output/cachedRead/
  cachedWrite/thought/total`), **por-turno** (⚠️ a doc do SDK diz "across session"
  mas o `claude-agent-acp` real emite por-turno — spike). Best-effort. **Somado** ao
  longo dos turnos de um Step. Só Steps de **Agente** têm Uso; Shell/Checks/Aprovação
  → `usage = n-a`.
- **Custo** (*Cost*) = valor monetário **cumulativo da Sessão** (`amount`+`currency`,
  via `usage_update`), best-effort; `n/d` quando o agente não reporta. Reportado a
  nível de Task/Run/Change (nunca por-Step — OQ2). (Cumulativo confirmado por spike.)
- **Agregado**/*Rollup* = soma de Amostras num nível: **por Step** (Amostras de um
  `id` numa Task), **por Task** (Σ Steps), **por Run** (Σ Tasks daquela execução),
  **por Change** (Σ Runs).
- **Relatório de execução** (*Run report*) = saída emitida ao fim de **cada Run**
  (breakdown por Step da Run + acumulado da Change).
- **Relatório de change** (*Change report*) = artefato persistido no índice ao
  **finalizar a Change** (uma seção por Change: total + tabela por Task).
- **Change** = **termo do devy**, adotado no motor **só** como par de valores de
  config derivados: `change.dir = dirname(inputs.todo)`, `change.id =
  basename(change.dir)`. O motor **não** ganha lógica de change além de (a)
  interpolar `${change.*}` e (b) escrever onde o yml mandar. (Cf. AD-1.)

## Design

### Fluxo de dados (coleta → rollup → artefatos)

```
Step.execute (Visita) ──► Amostra {durationMs, usage?Σ, cost?}
        │  tempo:  envelope de interpreter.execute (orchestrator, clock injetável)
        │  tokens: session.drainUsage() após execute → soma dos turnos (por-turno)
        │  custo:  session.readCost() após execute → snapshot cumulativo
        ▼
   Rollup por Task  ──►  Rollup por Run (RunLoopResult.metrics)
        ▼
   .loopy/metrics.json  ── merge por Change ─►  Rollup por Change
        │                                            │
        ▼ (todo fim de Run)              ▼ (fim da Change = todo.md 0 pendentes)
   Run report (stderr)                          index.md (Change report)
```

### Pontos de instrumentação

- **Tempo por Step:** envolver `interpreter.execute(ctx)` no orquestrador —
  `src/loop/orchestrator.ts:723` (caminho principal) **e** `:800` (teardown
  `always`; não esquecer, senão Steps de cleanup ficam sem métrica). `durationMs =
  clock() - t0` com **clock injetável** (default `Date.now`; testes injetam para
  determinismo, padrão de `logger.ts`). O orquestrador é o **único escritor** de
  Amostras: ele já rastreia `visits`/`iteration`/`task`/`step.id/type`. Amostra só
  para Steps **efetivamente executados** — o guard de `max_step_visits` (escala sem
  executar) e o no-op de `type` sem intérprete **não** geram Amostra.
- **Tokens por Step (Agente):** cada `PromptResponse.usage` (**por-turno** — spike)
  é **somado** num acumulador por-sessão em `SessionWrapper.runTurn`
  (`src/acp/session.ts:169-176`, espelhando o `TurnTextBuffer`). `AgentSession` ganha
  `drainUsage(): TurnUsage | null` (soma acumulada desde o último drain, **reseta**;
  contrato **aditivo**, `prompt()` **não muda**). O orquestrador — único escritor de
  Amostras — chama `drainUsage()` **após** `execute()` (captura **todos** os turnos
  do verify loop de uma vez; ler snapshot pegaria só o último). Steps não-Agente
  nunca abrem sessão → `drainUsage` na lazy não-aberta = `null` → `usage = n-a`. O
  turno `/clear` soma zeros (inócuo). **`StepResult` fica intocado**: a captura sai da
  Sessão, não do resultado do Step (OQ5).
- **Custo (best-effort):** `AgentSession` ganha `readCost(): StepCost | null`
  (snapshot **cumulativo** da Sessão). O `cost` do `usage_update` é acumulado num
  **buffer por-sessão** em `src/acp/client.ts` (branch `usage_update` do handler
  `session/update`, `client.ts:500-504`); o `SessionWrapper` o expõe via
  `readCost()`. O orquestrador lê o snapshot **após** `execute()` (a barreira
  `flushSessionUpdates` do último turno já drenou as notificações). Como é cumulativo
  por Sessão (≈ por Task), o custo é reportado a nível de **Task/Run/Change** — o
  rollup por Task toma o **último snapshot não-nulo**.

### Modelo de estado (`.loopy/metrics.json`, gitignored, v1)

```jsonc
{
  "version": 1,
  "change": { "id": "C-0005-step-metrics",
              "dir": ".harn/devy/changes/C-0005-step-metrics" },
  "runs": [
    { "index": 1, "startedAt": "<ISO>", "finishedAt": "<ISO>",
      "stoppedBy": "backlog_empty",
      "tasks": {
        "T-001": { "steps": {
          "create-worktree": { "type": "shell", "visits": 1,
                               "durationMs": 1200, "usage": null },
          "implement": { "type": "agent", "visits": 2, "durationMs": 51230,
            "usage": { "inputTokens": 12000, "outputTokens": 3400,
                       "cachedReadTokens": 8000, "thoughtTokens": 500,
                       "totalTokens": 15400, "available": true } }
        }, "cost": { "amount": 0.42, "currency": "USD", "available": true } }
      } }
  ]
}
```

- **Semântica dos números:** `usage` por Step é a **soma** dos turnos daquela
  Visita/Step (usage é por-turno); somar Steps→Task→Run→Change. `cost` por Task é o
  **último snapshot cumulativo** da Sessão. `available:false` explícito quando o ACP
  não reportou.
- **Merge idempotente por Run:** cada Run **acrescenta** um registro em `runs[]`.
  A Change total é um **fold puro** sobre `runs[]` (auditável; nada de contador
  mutável escondido). Escrita atômica (`mkdir -p` + `.tmp` + `rename`), leitura
  tolerante a ausência/corrupção → estado vazio (padrão `src/resume/state.ts`).
- **Invalidação:** se `change.id`/`change.dir` do arquivo divergirem da Run atual
  (yml apontou para outra change), começa arquivo novo — nunca mistura changes.

### Bloco de config `metrics` (opt-in — ausência = regressão zero)

```yaml
metrics:                          # bloco ausente ⇒ feature 100% desligada
  report:                         # bloco OPCIONAL (OQ6)
    index: "${change.dir}/../index.md"   # onde o Change report persiste (interpolável)
```

- **Presença de `metrics`** → coleta Amostras + emite Run report (stderr) + grava
  `.loopy/metrics.json`. **Sempre**, independente de `report`.
- **`metrics.report.index` presente** → ao **finalizar a Change** (todo.md com 0
  pendentes após a Run), persiste o Change report no path resolvido. Ausente → só
  Run report + metrics.json, sem index.md.
- Validação zod: `metrics` opcional; `report` **opcional**; se `report` presente,
  `report.index` obrigatório (string não-vazia). `.strict()`/readonly como o resto
  do schema. Defaults aplicados em `LoopyConfig` (o motor recebe já normalizado).
  **Sem `change_id` na config** (OQ3): o `change.id` é sempre derivado do path (ver
  abaixo).

### Interpolação (`${change.*}` — AD-4)

`buildScopeVars` (`src/loop/orchestrator.ts:103`) ganha, aditivamente — **id sempre
derivado do path** (OQ3, sem override de config):

```ts
change: { id: basename(dirname(config.inputs.todo)),   // ex.: "C-0005-step-metrics"
          dir: dirname(config.inputs.todo) }
```

Assim `${change.*}` fica disponível também nos prompts/comandos dos Steps. O
`metrics.report.index` é resolvido **uma vez a nível de Run** em `src/index.ts`
(sem Task), contra um escopo run-level com `change.*` + `inputs.*` + `workspace.*`;
o path resultante é **normalizado** (`..` colapsado) e resolvido contra `root`.
Var desconhecida continua **fail-fast** (`InterpolationError`), como hoje.
**Fallback:** quando `dirname(inputs.todo)` é `"."`/vazio (backlog na raiz),
`change.id` cai para `config.name`. O dry-run (fatia pura) resolve `${change.*}`
idêntico ao run vivo (AD-4).

### Formato dos relatórios (funções puras — AD-6)

- **Run report** (texto, **stderr via o line-reporter** — OQ1, MVP; render rico na
  TUI Ink fica fora de escopo): um bloco por Task, **uma linha por Step**
  (`id · type · Δt · in/out/cached`; `n-a` para shell/checks/aprovação, `n/d` quando
  o ACP não reportou); **subtotal por Task** (`Σ Task · Δt · tokens · custo`); **total
  da Run**; e a linha **"Change até agora: N Runs · M Tasks · Σtokens · Σtempo ·
  Σcusto"**. **Custo só nos totais de Task/Run/Change** (OQ2), nunca por-Step. Emitido
  em `src/index.ts` **após `runLoop`** (a TUI já parou no `finally` do
  `defaultRunLive`, então o stderr não colide com o Ink). (OQ9)
- **Change report** (Markdown, para `index.md`): uma **seção por Change** (heading
  `## <change.id>`) com um parágrafo de totais (Runs, Tasks, tokens, tempo, custo,
  `stoppedBy` da última Run) **+ tabela rica por Task** (`| Task | Δt | in | out |
  cached | tokens | visits | custo |`; `visits` = total de Amostras/execuções de
  Step da Task). Seções **novas anexadas ao fim** (cronológico); seção existente
  **reescrita in-place**, preservando as outras **byte-a-byte** e qualquer preâmbulo
  (padrão do `markDone` em `src/backlog/todo.ts`). Fronteira da seção: do heading
  `## <id>` até a linha antes do próximo `## ` (h2) ou EOF. Índice inexistente → cria
  com um título `#` fixo. (OQ8)

### Onde o "fim de Run" / "fim de Change" são disparados

- `runLoop` já retorna `RunLoopResult { completed, escalated, iterations,
  stoppedBy }` (`src/loop/orchestrator.ts:847`). **Estende-se aditivamente** com
  `metrics: RunMetrics` (o rollup da Run) + `startedAt`/`finishedAt` (carimbados pelo
  clock injetável).
- Em `src/index.ts` (hoje o summary de uma linha em `:414-418`), após `runLoop`:
  (1) merge do `RunMetrics` em `.loopy/metrics.json` (append em `runs[]`, escrita
  atômica); (2) lê de volta o rollup da Change e emite o **Run report**; (3) o **fim
  da Change** é detectado **re-parseando o `todo.md`** — se `pendingTasks === 0` **e**
  `metrics.report.index` configurado → escreve o Change report no índice.
  **Não** se usa `stoppedBy === "backlog_empty"` como gatilho: com `--task`,
  `skip_task` ou re-run ele não implica backlog 100% `[x]` (o loop retorna
  `backlog_empty` ao esgotar a *lista selecionada*, não o backlog inteiro). (OQ7)
- **Durabilidade:** `metrics.json` é escrito **uma vez ao fim de cada Run** (pausa/
  escalação retornam limpo e persistem; só um crash duro perde as métricas da Run
  corrente — best-effort, aceitável). Steps pulados no resume (já executados em Run
  anterior) não geram Amostra na Run atual → sem dupla contagem intra-Run; a mesma
  Task reexecutada em Runs distintas soma em ambas (custo real de retries).

## Tech Stack

Sem dependências novas (decisão ACP best-effort dispensa tokenizer). Stack atual:
TypeScript/Node ≥20 ESM, `@agentclientprotocol/sdk`, `commander`, `execa`,
`ink`+`react`, `yaml`, `zod`, `vitest`, `tsup`.

## Commands

```
Dev:        npm run dev -- [args]
Typecheck:  npm run typecheck      # prova o contrato aditivo (types.ts)
Lint:       npm run lint
Test:       npm test               # vitest
Build:      npm run build          # tsup → dist/
```

## Project Structure

```
src/types.ts            → aditivo: TurnUsage, StepCost, AgentSession.drainUsage()/
                          readCost(), MetricsConfig em LoopyConfig, RunMetrics/
                          ChangeMetrics, RunLoopResult.metrics + startedAt/finishedAt.
                          StepResult NÃO muda; prompt()/demais assinaturas NÃO mudam.
src/config/schema.ts    → zod do bloco `metrics` (report OPCIONAL) + defaults
src/metrics/            → NOVO módulo (puro): rollup folds (Amostra→Step→Task→Run→
                          Change), renderers (Run report + index.md rico), load/merge/
                          save de metrics.json (atômico), rewrite byte-preserving de
                          seção do index.md, formatação (tokens k/M, Δt h/m/s, custo)
src/acp/session.ts      → SessionWrapper SOMA usage (PromptResponse, por-turno) num
                          acumulador + expõe drainUsage() (reset)/readCost()
src/acp/client.ts       → buffer de cost por-sessão alimentado no branch usage_update
src/loop/orchestrator.ts→ cronometrar execute (2 sites, clock injetável); drainUsage()
                          + readCost() APÓS execute → Amostra/RunMetrics; ${change.*}
                          em buildScopeVars; lazy session + notWiredSession
                          implementam drainUsage/readCost
src/index.ts            → merge metrics.json, emitir Run report, re-parsear todo.md,
                          persistir index.md quando 0 pendentes + report.index setado
src/tui/line-reporter.ts→ (nice-to-have) render do Run report
examples/loopy.yml      → exemplo do bloco `metrics`
tests/fixtures/project/loopy.yml → fixture com `metrics`
docs/adrs/0003-*.md     → ADR da feature (contrato aditivo + AD-1 + best-effort)
```

## Code Style

Contrato aditivo, provado por `tsc`; erros como valores no boundary (AD-5); puro
onde dá (AD-6). Ex.:

```ts
export interface TurnUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedReadTokens?: number;
  readonly cachedWriteTokens?: number;
  readonly thoughtTokens?: number;
  readonly totalTokens: number;
  /** false quando o ACP não reportou (best-effort → render "n/d"). */
  readonly available: boolean;
}

export interface StepCost {
  readonly amount: number;
  readonly currency: string;       // ISO 4217 (ex.: "USD")
  readonly available: boolean;
}

// aditivo à SESSÃO (StepResult fica INTOCADO — OQ5).
export interface AgentSession {
  // … contrato existente (prompt/setMode/clear/readText/cancel) INALTERADO …
  /** Soma do usage (por-turno) desde o último drain; reseta. null se o ACP não reportou. */
  drainUsage(): TurnUsage | null;
  /** Snapshot cumulativo de custo da Sessão; null quando o ACP não reportou. */
  readCost(): StepCost | null;
}
```

## Testing Strategy

`vitest`, testes junto ao código. Cobertura por camada:

- **Puro (unit):** o fold de rollup (Amostra→Step→Task→Run→Change; soma correta,
  Visitas somadas, tokens `n/d` propagados); renderers (Run report text; index.md
  markdown); merge de `metrics.json` (append de Run; fold da Change; troca de
  change.id → arquivo novo); atualização idempotente do índice (reescreve só a
  seção da change; preserva outras seções byte-a-byte).
- **Instrumentação:** `session.drainUsage()`/`readCost()` — mock de `PromptResponse`
  com/sem `usage` (por-turno; **soma** multi-turno; drain **reseta**;
  `null`→`available:false`; turno `/clear` = zeros, inócuo); cost via buffer de
  `client.ts` (`usage_update`, cumulativo → último snapshot); orquestrador drena
  **após** `execute`; timing com clock injetado (durationMs determinístico);
  cobertura dos **dois** call-sites de `execute` (principal + teardown `always`);
  Step não-executado (visit-exceeded / sem intérprete) **não** gera Amostra.
- **Config/interp:** zod do bloco `metrics` (válido/ inválido: `report.index`
  faltando); `${change.id}`/`${change.dir}` resolvem; var desconhecida fail-fast.
- **Aceite/integração:** rodar o fixture com `metrics` → assertar shape do
  `metrics.json`, a seção no `index.md`, e a linha do Run report; **e** um run
  **sem** bloco `metrics` → nenhum artefato novo (regressão zero).

## Boundaries

- **Always:** manter as mudanças de contrato **aditivas** (tsc prova) — `StepResult`
  fica **intocado**; métodos novos na `AgentSession` (`drainUsage`/`readCost`); coleta
  de métrica **side-effect-free**; tokens **best-effort** (`n/d`, jamais falhar um
  Step por `usage`/`cost` null); **somar** o `usage` por-turno (não tratar como
  cumulativo); **gatear** todo I/O novo
  atrás do bloco `metrics` (regressão zero quando ausente); escrita atômica;
  atualização do `index.md` idempotente + byte-preservando seções não relacionadas;
  medir **todos** os 4 tipos de Step para tempo; cronometrar os **dois** sites de
  `execute`; **fim-da-Change via re-parse do `todo.md` (0 pendentes), nunca via
  `stoppedBy`**.
- **Ask first:** mexer na forma dos contratos congelados além dos aditivos aqui
  previstos (`drainUsage`/`readCost` em `AgentSession`); tocar o schema de
  `.loopy/state.json` (`RunState`); adicionar qualquer dependência (a decisão ACP
  best-effort **não** adiciona nenhuma); ratear custo por-Step (hoje é por-Task/Run/
  Change por ser cumulativo da Sessão).
- **Never:** hardcodar `.harn/devy/...` ou qualquer semântica de devy no motor
  (AD-1); falhar Run/Step por métrica indisponível; escrever métrica quando o bloco
  `metrics` está ausente; pôr estado de runtime (`metrics.json`) fora do `.loopy/`
  gitignored; **tratar o `usage` por-turno como cumulativo** (ele é somado, não
  delta — a doc do SDK engana; ver spike); mudar assinaturas públicas **existentes**
  de `AgentSession`/`StepResult`.

## Success Criteria

1. Com `metrics` configurado, `.loopy/metrics.json` existe com registros por Run
   contendo, por Task, cada Step com `durationMs` e (agent) `usage` **somado** /
   `cost` cumulativo ou `available:false` explícito.
2. **Rollups corretos** (provado por unit no fold puro): Task = Σ Steps (tokens
   somados; cost = último snapshot); Run = Σ Tasks; Change = Σ Runs; Visitas de um
   Step somadas.
3. Ao fim de **cada Run**, um Run report (stderr) é emitido com breakdown por Step
   da Run + acumulado da Change até ali.
4. Quando o **`todo.md` fica com 0 pendentes** após a Run (backlog 100% `[x]`) **e**
   `report.index` está setado (default resolve para `.harn/devy/changes/index.md`),
   o Change report é persistido: seção por Change com total + **tabela rica** por
   Task; re-persistir atualiza **só** a seção daquela Change, byte-preservando as
   outras. **Nunca** dispara por `--task`/`skip_task` que não zeraram o backlog.
5. Quando o ACP não retorna `usage`/`cost` (null), o Step **sucede** e o relatório
   mostra `n/d` — sem crash, sem Step falho.
6. **Sem** bloco `metrics`, comportamento byte-idêntico ao de hoje (nada de
   `metrics.json`, `index.md` ou relatório extra) — regressão zero.
7. `${change.id}`/`${change.dir}` resolvem na interpolação; var desconhecida
   segue fail-fast.
8. `npm run typecheck`, `npm run lint`, `npm test` verdes.

## Decisões resolvidas (ex-Open Questions)

- **OQ1 — Saída do Run report:** **stderr via o line-reporter** (MVP). Fiar o run
  vivo à TUI Ink (render rico) fica **fora de escopo** — é dívida técnica
  pré-existente (`src/tui/CLAUDE.md`) e vira trabalho futuro separado.
- **OQ2 — Granularidade do custo:** **por Task/Run/Change** apenas (custo do ACP é
  cumulativo da Sessão). Steps expõem só tokens+tempo. **Não** ratear custo
  por-Step no MVP; reavaliar só se o ACP expuser custo por-turno estável.
- **OQ3 — `change.id`:** **sempre derivado** de `basename(dirname(inputs.todo))`.
  Sem campo `metrics.report.change_id` na config (menos superfície). Backlog fora
  do layout devy ainda funciona: o id vira o nome da pasta que contém o `todo`.
  Fallback para `config.name` quando `dirname` é `"."`/vazio (backlog na raiz).
- **OQ4 — Semântica de `usage`:** **por-turno** (validado por spike contra
  `claude-agent-acp` v0.26.0 — ⚠️ a doc do `.d.ts` diz "across session" mas o agente
  real emite por-turno: `input`/`output` constantes entre turnos). **Somar** os
  turnos → Uso por-Step; Σ até Change. `/clear` retorna zeros (inócuo). `cost` é
  cumulativo da Sessão (confirmado).
- **OQ5 — Fluxo de captura:** `AgentSession.drainUsage()` (somador por-sessão que
  **reseta**) + `readCost()` (snapshot cumulativo). O **orquestrador** (único escritor
  de Amostras) os chama **após** `execute()` — assim captura **todos** os turnos do
  verify loop (ler snapshot pegaria só o último). **`StepResult` fica intocado.**
- **OQ6 — `report.index` opcional:** `metrics` presente → Run report + metrics.json
  sempre; `index.md` só quando `report.index` setado. Dois artefatos independentes.
- **OQ7 — Fim da Change:** re-parse do `todo.md` (`pendingTasks === 0`), **não**
  `stoppedBy === "backlog_empty"` (que só significa "lista selecionada esgotada" —
  falha com `--task`/`skip_task`/re-run).
- **OQ8 — `index.md`:** tabela **rica** por Task (in/out/cached/tokens/visits/custo);
  seções anexadas ao fim (cronológico), existente reescrita in-place byte-preserving.
- **OQ9 — Run report:** por-Step agrupado por Task, subtotal por Task, total da Run,
  linha "Change até agora"; stderr via line-reporter (após a TUI parar).
