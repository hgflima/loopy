/**
 * O view-model completo da aba Insights — o agregado que a `InsightsPane`
 * (T-011) consome, montado das linhas cruas das views por um passe puro (AD-6).
 *
 * Junta o cabeçalho de três colunas (`metrics.ts`) e a lista de tasks
 * (`tasks.ts`) e deriva os contadores da tela (`unrated`, defeitos escapados) e
 * a marca global de custo estimado. Nada aqui toca Tauri ou o DOM — é projeção
 * pura de dados, testável isolado.
 */
import type { ChangeRow, BaselineRow, TaskRow } from "./rows";
import { buildHeaderRows, type HeaderRow, type MetricMode } from "./metrics";
import { buildTaskViews, countUnrated, filterEscapedDefects, type TaskView } from "./tasks";

/** As linhas cruas lidas do `.db` (via os comandos Rust SELECT-only, T-009). */
export interface InsightsInput {
  /** `v_change` da change em foco (coluna 1). */
  readonly thisChange: ChangeRow | null;
  /** `v_change` da change comparada (coluna 3; default = merged anterior, D22). */
  readonly comparedChange: ChangeRow | null;
  /** `v_change_baseline` — média±desvio das merged (coluna 2). */
  readonly baseline: BaselineRow | null;
  /** `v_task` das tasks da change em foco. */
  readonly tasks: readonly TaskRow[];
}

/** O view-model pronto para render. */
export interface InsightsModel {
  readonly header: HeaderRow[];
  readonly tasks: TaskView[];
  /** Tasks sem veredito humano — o contador do cabeçalho. */
  readonly unrated: number;
  /** Quantos defeitos escapados (D23) — alimenta o badge. */
  readonly escapedDefects: number;
  /** Algum custo é `estimated` (change ou qualquer task) — a marca visual. */
  readonly hasEstimated: boolean;
}

/**
 * Monta o `InsightsModel` a partir das linhas cruas e do toggle `mode`.
 *
 * Tolera qualquer fonte `null` (idle, `.db` ausente, change sem tasks): o
 * cabeçalho ainda existe (colunas zeradas) e a lista fica vazia — a degradação
 * graciosa que a aba exige (OQ3).
 */
export function buildInsights(input: InsightsInput, mode: MetricMode): InsightsModel {
  const header = buildHeaderRows(input.thisChange, input.baseline, input.comparedChange, mode);
  const tasks = buildTaskViews(input.tasks);
  return {
    header,
    tasks,
    unrated: countUnrated(tasks),
    escapedDefects: filterEscapedDefects(tasks).length,
    hasEstimated:
      input.thisChange?.cost_confidence === "estimated" || tasks.some((t) => t.estimated),
  };
}
