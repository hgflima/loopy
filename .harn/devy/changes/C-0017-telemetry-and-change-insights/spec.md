# Spec: C-0017 — Telemetria SQLite: coleta insert-only, bugs, veredito humano e visualização por change

> **Esta spec reconcilia a proposta original** (o texto entregue ao `/devy:spec`) **com a realidade do
> código.** A proposta descreve o QUE se quer; o refine cruzou-a com `src/metrics/` (ADR-0003),
> `src/loop/orchestrator.ts`, `src/acp/session.ts`, `apps/menubar/` e com uma spike empírica dos
> drivers SQLite. Sete decisões estruturais e as derivadas estão em `## Decisões`; a DDL foi
> **corrigida** nos pontos onde a proposta violava o próprio invariante (ver `## DDL`).
>
> Vocabulário: **DEVE** = requisito · **NÃO DEVE** = proibição · **PODE** = opcional.
>
> **2º refine (2026-07-14):** cinco ramos abertos foram fechados (leitura CLI, escrita CLI, schema
> `metrics`, coluna comparada e defeito escapado) e as quatro Open Questions resolvidas — tudo em
> `### Refinadas` e em `## Open Questions`. OQ1/OQ2/OQ4 caíram no código (spikes de exploração); OQ3
> confirmada.

## Objective

**O quê.** Persistir a telemetria de execução do loopy num **SQLite** (`<parent>/.db/telemetry.db`),
insert-only para os fatos (step/task/change) e mutável para as anotações humanas (veredito de task,
bugs), e apresentá-la numa **4ª aba da GUI menubar** que compara uma change contra a média histórica
e contra outra change escolhida.

**Por quê.** Hoje as métricas (ADR-0003) vivem num `.loopy/metrics.json` **por-change** — trocar de
change recomeça o arquivo do zero. Comparar changes é, na persistência atual, impossível. O propósito
desta change é responder três perguntas que o loopy hoje não responde: *quanto custou esta change e
onde (por task, por tentativa)?*, *o pipeline está melhorando run a run?* e *onde o review do agente
está deixando passar defeito?* (a task que mergeou, passou no review, e é `fail` para o humano).

**Usuário.** O operador do loopy (você) revisando o resultado de uma ou mais changes — durante um run
(a aba mostra a change em andamento) e, sobretudo, depois (revisão fria, comparação histórica).

**Sucesso.** Os quatro itens de `## Success Criteria` passam manualmente na GUI, e um run real do
próprio loopy popula o `.db` sem alterar um byte do `RunLoopResult` (AD-1).

## O que muda em relação a `src/metrics/` (ADR-0003)

A coleta que a proposta pede **já existe pela metade**. `timedExecute`
(`src/loop/orchestrator.ts:923`) é o único escritor de Amostras e já mede, por **Visita**,
`{ durationMs, usage, cost }`; `TurnUsage` (`src/types.ts:358`) já separa os 4 contadores
(`inputTokens`/`outputTokens`/`cachedReadTokens`/`cachedWriteTokens`); `readCost()`
(`src/acp/session.ts:450`) já dá o custo cumulativo por Sessão. O que falta é **onde isso vive**
(um JSON por-change, não queryável, sem timestamps absolutos, sem status/config) e **a granularidade**
(hoje a Amostra funde as tentativas do `verify` num número só).

**Decisão de escopo (D1):** o `.db` **substitui** a persistência atual — `.loopy/metrics.json`, o
Relatório de execução (stderr) **e** o Relatório de change (`index.md`) são **aposentados**. A tela é a
única leitura. `src/metrics/` (folds/store/report/change-report) é desmontado; a álgebra de rollup vira
`SUM()`/views em SQL. Isso paga o **D-0008** de graça (o custo de Run/Change subconta hoje por ser
`last-non-null`; em SQL vira `SUM()` correto) e torna a **ADR-0003 estendida** por uma ADR nova
(persistência SQLite, granularidade por-tentativa) — não revogada: o **gate opt-in por `metrics:`
sobrevive** (ver D7).

## Decisões

### Estruturais (perguntadas no refine)

