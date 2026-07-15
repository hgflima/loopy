/**
 * Lista de tasks da aba Insights — projeção pura de `v_task` → view-model (AD-6).
 *
 * Traduz as linhas cruas (`snake_case`, `human_verdict` nullable) para o modelo
 * que a `InsightsPane` (T-011) renderiza: o **tri-estado** do veredito, a marca
 * **estimated** do custo, o **churn** por task e o **defeito escapado** (D23) —
 * a task que mergeou mas o humano reprovou.
 */
import type { TaskRow, TaskStatus } from "./rows";

/** Tri-estado do veredito humano na tela: os dois valores + "não avaliada". */
export type Verdict = "pass" | "fail" | "unrated";

/** Uma task projetada para a lista da aba. */
export interface TaskView {
  readonly taskId: string;
  readonly taskNumber: string;
  readonly name: string;
  readonly status: TaskStatus;
  /** Tri-estado (`unrated` = sem linha em `task_verdict`). */
  readonly verdict: Verdict;
  readonly costUsd: number | null;
  /** `cost_confidence='estimated'` — o custo é aproximado (dialeto sem separação). */
  readonly estimated: boolean;
  /** `MAX(visit_no)`: voltas do fix-loop. */
  readonly attempts: number | null;
  /** A task nunca falhou um step antes de mergear. */
  readonly firstPass: boolean;
  /** `size_added + size_removed` (`null` = desconhecido). */
  readonly churn: number | null;
  readonly workS: number | null;
  readonly leadS: number | null;
  readonly humanS: number | null;
  readonly bugs: number;
  readonly bugsOpen: number;
  /** Defeito escapado (D23): mergeou mas o humano reprovou. */
  readonly escapedDefect: boolean;
}

/**
 * Tri-estado do veredito. Ausência de anotação (`null`) é o terceiro estado
 * `unrated` — a task existe mas ninguém a avaliou (o `verdict clear` da CLI volta
 * a este estado apagando a linha, D20).
 */
export function verdictOf(row: Pick<TaskRow, "human_verdict">): Verdict {
  return row.human_verdict ?? "unrated";
}

/**
 * Churn de uma task = `size_added + size_removed`. Um lado ausente conta como
 * zero; **ambos** ausentes ⇒ `null` (churn desconhecido, não zero — uma task
 * `failed` não tem numstat). É o divisor do toggle normalizado do cabeçalho.
 */
export function taskChurn(row: Pick<TaskRow, "size_added" | "size_removed">): number | null {
  const { size_added, size_removed } = row;
  if (size_added == null && size_removed == null) return null;
  return (size_added ?? 0) + (size_removed ?? 0);
}

/**
 * Defeito escapado (D23): a task **mergeou** e o humano a marcou **`fail`** — o
 * review do agente deixou passar. É o sinal da 3ª pergunta-título do Objective.
 * Uma task `failed` (nunca chegou à main) não conta, nem uma sem veredito.
 */
export function isEscapedDefect(row: Pick<TaskRow, "status" | "human_verdict">): boolean {
  return row.status === "merged" && row.human_verdict === "fail";
}

/** Projeta uma linha de `v_task` para o view-model. */
export function toTaskView(row: TaskRow): TaskView {
  return {
    taskId: row.task_id,
    taskNumber: row.task_number,
    name: row.name,
    status: row.status,
    verdict: verdictOf(row),
    costUsd: row.cost_usd,
    estimated: row.cost_confidence === "estimated",
    attempts: row.attempts,
    firstPass: row.first_pass === 1,
    churn: taskChurn(row),
    workS: row.work_s,
    leadS: row.lead_s,
    humanS: row.human_s,
    bugs: row.bugs ?? 0,
    bugsOpen: row.bugs_open ?? 0,
    escapedDefect: isEscapedDefect(row),
  };
}

/** Projeta todas as linhas, preservando a ordem. */
export function buildTaskViews(rows: readonly TaskRow[]): TaskView[] {
  return rows.map(toTaskView);
}

/** Quantas tasks ainda não têm veredito — o contador `unrated` do cabeçalho. */
export function countUnrated(views: readonly Pick<TaskView, "verdict">[]): number {
  return views.reduce((n, v) => (v.verdict === "unrated" ? n + 1 : n), 0);
}

/** Opções do filtro de defeito escapado. */
export interface EscapedFilter {
  /** Bônus (D23): exigir também um bug **aberto** (`bugs_open > 0`). */
  readonly requireOpenBug?: boolean;
}

/**
 * Filtra a lista para só os defeitos escapados (D23). Com `requireOpenBug`,
 * restringe às tasks que ainda têm bug aberto — o subconjunto mais grave.
 */
export function filterEscapedDefects(
  views: readonly TaskView[],
  opts: EscapedFilter = {},
): TaskView[] {
  return views.filter((v) => v.escapedDefect && (!opts.requireOpenBug || v.bugsOpen > 0));
}
