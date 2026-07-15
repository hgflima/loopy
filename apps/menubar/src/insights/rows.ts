/**
 * Contrato de leitura da aba Insights — as **linhas cruas das views SQL** (D19).
 *
 * A GUI lê o `.db` de telemetria por comandos Rust `rusqlite` SELECT-only nas
 * views (`v_change`, `v_change_baseline`, `v_task`) — ver `telemetry.rs` (T-009).
 * O `rusqlite`/serde serializa com os nomes das colunas **como estão** (a
 * convenção deste app: payloads do Rust chegam em `snake_case`, igual ao
 * `ProjectFiles.loopy_yml`), então estes tipos espelham as colunas das views à
 * letra. A tradução para o view-model camelCase é o trabalho de `tasks.ts`/
 * `metrics.ts` — "mapeamento de linhas das views → view-model".
 *
 * Toda métrica agregada é `number | null`: uma change sem tasks, um custo
 * best-effort ausente ou um desvio indefinido (n<2) chegam como `NULL` do SQL.
 * O view-model nunca inventa zero no lugar de "desconhecido".
 */

/** Status terminal de uma change (D2). `null` = em andamento (fora do baseline). */
export type ChangeStatus = "merged" | "abandoned" | "failed";

/** Status terminal de uma task (o motor só grava `merged`/`failed`). */
export type TaskStatus = "merged" | "abandoned" | "failed";

/** Confiança do custo: `estimated` quando o dialeto não separou os contadores. */
export type CostConfidence = "exact" | "estimated";

/** Veredito humano persistido (`task_verdict.verdict`); ausência = não avaliada. */
export type HumanVerdict = "pass" | "fail";

/**
 * Uma linha de `v_change` — a agregação de uma change sobre suas tasks.
 *
 * É a fonte das colunas "esta change" e "change comparada" do cabeçalho.
 * `churn` = `SUM(size_added+size_removed)` é o divisor do toggle normalizado;
 * `usd_per_line` é o custo-por-linha já pré-computado pela view.
 */
export interface ChangeRow {
  change_id: string;
  name: string;
  repo: string;
  base_sha: string | null;
  pipeline_version: string;
  created_at: string;
  ended_at: string | null;
  status: ChangeStatus | null;
  tasks: number | null;
  cost_usd: number | null;
  cost_confidence: CostConfidence | null;
  work_s: number | null;
  lead_s: number | null;
  human_s: number | null;
  churn: number | null;
  usd_per_line: number | null;
  first_pass_rate: number | null;
  human_pass_rate: number | null;
  bugs: number | null;
  bugs_open: number | null;
}

/**
 * A linha única de `v_change_baseline` — média **e** desvio-padrão populacional
 * sobre as changes `merged` (D17). Alimenta a coluna do meio (média±desvio).
 *
 * Só o custo tem desvio na forma normalizada (`usd_per_line_sd`): é a única
 * métrica com coluna por-linha estatística na view. As taxas (`first_pass_rate`,
 * `human_pass_rate`) não têm `_sd` — já são proporções.
 */
export interface BaselineRow {
  n: number;
  cost_usd: number | null;
  cost_usd_sd: number | null;
  usd_per_line: number | null;
  usd_per_line_sd: number | null;
  lead_s: number | null;
  lead_s_sd: number | null;
  work_s: number | null;
  work_s_sd: number | null;
  human_s: number | null;
  human_s_sd: number | null;
  tasks: number | null;
  tasks_sd: number | null;
  first_pass_rate: number | null;
  human_pass_rate: number | null;
  bugs: number | null;
  bugs_sd: number | null;
}

/**
 * Uma linha de `v_task` — a agregação por-tentativa de uma task (D3).
 *
 * `first_pass` é `0`/`1` (a task nunca falhou um step antes de mergear);
 * `attempts` é o `MAX(visit_no)` (voltas do fix-loop); `human_verdict` é o
 * tri-estado cru (`null` = não avaliada).
 */
export interface TaskRow {
  task_id: string;
  change_id: string;
  task_number: string;
  name: string;
  status: TaskStatus;
  size_files: number | null;
  size_added: number | null;
  size_removed: number | null;
  attempts: number | null;
  first_pass: number;
  cost_usd: number | null;
  cost_confidence: CostConfidence | null;
  work_s: number | null;
  lead_s: number | null;
  human_s: number | null;
  human_verdict: HumanVerdict | null;
  bugs: number | null;
  bugs_open: number | null;
}