| # | Decisão | Escolha |
|---|---|---|
| **D1** | Relação com `src/metrics/` | **O `.db` substitui tudo**, relatórios (stderr + `index.md`) inclusive. A tela é a única leitura. `src/metrics/` é desmontado. |
| **D2** | Ciclo de vida da `change` | **Dimensão mutável.** `INSERT OR IGNORE` no início do run (`created_at`, `repo`, `base_sha`, `pipeline_version`); `ended_at`/`status` ficam `NULL` até fechar. Fecha `merged` ao zerar o backlog; `abandoned`/`failed` por CLI. A change em andamento **já aparece** na tela. Resolve a violação de FK da proposta (a task terminava antes da change existir). |
| **D3** | Granularidade de uma linha em `step` | **Uma linha por Tentativa.** Cada retry do `verify` é sua própria linha, com tokens/custo/duração próprios — responde "quanto custa o loop errar". Exige instrumentar o loop interno em `src/steps/agent.ts` (que já emite `attempt_started`). |
| **D4** | Driver SQLite (dois runtimes: Node no npm, `bun build --compile` no sidecar) | **`node:sqlite` + `bun:sqlite`** atrás de um adapter guardado por runtime. Zero dependências novas. Bump `engines` → `>=22.13` (Node 20 é EOL; `node:sqlite` não existe nele). `better-sqlite3` foi **descartado** — compila com `bun --compile` mas crasha em runtime (`$bunfs` sem `package.json`); nenhuma opção WASM suporta WAL. |
| **D5** | `step.fail_reason` (insert-only imutável) | **Motor grava só o mecânico**: `test-fail`/`type-error`/`lint-fail`/`build-fail` (do nome do check), `expect-fail` (review reprova o expect), `human-rejected` (gate), `infra` (error/timeout). Os quatro juízos (`hallucinated-api`/`scope-creep`/`incomplete`/`style`) **saem do enum** — são análise qualitativa, fora de escopo desta change (viram anotação humana futura se necessário). |
| **D6** | Quem escreve as anotações e como a GUI acessa o `.db` | **Escritor único = motor/CLI.** Fatos durante o run (insert-only); anotações via `loopy verdict set` / `loopy bug add` (CLI one-shot). A GUI **lê** por comando Rust `rusqlite` (SELECT-only nas views) e **escreve** invocando esses comandos como subprocesso — o padrão `probe_agent` já existente. Schema, `sha256` e views ficam **só no motor** (TS). |
| **D7** | Coleta sempre-ligada ou opt-in | **Opt-in via `metrics:`** (mantém o AD-1 à letra). `metrics:` presente no yml → grava no `.db`; ausente → nada. Retrocompatível; a ADR-0003 sobrevive. Risco aceito: change rodada sem o bloco vira buraco no baseline. |

### Refinadas (2º refine — 2026-07-14, perguntadas)

| # | Decisão | Escolha |
|---|---|---|
| **D19** | Leitura por terminal (headless/CI) | **A GUI é a única leitura.** Sem `loopy report`, sem métricas em stderr. O `query.ts` **não é** superfície de CLI — o único leitor do `.db` é o Rust/`rusqlite` da GUI (SELECT-only nas views). Headless/CI ficam sem métricas por design (aceito). Reforça a D1 ("a tela é a única leitura") à letra. |
| **D20** | Superfície de **escrita** do CLI | **Mínimo + reverter veredito.** Entram: `verdict set --pass\|--fail`, `verdict clear` (o tri-estado da tela volta a "não avaliada" = DELETE da linha), `bug add`, e `change` status `--abandoned\|--failed` (fecha o par da D2). Status de bug (`fixed`/`wontfix`/`invalid`) e `resolved_at` ficam **latentes no schema, sem verbo** — resolver bug é change futura. |
| **D21** | `metrics.report` fora de escopo, mas `.strict()` + subpath export | **Aceito-mas-ignorado + warning.** `metrics:` segue gate por-presença; `report` continua `optional()` no `metricsSchema`, o motor o **ignora** e emite warning de deprecação. Ymls existentes (deste repo e `examples/`) seguem parseando; a shape do `@hgflima/loopy/config` não quebra. |
| **D22** | Default da 3ª coluna (change comparada, Δ%) | **Auto = change merged anterior + dropdown.** Ao abrir a aba, a 3ª coluna já vem com a change merged imediatamente anterior (por `created_at`); um dropdown lista todas as changes para trocar o alvo. Responde "melhorei vs a última?" sem clique. |
| **D23** | Surfacing do **defeito escapado** (Objective §Q3) | **Badge/filtro dedicado por-task.** A tela marca e permite filtrar tasks `status='merged'` **+** `human_verdict='fail'` (bônus: com bug aberto). Torna a 3ª pergunta-título do Objective de primeira classe — sem varrer a lista. Amplia a §5 "inalterada" só nesse ponto. |

