/**
 * Cabeçalho de três colunas da aba Insights — puro e testável isolado (AD-6).
 *
 * Projeta uma métrica em três colunas: **esta change**, a **média±desvio** das
 * changes `merged` (baseline) e a **change comparada** com **Δ%**. O toggle
 * absoluto↔normalizado divide as métricas de change por `churn` (D22/spec §Tela);
 * as taxas e a contagem de tasks nunca normalizam.
 *
 * Todo cálculo é fail-soft: qualquer coluna ausente (change/baseline/comparada
 * `null`) ou divisor zero vira `null`, nunca uma exceção — a tela mostra "—".
 */
import type { ChangeRow, BaselineRow } from "./rows";

/** Chave estável de cada métrica do cabeçalho (também a ordem de exibição). */
export type MetricKey =
  | "cost"
  | "leadTime"
  | "workTime"
  | "humanTime"
  | "tasks"
  | "firstPassRate"
  | "humanPassRate"
  | "bugs";

/** Como a tela formata o número (unidade). */
export type MetricFormat = "usd" | "duration" | "count" | "rate";

/**
 * Direção do "melhor": qual sinal do Δ% é uma melhora. A tela colore com isto —
 * o view-model não decide cor (mantém a apresentação fora da lógica pura).
 */
export type MetricDirection = "lower-better" | "higher-better" | "neutral";

/** Modo do toggle do cabeçalho. */
export type MetricMode = "absolute" | "normalized";

/** Descritor de uma métrica do cabeçalho. */
export interface Metric {
  readonly key: MetricKey;
  readonly label: string;
  readonly format: MetricFormat;
  readonly direction: MetricDirection;
  /** `true` quando o toggle normalizado divide esta métrica por `churn`. */
  readonly normalizable: boolean;
}

/**
 * Catálogo do cabeçalho, na ordem de exibição. Métricas de "esforço" (custo,
 * tempos) são `lower-better` e normalizáveis por churn; as taxas de qualidade
 * são `higher-better` e já-proporções (não normalizam); `tasks` é neutra.
 */
export const METRICS: readonly Metric[] = [
  { key: "cost", label: "Custo", format: "usd", direction: "lower-better", normalizable: true },
  { key: "leadTime", label: "Lead", format: "duration", direction: "lower-better", normalizable: true },
  { key: "workTime", label: "Trabalho", format: "duration", direction: "lower-better", normalizable: true },
  { key: "humanTime", label: "Humano", format: "duration", direction: "lower-better", normalizable: true },
  { key: "tasks", label: "Tasks", format: "count", direction: "neutral", normalizable: false },
  { key: "firstPassRate", label: "1ª tentativa", format: "rate", direction: "higher-better", normalizable: false },
  { key: "humanPassRate", label: "Aprovação", format: "rate", direction: "higher-better", normalizable: false },
  { key: "bugs", label: "Bugs", format: "count", direction: "lower-better", normalizable: false },
];

/** Valor absoluto de cada métrica numa linha de `v_change`. */
const CHANGE_ABS: Record<MetricKey, (r: ChangeRow) => number | null> = {
  cost: (r) => r.cost_usd,
  leadTime: (r) => r.lead_s,
  workTime: (r) => r.work_s,
  humanTime: (r) => r.human_s,
  tasks: (r) => r.tasks,
  firstPassRate: (r) => r.first_pass_rate,
  humanPassRate: (r) => r.human_pass_rate,
  bugs: (r) => r.bugs,
};

/** Média + desvio da forma **absoluta** de cada métrica no baseline. */
const BASELINE_ABS: Record<MetricKey, (b: BaselineRow) => Stat> = {
  cost: (b) => ({ mean: b.cost_usd, sd: b.cost_usd_sd }),
  leadTime: (b) => ({ mean: b.lead_s, sd: b.lead_s_sd }),
  workTime: (b) => ({ mean: b.work_s, sd: b.work_s_sd }),
  humanTime: (b) => ({ mean: b.human_s, sd: b.human_s_sd }),
  tasks: (b) => ({ mean: b.tasks, sd: b.tasks_sd }),
  firstPassRate: (b) => ({ mean: b.first_pass_rate, sd: null }),
  humanPassRate: (b) => ({ mean: b.human_pass_rate, sd: null }),
  bugs: (b) => ({ mean: b.bugs, sd: b.bugs_sd }),
};

