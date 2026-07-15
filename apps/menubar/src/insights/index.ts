/**
 * Barril público da aba Insights — o view-model puro (T-010) que a `InsightsPane`
 * e o `useInsights` (T-011) consomem. Só reexporta as camadas puras; nada aqui
 * importa Tauri ou React.
 */
export type {
  ChangeRow,
  BaselineRow,
  TaskRow,
  ChangeStatus,
  TaskStatus,
  CostConfidence,
  HumanVerdict,
} from "./rows";
export {
  METRICS,
  deltaPct,
  normalizeByChurn,
  buildHeaderRows,
  type Metric,
  type MetricKey,
  type MetricFormat,
  type MetricDirection,
  type MetricMode,
  type HeaderRow,
} from "./metrics";
export {
  verdictOf,
  taskChurn,
  isEscapedDefect,
  toTaskView,
  buildTaskViews,
  countUnrated,
  filterEscapedDefects,
  type Verdict,
  type TaskView,
  type EscapedFilter,
} from "./tasks";
export { buildInsights, type InsightsInput, type InsightsModel } from "./model";