### Derivadas (não perguntadas — o código responde *como*)

| # | Derivada | Fonte |
|---|---|---|
| **D8** | **WAL setado uma vez no bootstrap**, não a cada conexão. A spike provou que `busy_timeout` **não** protege o `PRAGMA journal_mode=WAL` (dois processos criando o banco morrem com `SQLITE_BUSY` na linha do pragma). WAL é persistente no header — set once. | spike SQLite |
| **D9** | **Uma conexão-escritora única** por processo. As tasks paralelas rodam no **mesmo processo** (`orchestrator.ts`), então writes síncronos numa conexão só serializam sem nunca tocar `SQLITE_BUSY`. `busy_timeout=5000` fica como rede de segurança para o leitor Rust concorrente. | `src/loop/`, spike |
| **D10** | **`step.cost_usd` = delta de snapshots cumulativos.** `readCost()` é cumulativo por Sessão (`${agent}::${worktree}`); o custo de uma tentativa = snapshot ao fim − último snapshot da **mesma sessão**. `clear_context` reabre a sessão mas `costCarry` mantém o cumulativo monotônico, então o delta sobrevive a clears. Steps não-agente → delta 0 → `cost_usd` NULL. Isso torna o custo por-Step derivável e **dispensa** o veto do ADR-0003. | `session.ts:365,450` |
| **D11** | **`pipeline_version` = `pipelineFingerprint(pipeline)`** já existente (`src/resume/state.ts:25`, `sha256:` do pipeline). **`prompt_version` = sha256 do template do prompt do step** (pré-interpolação — o texto interpolado muda por task; o template é estável por step). **`config_id` = sha256(preset\|model\|mode\|effort\|prompt_version)** resolvidos. `node:crypto` funciona nos dois runtimes. | `resume/state.ts` |
| **D12** | **`step.human_seconds`** = tempo do lado do motor entre emitir o gate (`approval_requested`) e receber a decisão. NULL (ou 0) sob `-y/--yes`. Independe do D-0005 (o motor sabe qual approval está pendente). | `src/steps/approval.ts` |
| **D13** | **`price` + `v_step_repriced` ficam no schema, mas o preenchimento de `price` é seed manual — fora de escopo.** O custo primário vem do ACP (D10). A reprecificação histórica é uma capability latente, não pedida no aceite. | proposta §2 |
| **D14** | **`bug` é 1:1 com task** nesta change (FK simples `bug.task_id`). O N:N (`bug_task`) fica para uma change futura, se o caso "um defeito de duas tasks" se provar comum. | proposta §3 |
| **D15** | **`.db/` é Artefato de runtime → gitignored** no repo-alvo (e no `.gitignore` deste repo, para dogfooding), como `.loopy/` e `.worktrees/`. | CONTEXT.md (Artefato) |
| **D16** | **`step.kind` inclui `checks`** (4 tipos: `shell`/`agent`/`checks`/`approval` — `src/types.ts:217`). A DDL da proposta listava só 3. | `config/schema.ts:189-224` |
| **D17** | **`v_change_baseline` computa o desvio-padrão à mão** (`sqrt(avg(x*x) - avg(x)*avg(x))`) — SQLite não tem `STDDEV` nativo. | proposta §5 ("mostrar o desvio") |
| **D18** | O **filtro de maturidade** de bug (`≥30 dias`) é aplicado **na leitura da tela** (o Rust/frontend tem "hoje"), não na view crua — views puras não têm relógio. | proposta §3 |
| **D24** | **`resolved_json` = o `AgentDef` serializado (forma declarada).** A spike provou: `resolvedAgents.byName[name]` guarda os **templates `${env.KEY}` literais**, não valores — `resolveAgentEnv` resolve num passe efêmero (`index.ts:572`) que vai direto pro spawn e **nunca** é gravado de volta. Serializar essa forma (a mesma que `serialize.ts` usa, que já strippa `resolvedAgents`) **não vaza secret**. Fecha a OQ1. **Nunca** serializar `resolvedEnv`/`PerAgentOptions.env` (este contém `process.env` inteiro). | `config/env.ts`, `types.ts:48` |
| **D25** | **`seq` é local por-task e derivado no insert.** `runTaskPipeline` roda 1×/task com `pc`/`visits`/`stepIndex` locais (`orchestrator.ts:878+`); um `seq` em `timedExecute` seria naturalmente por-task. Mas o checkpoint **não persiste `seq`** — então o insert deriva `seq = COALESCE(MAX(seq),0)+1 WHERE task_id=?`, race-free pela conexão-escritora única (D9). Sobrevive a resume/re-visita sem colidir no `UNIQUE(task_id, seq)`. Fecha a OQ2. | `orchestrator.ts`, spike |
| **D26** | **Derivação da dimensão `change`.** `change_id` = o prefixo `C-\d+` de `basename(dirname(inputs.todo))` (assim `task_id`=`C-0016/T-002` bate com a CLI); `name` = o slug completo do dir (fallback `config.name` quando o dir é "."). `repo` = origin/basename do repo; `base_sha` = `git rev-parse HEAD` do parent no início do run. Espelha `deriveChange`. | `orchestrator.ts:116` |
| **D27** | **`RunLoopResult` perde o campo `metrics`.** Com `src/metrics/` desmontado, o único consumidor de `result.metrics` (`index.ts:845`) some; o campo é removido **incondicionalmente**. A paridade da AD-1 se mantém porque a remoção não depende do gate `metrics:` (com e sem o bloco, o shape é idêntico). O aceite "sem alterar um byte do `RunLoopResult`" é a **paridade on/off** da AD-1, não a permanência do campo. | `orchestrator.ts:1240` |

