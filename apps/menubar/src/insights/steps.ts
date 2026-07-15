/**
 * Passos de uma task na aba Insights — projeção pura de `v_step` → view-model.
 *
 * É a linha do tempo que uma task **expande** ao ser selecionada (SC1): uma linha
 * por **Tentativa** (D3), com o custo por-tentativa que a soma da task/change
 * agrega. Puro e testável isolado (AD-6); nada aqui toca Tauri ou o DOM.
 */
import type { StepRow, StepKind, StepStatus, FailReason } from "./rows";

/** Uma Tentativa projetada para a linha expandida da task. */
export interface StepView {
  readonly stepId: string;
  /** Step id do pipeline (o nome declarado). */
  readonly name: string;
  readonly kind: StepKind;
  /** Ordem global na task (a linha do tempo). */
  readonly seq: number;
  /** Entrada nº do PC neste step (≥2 = pós-goto/fix-loop). */
  readonly visitNo: number;
  /** Tentativa do verify dentro da visita (1..max_attempts). */
  readonly attemptNo: number;
  readonly status: StepStatus;
  /** `true` só quando `status === 'pass'` — a tela colore por isto. */
  readonly ok: boolean;
  readonly failReason: FailReason | null;
  readonly failDetail: string | null;
  /** Dialeto resolvido do agente (`null` em step não-agente). */
  readonly model: string | null;
  readonly mode: string | null;
  readonly effort: string | null;
  readonly costUsd: number | null;
  /** `cost_confidence='estimated'` — custo aproximado (dialeto sem separação). */
  readonly estimated: boolean;
  /** Soma dos 4 contadores de token (`0` quando todos ausentes). */
  readonly tokensTotal: number;
  /** Duração de trabalho em segundos (`ended_at - started_at`). */
  readonly workS: number | null;
  /** Espera humana no gate (só em step approval; `null` sob `--yes`). */
  readonly humanS: number | null;
}

/** Soma os 4 contadores de token, tratando ausência como zero. */
function tokensTotalOf(row: StepRow): number {
  return (
    (row.tokens_in ?? 0) +
    (row.tokens_out ?? 0) +
    (row.tokens_cache_read ?? 0) +
    (row.tokens_cache_write ?? 0)
  );
}

/** Projeta uma linha de `v_step` para o view-model. */
export function toStepView(row: StepRow): StepView {
  return {
    stepId: row.step_id,
    name: row.name,
    kind: row.kind,
    seq: row.seq,
    visitNo: row.visit_no,
    attemptNo: row.attempt_no,
    status: row.status,
    ok: row.status === "pass",
    failReason: row.fail_reason,
    failDetail: row.fail_detail,
    model: row.model,
    mode: row.mode,
    effort: row.effort,
    costUsd: row.cost_usd,
    estimated: row.cost_confidence === "estimated",
    tokensTotal: tokensTotalOf(row),
    workS: row.work_s,
    humanS: row.human_seconds,
  };
}

/** Projeta todas as linhas, preservando a ordem (já vem por `seq` do Rust). */
export function buildStepViews(rows: readonly StepRow[]): StepView[] {
  return rows.map(toStepView);
}
