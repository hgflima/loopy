/**
 * Barril público da aba Insights — o view-model puro (T-010) que a `InsightsPane`
 * e o `useInsights` (T-011) consomem. Só reexporta as camadas puras; nada aqui
 * importa Tauri ou React.
 */
export type {
  ChangeRow,
  BaselineRow,
  TaskRow,
  StepRow,
  ChangeStatus,
  TaskStatus,
  CostConfidence,
  HumanVerdict,
  StepKind,
  StepStatus,
  FailReason,
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
export { toStepView, buildStepViews, type StepView } from "./steps";
export {
  pickDefaultThisChange,
  pickDefaultCompared,
  findChange,
} from "./selection";
export { buildInsights, type InsightsInput, type InsightsModel } from "./model";