## DDL (corrigida)

> Mudanças sobre a proposta, marcadas com `-- ✳`. Migração: um só arquivo de schema versionado,
> aplicado no bootstrap (idempotente via `CREATE TABLE IF NOT EXISTS` / `user_version`).

```sql
PRAGMA journal_mode = WAL;          -- ✳ D8: setado UMA vez no bootstrap, não por conexão
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;

-- ===================== DIMENSÕES =====================

CREATE TABLE agent_config (
  config_id      TEXT PRIMARY KEY,   -- sha256(preset|model|mode|effort|prompt_version)  (D11)
  preset         TEXT NOT NULL,
  model          TEXT NOT NULL,
  mode           TEXT NOT NULL,
  effort         TEXT,               -- nullable: effort é best-effort por-agente (pode ser no-op)
  prompt_version TEXT NOT NULL,      -- sha256 do TEMPLATE do prompt (pré-interpolação)  (D11)
  resolved_json  TEXT NOT NULL,
  first_seen_at  TEXT NOT NULL
);

CREATE TABLE price (                 -- USD por 1M tokens — seed manual, fora de escopo (D13)
  price_version            TEXT NOT NULL,
  model                    TEXT NOT NULL,
  usd_per_mtok_in          REAL NOT NULL,
  usd_per_mtok_out         REAL NOT NULL,
  usd_per_mtok_cache_read  REAL NOT NULL,
  usd_per_mtok_cache_write REAL NOT NULL,
  effective_from           TEXT NOT NULL,
  PRIMARY KEY (price_version, model)
);

-- ===================== FATOS =====================

-- ✳ D2: change é DIMENSÃO mutável, não fato terminal.
--   INSERT OR IGNORE no início do run; UPDATE único ao fechar (ended_at/status).
--   É a ÚNICA tabela com UPDATE — porque uma change vive dias e N runs.
CREATE TABLE change (
  change_id        TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  repo             TEXT NOT NULL,
  base_sha         TEXT,
  pipeline_version TEXT NOT NULL,    -- pipelineFingerprint()  (D11)
  created_at       TEXT NOT NULL,
  ended_at         TEXT,             -- ✳ nullable: NULL enquanto a change está aberta
  status           TEXT              -- ✳ nullable: NULL = em andamento
                   CHECK (status IS NULL OR status IN ('merged','abandoned','failed'))
);

-- task e step são FATOS insert-only (nunca UPDATE).
CREATE TABLE task (
  task_id       TEXT PRIMARY KEY,    -- 'C-0016/T-002'
  change_id     TEXT NOT NULL REFERENCES change(change_id),  -- FK válida (D2: change existe antes)
  task_number   TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  ended_at      TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('merged','abandoned','failed')),
  size_files    INTEGER,             -- git diff --numstat base..head no reconcile-parent
  size_added    INTEGER,
  size_removed  INTEGER,
  UNIQUE (change_id, task_number)
);

-- Sem FK para task: o passo é inserido antes da task existir.
CREATE TABLE step (
  step_id     TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL,         -- sem FK (proposta §1)
  change_id   TEXT NOT NULL,
  seq         INTEGER NOT NULL,      -- ✳ D3: ordem global de execução na task (a linha do tempo)
  name        TEXT NOT NULL,         -- step id do pipeline
  kind        TEXT NOT NULL
              CHECK (kind IN ('shell','agent','checks','approval')),  -- ✳ D16: +checks
  visit_no    INTEGER NOT NULL,      -- ✳ D3: entrada nº do PC neste step (2+ = pós-goto/fix-loop)
  attempt_no  INTEGER NOT NULL,      -- ✳ D3: tentativa do verify DENTRO da visita (1..max_attempts)
  config_id   TEXT REFERENCES agent_config(config_id),

  queued_at   TEXT,
  started_at  TEXT NOT NULL,
  ended_at    TEXT NOT NULL,

  status      TEXT NOT NULL
              CHECK (status IN ('pass','fail','error','timeout','cancelled','crashed')),
  fail_reason TEXT CHECK (fail_reason IN (   -- ✳ D5: só o mecânico
                'test-fail','type-error','lint-fail','build-fail',
                'expect-fail','human-rejected','infra')),
  fail_detail TEXT,

  tokens_in          INTEGER NOT NULL DEFAULT 0,
  tokens_out         INTEGER NOT NULL DEFAULT 0,
  tokens_cache_read  INTEGER NOT NULL DEFAULT 0,
  tokens_cache_write INTEGER NOT NULL DEFAULT 0,
  cost_usd           REAL,           -- ✳ D10: delta de snapshots cumulativos por Sessão
  cost_confidence    TEXT NOT NULL DEFAULT 'exact'
                     CHECK (cost_confidence IN ('exact','estimated')),
  price_version      TEXT,

  human_seconds REAL,                -- D12: só no step approval (merge)
  UNIQUE (task_id, seq)              -- ✳ D3: seq é único e ordena tudo
);

CREATE INDEX ix_step_task   ON step(task_id);
CREATE INDEX ix_step_change ON step(change_id);
CREATE INDEX ix_step_config ON step(config_id);
CREATE INDEX ix_step_name   ON step(name, status);
CREATE INDEX ix_task_change ON task(change_id);

-- ===================== ANOTAÇÕES HUMANAS (mutáveis) =====================

CREATE TABLE task_verdict (
  task_id  TEXT PRIMARY KEY REFERENCES task(task_id),
  verdict  TEXT NOT NULL CHECK (verdict IN ('pass','fail')),
  note     TEXT,
  by       TEXT NOT NULL,
  at       TEXT NOT NULL             -- upsert: muda by/at a cada mudança
);

CREATE TABLE bug (
  bug_id          TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES task(task_id),   -- 1:1 (D14); N:N futuro se comum
  found_in_change TEXT REFERENCES change(change_id),
  title           TEXT NOT NULL,
  detail          TEXT,
  severity        TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','fixed','wontfix','invalid')),
  reported_at     TEXT NOT NULL,
  resolved_at     TEXT
);
CREATE INDEX ix_bug_task ON bug(task_id);
```

