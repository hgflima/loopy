-- Telemetry schema — single source of the DDL, applied idempotently at bootstrap.
--
-- Loaded by `schema.ts` (readFileSync on Node, embedded text-import on the Bun
-- sidecar) and executed once per `.db`, guarded by `PRAGMA user_version`. Every
-- object uses `IF NOT EXISTS` so a partial or repeated apply is a no-op.
--
-- Connection pragmas (journal_mode=WAL, busy_timeout, foreign_keys) are NOT here:
-- they live in `db.ts::openDb` and are set once at bootstrap (D8), because
-- busy_timeout does not protect `journal_mode=WAL` under concurrent creation.
--
-- Invariants: `step`/`task` are insert-only facts (never UPDATE); `change` is the
-- only mutable dimension (D2); human annotations (`task_verdict`, `bug`) are
-- mutable. See spec.md `## DDL` for the full rationale (D1–D27).

-- ===================== DIMENSÕES =====================

CREATE TABLE IF NOT EXISTS agent_config (
  config_id      TEXT PRIMARY KEY,   -- sha256(preset|model|mode|effort|prompt_version)  (D11)
  preset         TEXT NOT NULL,
  model          TEXT NOT NULL,
  mode           TEXT NOT NULL,
  effort         TEXT,               -- nullable: effort é best-effort por-agente (pode ser no-op)
  prompt_version TEXT NOT NULL,      -- sha256 do TEMPLATE do prompt (pré-interpolação)  (D11)
  resolved_json  TEXT NOT NULL,      -- AgentDef declarado (templates ${env.KEY}, nunca resolvidos)  (D24)
  first_seen_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price (   -- USD por 1M tokens — seed manual, fora de escopo (D13)
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

-- change é DIMENSÃO mutável (D2), não fato terminal. INSERT OR IGNORE no início
-- do run; UPDATE único ao fechar (ended_at/status). A única tabela com UPDATE.
CREATE TABLE IF NOT EXISTS change (
  change_id        TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  repo             TEXT NOT NULL,
  base_sha         TEXT,
  pipeline_version TEXT NOT NULL,    -- pipelineFingerprint()  (D11)
  created_at       TEXT NOT NULL,
  ended_at         TEXT,             -- nullable: NULL enquanto a change está aberta
  status           TEXT              -- nullable: NULL = em andamento
                   CHECK (status IS NULL OR status IN ('merged','abandoned','failed'))
);

-- task e step são FATOS insert-only (nunca UPDATE).
CREATE TABLE IF NOT EXISTS task (
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
CREATE TABLE IF NOT EXISTS step (
  step_id     TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL,         -- sem FK (proposta §1)
  change_id   TEXT NOT NULL,
  seq         INTEGER NOT NULL,      -- D3: ordem global de execução na task (a linha do tempo)
  name        TEXT NOT NULL,         -- step id do pipeline
  kind        TEXT NOT NULL
              CHECK (kind IN ('shell','agent','checks','approval')),  -- D16: +checks
  visit_no    INTEGER NOT NULL,      -- D3: entrada nº do PC neste step (2+ = pós-goto/fix-loop)
  attempt_no  INTEGER NOT NULL,      -- D3: tentativa do verify DENTRO da visita (1..max_attempts)
  config_id   TEXT REFERENCES agent_config(config_id),

  queued_at   TEXT,
  started_at  TEXT NOT NULL,
  ended_at    TEXT NOT NULL,

  status      TEXT NOT NULL
              CHECK (status IN ('pass','fail','error','timeout','cancelled','crashed')),
  fail_reason TEXT CHECK (fail_reason IN (   -- D5: só o mecânico
                'test-fail','type-error','lint-fail','build-fail',
                'expect-fail','human-rejected','infra')),
  fail_detail TEXT,

  tokens_in          INTEGER NOT NULL DEFAULT 0,
  tokens_out         INTEGER NOT NULL DEFAULT 0,
  tokens_cache_read  INTEGER NOT NULL DEFAULT 0,
  tokens_cache_write INTEGER NOT NULL DEFAULT 0,
  cost_usd           REAL,           -- D10: delta de snapshots cumulativos por Sessão
  cost_confidence    TEXT NOT NULL DEFAULT 'exact'
                     CHECK (cost_confidence IN ('exact','estimated')),
  price_version      TEXT,

  human_seconds REAL,                -- D12: só no step approval (merge)
  UNIQUE (task_id, seq)              -- D3: seq é único e ordena tudo
);

CREATE INDEX IF NOT EXISTS ix_step_task   ON step(task_id);
CREATE INDEX IF NOT EXISTS ix_step_change ON step(change_id);
CREATE INDEX IF NOT EXISTS ix_step_config ON step(config_id);
CREATE INDEX IF NOT EXISTS ix_step_name   ON step(name, status);
CREATE INDEX IF NOT EXISTS ix_task_change ON task(change_id);

-- ===================== ANOTAÇÕES HUMANAS (mutáveis) =====================

CREATE TABLE IF NOT EXISTS task_verdict (
  task_id  TEXT PRIMARY KEY REFERENCES task(task_id),
  verdict  TEXT NOT NULL CHECK (verdict IN ('pass','fail')),
  note     TEXT,
  by       TEXT NOT NULL,
  at       TEXT NOT NULL             -- upsert: muda by/at a cada mudança
);

CREATE TABLE IF NOT EXISTS bug (
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
CREATE INDEX IF NOT EXISTS ix_bug_task ON bug(task_id);

-- ===================== VIEWS =====================
-- Criadas em ordem de dependência: v_task_bugs → v_task → v_change →
-- v_change_baseline; v_step e v_step_repriced são independentes.

-- v_step: projeção por-tentativa (D3), com preset/model/mode/effort do agent_config
-- e a duração de trabalho em segundos. Steps não-agente têm config_id NULL.
CREATE VIEW IF NOT EXISTS v_step AS
SELECT
  s.step_id, s.task_id, s.change_id, s.seq, s.name, s.kind,
  s.visit_no, s.attempt_no,
  s.status, s.fail_reason, s.fail_detail,
  s.config_id, ac.preset, ac.model, ac.mode, ac.effort,
  s.tokens_in, s.tokens_out, s.tokens_cache_read, s.tokens_cache_write,
  s.cost_usd, s.cost_confidence, s.price_version,
  s.human_seconds,
  (julianday(s.ended_at) - julianday(s.started_at)) * 86400.0 AS work_s,
  s.queued_at, s.started_at, s.ended_at
FROM step s
LEFT JOIN agent_config ac ON ac.config_id = s.config_id;

-- v_task_bugs: contagem de bugs (total e abertos) por task.
CREATE VIEW IF NOT EXISTS v_task_bugs AS
SELECT
  task_id,
  COUNT(*)                                        AS bugs,
  SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS bugs_open
FROM bug
GROUP BY task_id;

-- v_task: granularidade por-tentativa. first_pass = a task nunca falhou um step
-- antes de mergear. attempts = quantas VISITAS o fix-loop deu ao step mais
-- revisitado (MAX visit_no). cost_usd é a soma real (D10, paga o D-0008).
CREATE VIEW IF NOT EXISTS v_task AS
SELECT
  t.task_id, t.change_id, t.task_number, t.name, t.status,
  t.size_files, t.size_added, t.size_removed,
  MAX(s.visit_no)                                  AS attempts,        -- voltas do fix-loop
  CASE WHEN SUM(CASE WHEN s.status IN ('fail','error','timeout') THEN 1 ELSE 0 END) = 0
       THEN 1 ELSE 0 END                           AS first_pass,      -- zero falhas no caminho
  SUM(COALESCE(s.cost_usd, 0))                     AS cost_usd,        -- soma real (D10, paga D-0008)
  MIN(s.cost_confidence)                           AS cost_confidence,
  SUM((julianday(s.ended_at) - julianday(s.started_at)) * 86400.0)                    AS work_s,
  (julianday(MAX(s.ended_at)) - julianday(MIN(COALESCE(s.queued_at, s.started_at)))) * 86400.0 AS lead_s,
  SUM(COALESCE(s.human_seconds, 0))                AS human_s,
  v.verdict                                        AS human_verdict,
  COALESCE(b.bugs, 0)                              AS bugs,
  COALESCE(b.bugs_open, 0)                         AS bugs_open
FROM task t
JOIN step s              ON s.task_id = t.task_id
LEFT JOIN task_verdict v ON v.task_id = t.task_id
LEFT JOIN v_task_bugs b  ON b.task_id = t.task_id
GROUP BY t.task_id;

-- v_change: agregação por change sobre v_task. churn = size_added+size_removed
-- somado; usd_per_line = cost_usd / churn. As taxas são médias sobre as tasks.
CREATE VIEW IF NOT EXISTS v_change AS
SELECT
  c.change_id, c.name, c.repo, c.base_sha, c.pipeline_version,
  c.created_at, c.ended_at, c.status,
  COUNT(vt.task_id)                                AS tasks,
  SUM(vt.cost_usd)                                 AS cost_usd,        -- SUM (paga D-0008)
  MIN(vt.cost_confidence)                          AS cost_confidence,
  SUM(vt.work_s)                                   AS work_s,
  SUM(vt.lead_s)                                   AS lead_s,
  SUM(vt.human_s)                                  AS human_s,
  SUM(COALESCE(vt.size_added, 0) + COALESCE(vt.size_removed, 0)) AS churn,
  CASE WHEN SUM(COALESCE(vt.size_added, 0) + COALESCE(vt.size_removed, 0)) > 0
       THEN SUM(vt.cost_usd) / SUM(COALESCE(vt.size_added, 0) + COALESCE(vt.size_removed, 0))
       END                                         AS usd_per_line,
  AVG(vt.first_pass)                               AS first_pass_rate,
  AVG(CASE WHEN vt.human_verdict = 'pass' THEN 1.0
           WHEN vt.human_verdict = 'fail' THEN 0.0 END) AS human_pass_rate,
  SUM(vt.bugs)                                     AS bugs,
  SUM(vt.bugs_open)                                AS bugs_open
FROM change c
LEFT JOIN v_task vt ON vt.change_id = c.change_id
GROUP BY c.change_id;

-- v_change_baseline: média E desvio-padrão populacional sobre as changes MERGED.
-- SQLite não tem STDDEV (D17), então sd(x) = sqrt(avg(x*x) - avg(x)*avg(x)), com
-- max(0, ...) por segurança contra erro de arredondamento. A change em andamento
-- (status NULL) sai naturalmente do baseline.
CREATE VIEW IF NOT EXISTS v_change_baseline AS
SELECT
  COUNT(*) AS n,
  AVG(cost_usd)     AS cost_usd,
  sqrt(max(0.0, avg(cost_usd * cost_usd) - avg(cost_usd) * avg(cost_usd)))             AS cost_usd_sd,
  AVG(usd_per_line) AS usd_per_line,
  sqrt(max(0.0, avg(usd_per_line * usd_per_line) - avg(usd_per_line) * avg(usd_per_line))) AS usd_per_line_sd,
  AVG(lead_s)       AS lead_s,
  sqrt(max(0.0, avg(lead_s * lead_s) - avg(lead_s) * avg(lead_s)))                     AS lead_s_sd,
  AVG(work_s)       AS work_s,
  sqrt(max(0.0, avg(work_s * work_s) - avg(work_s) * avg(work_s)))                     AS work_s_sd,
  AVG(human_s)      AS human_s,
  sqrt(max(0.0, avg(human_s * human_s) - avg(human_s) * avg(human_s)))                 AS human_s_sd,
  AVG(tasks)        AS tasks,
  sqrt(max(0.0, avg(tasks * tasks) - avg(tasks) * avg(tasks)))                         AS tasks_sd,
  AVG(first_pass_rate) AS first_pass_rate,
  AVG(human_pass_rate) AS human_pass_rate,
  AVG(bugs)         AS bugs,
  sqrt(max(0.0, avg(bugs * bugs) - avg(bugs) * avg(bugs)))                             AS bugs_sd
FROM v_change
WHERE status = 'merged';

-- v_step_repriced: reprecificação histórica (D13, capability latente). Recomputa o
-- custo a partir dos tokens × a tabela `price` (seed manual). Sem preço para o
-- modelo, cost_usd_repriced é NULL (LEFT JOIN). O modelo vem do agent_config.
CREATE VIEW IF NOT EXISTS v_step_repriced AS
SELECT
  s.step_id, s.task_id, s.change_id, s.name, ac.model,
  s.tokens_in, s.tokens_out, s.tokens_cache_read, s.tokens_cache_write,
  s.cost_usd AS cost_usd_original,
  p.price_version,
  (s.tokens_in          * p.usd_per_mtok_in
 + s.tokens_out         * p.usd_per_mtok_out
 + s.tokens_cache_read  * p.usd_per_mtok_cache_read
 + s.tokens_cache_write * p.usd_per_mtok_cache_write) / 1000000.0 AS cost_usd_repriced
FROM step s
LEFT JOIN agent_config ac ON ac.config_id = s.config_id
LEFT JOIN price p         ON p.model = ac.model;