/** Par média/desvio de uma célula do baseline. */
interface Stat {
  readonly mean: number | null;
  readonly sd: number | null;
}

const EMPTY_STAT: Stat = { mean: null, sd: null };

/** Uma linha do cabeçalho: as três colunas + Δ% de uma métrica. */
export interface HeaderRow {
  readonly key: MetricKey;
  readonly label: string;
  readonly format: MetricFormat;
  readonly direction: MetricDirection;
  /** O modo **efetivo**: `absolute` para métricas não-normalizáveis. */
  readonly mode: MetricMode;
  /** Coluna 1 — esta change. */
  readonly current: number | null;
  /** Coluna 2 — média das changes `merged`. */
  readonly baselineMean: number | null;
  /** Coluna 2 — desvio-padrão (quando disponível). */
  readonly baselineSd: number | null;
  /** Coluna 3 — a change comparada. */
  readonly compared: number | null;
  /** Δ% de `current` vs `compared` (a variação da 3ª coluna). */
  readonly deltaPct: number | null;
  /** `true` só na linha de custo quando `cost_confidence='estimated'`. */
  readonly estimated: boolean;
}

/**
 * Variação percentual assinada de `current` relativa a `compared`.
 *
 * `((current - compared) / compared) * 100`. `null` quando qualquer lado é
 * desconhecido ou o comparado é zero (a razão seria indefinida — não "0%").
 */
export function deltaPct(current: number | null, compared: number | null): number | null {
  if (current == null || compared == null) return null;
  if (compared === 0) return null;
  return ((current - compared) / compared) * 100;
}

/**
 * Normaliza `value` pelo `churn` (`size_added+size_removed`) — o divisor do
 * toggle. `null` quando o valor ou o churn são desconhecidos, ou o churn é zero.
 */
export function normalizeByChurn(value: number | null, churn: number | null): number | null {
  if (value == null || churn == null || churn === 0) return null;
  return value / churn;
}

/** Valor de uma métrica de change no modo pedido (absoluto ou por-churn). */
function changeValue(metric: Metric, row: ChangeRow, mode: MetricMode): number | null {
  const abs = CHANGE_ABS[metric.key](row);
  if (mode === "absolute") return abs;
  return normalizeByChurn(abs, row.churn);
}

/** Média/desvio do baseline no modo pedido. */
function baselineStat(metric: Metric, row: BaselineRow, mode: MetricMode): Stat {
  if (mode === "normalized") {
    // Só o custo tem baseline normalizado estatístico (usd_per_line ± sd, D17);
    // as demais normalizáveis não têm coluna por-linha na view → indisponível.
    if (metric.key === "cost") return { mean: row.usd_per_line, sd: row.usd_per_line_sd };
    return EMPTY_STAT;
  }
  return BASELINE_ABS[metric.key](row);
}

/**
 * Monta as linhas do cabeçalho a partir das três fontes.
 *
 * `mode` é o toggle global; cada métrica não-normalizável o ignora e fica
 * absoluta (o `mode` efetivo por linha reflete isso). Qualquer fonte `null`
 * simplesmente zera aquela coluna — o cabeçalho existe mesmo sem dados (idle /
 * `.db` ausente).
 */
export function buildHeaderRows(
  thisChange: ChangeRow | null,
  baseline: BaselineRow | null,
  compared: ChangeRow | null,
  mode: MetricMode,
): HeaderRow[] {
  return METRICS.map((metric) => {
    const effMode: MetricMode = metric.normalizable ? mode : "absolute";
    const current = thisChange ? changeValue(metric, thisChange, effMode) : null;
    const cmp = compared ? changeValue(metric, compared, effMode) : null;
    const base = baseline ? baselineStat(metric, baseline, effMode) : EMPTY_STAT;
    return {
      key: metric.key,
      label: metric.label,
      format: metric.format,
      direction: metric.direction,
      mode: effMode,
      current,
      baselineMean: base.mean,
      baselineSd: base.sd,
      compared: cmp,
      deltaPct: deltaPct(current, cmp),
      estimated: metric.key === "cost" && thisChange?.cost_confidence === "estimated",
    };
  });
}