### Views

As views da proposta ficam **quase intactas**; muda o essencial pela granularidade por-tentativa (D3)
e pelo desvio (D17). `v_step`/`v_step_repriced`/`v_task_bugs`/`v_change` da proposta seguem válidas
(apenas `v_step` ganha `visit_no`/`attempt_no` por vir de `step.*`). As duas que **mudam**:

```sql
-- ✳ v_task: granularidade por-tentativa. first_pass = a task nunca falhou um step antes de mergear.
--   attempts = quantas VISITAS o fix-loop deu ao step de agente mais revisitado (MAX visit_no).
CREATE VIEW v_task AS
SELECT t.task_id, t.change_id, t.task_number, t.name, t.status,
  t.size_files, t.size_added, t.size_removed,
  MAX(s.visit_no)                                  AS attempts,        -- ✳ voltas do fix-loop
  CASE WHEN SUM(CASE WHEN s.status IN ('fail','error','timeout') THEN 1 ELSE 0 END)=0
       THEN 1 ELSE 0 END                           AS first_pass,      -- ✳ zero falhas no caminho
  SUM(COALESCE(s.cost_usd,0))                      AS cost_usd,        -- ✳ soma real (D10, paga D-0008)
  MIN(s.cost_confidence)                           AS cost_confidence,
  SUM((julianday(s.ended_at)-julianday(s.started_at))*86400.0) AS work_s,
  (julianday(MAX(s.ended_at))-julianday(MIN(COALESCE(s.queued_at,s.started_at))))*86400.0 AS lead_s,
  SUM(COALESCE(s.human_seconds,0))                 AS human_s,
  v.verdict                                        AS human_verdict,
  COALESCE(b.bugs,0)                               AS bugs,
  COALESCE(b.bugs_open,0)                          AS bugs_open
FROM task t
JOIN step s              ON s.task_id = t.task_id
LEFT JOIN task_verdict v ON v.task_id = t.task_id
LEFT JOIN v_task_bugs b  ON b.task_id = t.task_id
GROUP BY t.task_id;

-- ✳ v_change_baseline: média E desvio-padrão populacional (SQLite não tem STDDEV — D17).
--   sd(x) = sqrt(avg(x*x) - avg(x)*avg(x)).
CREATE VIEW v_change_baseline AS
SELECT COUNT(*) AS n,
  AVG(cost_usd)      AS cost_usd,      "sqrt(avg(cost_usd*cost_usd)-avg(cost_usd)*avg(cost_usd))" AS cost_usd_sd,
  AVG(usd_per_line)  AS usd_per_line,  AVG(lead_s) AS lead_s, AVG(work_s) AS work_s, AVG(tasks) AS tasks,
  AVG(first_pass_rate) AS first_pass_rate, AVG(human_pass_rate) AS human_pass_rate,
  AVG(human_s) AS human_s, AVG(bugs) AS bugs
  -- (colunas _sd por métrica exibida; forma acima é ilustrativa — o plan detalha cada uma)
FROM v_change WHERE status='merged';
```

> `v_change`/`v_change_baseline` filtram `status='merged'` — e como `status` agora é nullable (D2), a
> change em andamento (`status NULL`) **naturalmente sai do baseline** e da média, mas ainda é
> selecionável como "esta change". Exatamente o comportamento desejado.

## Coleta — protocolo (inalterado da proposta, com as âncoras de código)

- **Insert-only para step/task; UPDATE só na dimensão `change`** (D2). A linha de `step` é inserida na
  **finalização** de cada Tentativa, com `started_at`/`ended_at` já conhecidos. Nenhum estado
  `running`, nenhum reaper. Qualquer terminação insere (`pass`/`fail`/`error`/`timeout`/`cancelled`/
  `crashed`); a única perda é `kill -9` do orquestrador, e aí a change inteira já se perdeu.
- **Ponto de instrumentação.** `step`: `src/steps/agent.ts` (loop interno, por Tentativa) + o site de
  `timedExecute` para os não-agente. `task`: fecho de `runTaskPipeline` (+ `size_*` do `reconcile-parent`).
  `change`: `INSERT OR IGNORE` no início do `runLoop`; UPDATE no gate de fim-de-change (re-parse do
  `todo.md` → 0 pendentes, o mesmo trigger de hoje) e via CLI (`abandoned`/`failed`).
- **Tokens:** os 4 contadores + `cost_usd` + `price_version`. Dialeto sem separação → grava o que houver
  e marca `cost_confidence='estimated'`.
- **Concorrência:** WAL no bootstrap (D8) + conexão-escritora única (D9).

## Bugs e veredito humano

- `loopy bug add --task C-0016/T-002 --severity high --title "..."` (+ `--detail`, `--found-in`).
  A FK é `bug.task_id → task.task_id`, sem restrição de change (bug de change anterior é o caso normal).
  Leituras de qualidade por bug filtram maturidade `≥30 dias` **na tela** (D18).
- `loopy verdict set --task C-0016/T-002 --pass|--fail [--note ...] [--by ...]` — upsert; registra
  `by`/`at`. Três estados na tela: `pass`, `fail`, não avaliada (`NULL`). `--by` default =
  `git config user.name` (fallback `$USER`).
- `loopy verdict clear --task <id>` — apaga a linha (volta ao 3º estado "não avaliada"); é o que o
  tri-estado da tela chama ao reverter (D20).
- `loopy change --abandoned|--failed [--change <id>]` — fecha a dimensão `change` fora do caminho
  `merged` (que fecha sozinho ao zerar o backlog). É o **único** UPDATE fora do `INSERT OR IGNORE`
  inicial da change (D2/D20).
- `human_seconds` sob `-y/--yes` = **NULL** (nenhum gate ocorreu), não 0 (D12).

## Tela — 4ª aba "Insights" (proposta §5 + refinos D22/D23)

Cabeçalho de três colunas (esta change · média±desvio das merged · change comparada com Δ%), toggle
absoluto↔normalizado por `churn`, marca visual para `cost_confidence='estimated'`, contador de
`unrated`. Lista de tasks (uma linha por task, com o controle tri-estado de veredito) que expande nos
passos ao selecionar. Vive na `main` como 4º segmento do `ViewSwitcher` (`kanban`/`deps`/`config`/
**`insights`**), montada como as outras (sempre presente, `display:none`), lendo o `.db` por comando
Rust `rusqlite` — funciona **em idle** (revisão fria) e durante o run.

**Refinos do 2º refine:** a 3ª coluna vem por default com a **change merged anterior** (por
`created_at`), trocável por dropdown (D22). O toggle absoluto↔normalizado nasce em **absoluto** (o
"quanto custou" cru; normalizado por `churn` = `size_added+size_removed` é o toggle — ressalva:
mid-run o absoluto subconta a change aberta). E há **badge + filtro de defeito escapado** (D23):
tasks `status='merged'` + `human_verdict='fail'`, o sinal do Objective §Q3. A escrita da tela
(veredito, `verdict clear`, `bug add`) invoca o CLI como subprocesso (D6/D20); a leitura é
SELECT-only pelo Rust (D19).

## Tech Stack

- Motor: TypeScript/ESM, **`node:sqlite` (Node ≥22.13) + `bun:sqlite` (sidecar)** atrás de um adapter
  guardado por runtime; `node:crypto` para os hashes. Zero dependências npm novas.
- Build: `tsup` precisa de `external: ["bun:sqlite"]` (esbuild não resolve o módulo Bun); `bun build
  --compile` tolera o `import("node:sqlite")` morto sem tree-shaking.
- GUI: `apps/menubar/src-tauri` ganha **`rusqlite`** (Cargo) para a leitura SELECT-only; nova aba React.
- `engines.node`: `>=20` → **`>=22.13`**.

## Commands

```
Typecheck (raiz + menubar):  npm run typecheck
Lint:                        npm run lint
Test (motor):                npm test
Test (app):                  npm test -w apps/menubar
Build (motor):               npm run build
Sidecar + app (dev):         npm run dev -w apps/menubar
Empacotar .app:              npm run menubar
CLI novo (bug):              npm run dev -- bug add --task <id> --severity <s> --title "<t>"
CLI novo (verdict):          npm run dev -- verdict set --task <id> --pass|--fail
CLI novo (verdict clear):    npm run dev -- verdict clear --task <id>
CLI novo (change status):    npm run dev -- change --abandoned|--failed [--change <id>]
```

## Project Structure

```
src/telemetry/            → NOVO. O subsistema SQLite (substitui src/metrics/)
  db.ts                     → adapter node:sqlite|bun:sqlite (runtime-guarded), abre WAL 1x, conexão única
  schema.sql                → DDL + views (fonte única; aplicada idempotente no bootstrap)
  schema.ts                 → migração/bootstrap (user_version), config_id/prompt_version (sha256)
  write.ts                  → inserts de step/task, upsert de change (o único escritor de fatos)
  annotate.ts               → upsert de task_verdict, insert de bug (usado pela CLI)
  query.ts                  → SELECTs tipados internos (reuso por annotate); NÃO é superfície de
                              leitura CLI (D19) — a GUI lê pelo Rust. Sem `loopy report`.
src/steps/agent.ts        → instrumenta o loop interno (uma linha por Tentativa)  [editar]
src/loop/orchestrator.ts  → INSERT OR IGNORE da change; grava task; delta de custo por sessão  [editar]
src/index.ts              → subcomandos `bug add` / `verdict set`; fecho da change  [editar]
src/metrics/              → REMOVIDO (folds/store/report/change-report/format)
apps/menubar/src-tauri/src/telemetry.rs  → NOVO: comandos rusqlite SELECT-only (read_*_telemetry)
apps/menubar/src/insights/               → NOVO: a 4ª aba (header 3-col, lista de tasks, expansão)
tests/telemetry/          → NOVO: schema, write insert-only, config_id, delta de custo, views
```

## Code Style

Segue o vigente: funções puras onde dá (AD-6), erros como valores nas fronteiras (AD-5), sem
`node:fs`/`node:sqlite` fora do módulo dedicado. O adapter isola o driver:

```ts
// src/telemetry/db.ts — a única linha que conhece o runtime
export async function openDb(path: string): Promise<TelemetryDb> {
  const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
  const raw = isBun
    ? new (await import("bun:sqlite")).Database(path)         // tsup: external
    : new (await import("node:sqlite")).DatabaseSync(path);   // Node ≥22.13
  // WAL 1x no bootstrap (D8) — busy_timeout NÃO protege este pragma
  raw.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
  return wrap(raw); // shape comum: prepare/run/all — as duas APIs convergem
}
```

## Testing Strategy

- **vitest** (motor). Roda no Node ≥22.13, então `node:sqlite` real num arquivo temporário — sem mock
  de DB. Cobrir: bootstrap idempotente; **insert-only** (nenhum UPDATE em step/task — assertar por
  contagem/trigger de teste); `config_id` estável para config igual e distinto para config diferente;
  **delta de custo** (snapshots cumulativos → custo por-tentativa correto, inclusive através de
  `clear_context`); as views (`v_task.first_pass`/`attempts`, `v_change` SUM paga o D-0008,
  `v_change_baseline` exclui a change aberta). Fixture: um `.db` semeado com uma change de ≥2 tasks e
  um fix-loop (visit_no≥2). **2º refine:** `seq` monotônico através de **resume** (re-visita/re-run
  não colide no `UNIQUE(task_id, seq)` — deriva `MAX(seq)+1`, D25); **`resolved_json` não vaza env**
  (serializa os templates `${env.KEY}`, jamais valores de `process.env`, D24); `verdict clear` remove
  a linha (volta ao tri-estado `NULL`, D20).
- **`apps/menubar`** (vitest do app): a aba `insights` é projeção pura de linhas do `.db` → não monta
  Tauri; testa o mapeamento (delta%, absoluto↔normalizado, tri-estado do veredito, marca de estimated).
- A instrumentação **nunca falha um step** (best-effort, como hoje): captura ausente → NULL, jamais
  exceção. `RunLoopResult` byte-idêntico com e sem `metrics:` (AD-1).

## Boundaries

- **Always:** rodar `npm run typecheck` (raiz+app), `lint` e ambos os `test` antes de qualquer commit;
  WAL no bootstrap; toda escrita no `.db` pelo motor/CLI; `.db/` gitignored; step/task insert-only.
- **Ask first:** mudar a shape de `StoreEvent`/frames/subpath exports (quebra o app em build);
  transformar `bug` em N:N; tornar a coleta always-on; qualquer UPDATE fora da dimensão `change`.
- **Never:** hardcodar comportamento de loop no motor (AD-1); emitir `UPDATE` em `step`/`task`;
  fazer a coleta lançar e derrubar um step; expor SQL cru ao webview (a GUI lê por comando Rust);
  importar `node:sqlite`/`bun:sqlite`/`node:fs` fora do módulo `src/telemetry/`.

## Success Criteria

Rodar uma change (com `metrics:` ligado) e, na aba Insights:

1. Ver **custo e tentativas por task** — o custo por-tentativa aparece ao expandir os passos, e a soma
   da change bate com o real (D-0008 pago).
2. **Marcar `pass`/`fail`** em cada task e **reverter** (tri-estado; upsert persiste `by`/`at`).
3. **Comparar** a change contra a média±desvio e contra outra change escolhida, em **absoluto e
   normalizado** por churn, com Δ%.
4. `loopy bug add --task <de change anterior>` e ver o bug **aparecer na linha daquela task**.

E, transversal: um run real do próprio loopy popula o `.db` sem alterar o `RunLoopResult`; um run
**sem** `metrics:` não cria `.db` (AD-1).

## Open Questions — resolvidas no 2º refine

- **OQ1 — `resolved_json` (vazamento de secret): RESOLVIDA (D24).** Serializar o `AgentDef` (forma
  declarada, via o caminho do `serialize.ts`) grava os templates `${env.KEY}`, não os valores — não
  vaza. **Nunca** serializar `resolvedEnv`/`PerAgentOptions.env`.
- **OQ2 — `seq` sob paralelismo: RESOLVIDA (D25).** `seq` é local a `runTaskPipeline` (1×/task);
  derivado no insert por `MAX(seq)+1` (race-free pela conexão única), sobrevive a resume.
- **OQ3 — retrocompat de leitura: CONFIRMADA.** A aba degrada para "sem telemetria" quando o `.db`
  da change não existe (C-0001..C-0016) — sem backfill; o histórico começa na C-0017.
- **OQ4 — ADR: CONFIRMADA.** O mais recente é o ADR-0010; esta change emite o **ADR-0011**
  (persistência SQLite + granularidade por-tentativa, estendendo a ADR-0003) e fecha o **D-0008**.
```
