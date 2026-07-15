/**
 * Formatação das células da aba Insights — pura e testável (AD-6).
 *
 * Traduz um número (ou `null`) do view-model para o texto da tela, respeitando a
 * unidade (`MetricFormat`) e o toggle absoluto↔normalizado (`MetricMode`). Todo
 * `null` vira `—` (o "desconhecido" honesto — nunca um zero inventado). O tom do
 * Δ% (bom/ruim/neutro) também vive aqui, mas é só um enum — **a cor** é do CSS.
 */
import type { MetricFormat, MetricMode, MetricDirection } from "./metrics";

/** Texto de "valor ausente". */
export const DASH = "—";

/** Segundos → texto compacto (`45s`, `3m 20s`, `1.5h`). */
function fmtSeconds(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return sec ? `${m}m ${sec}s` : `${m}m`;
  }
  return `${(s / 3600).toFixed(1)}h`;
}

/** Um contador com no máximo uma casa (a média de tasks do baseline é fracionária). */
function fmtCount(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * Formata `value` para a unidade `format` no modo `mode`. No modo normalizado, as
 * métricas normalizáveis são por-linha (churn) — custo ganha casas, tempo ganha o
 * sufixo `/L`. `null` → `—`.
 */
export function fmtValue(
  value: number | null,
  format: MetricFormat,
  mode: MetricMode = "absolute",
): string {
  if (value == null || Number.isNaN(value)) return DASH;
  const normalized = mode === "normalized";
  switch (format) {
    case "usd":
      return normalized ? `$${value.toFixed(4)}/L` : `$${value.toFixed(2)}`;
    case "duration":
      return normalized ? `${value.toFixed(2)}s/L` : fmtSeconds(value);
    case "rate":
      return `${Math.round(value * 100)}%`;
    case "count":
    default:
      return fmtCount(value);
  }
}

/**
 * A célula do baseline: `média ± desvio`. Sem média → `—`; sem desvio (proporções,
 * ou dado insuficiente) → só a média.
 */
export function fmtBaseline(
  mean: number | null,
  sd: number | null,
  format: MetricFormat,
  mode: MetricMode = "absolute",
): string {
  if (mean == null || Number.isNaN(mean)) return DASH;
  const meanText = fmtValue(mean, format, mode);
  if (sd == null || Number.isNaN(sd)) return meanText;
  return `${meanText} ± ${fmtValue(sd, format, mode)}`;
}

/** O Δ% assinado (`+12%` / `-5%`); `null` → `—`. */
export function fmtDelta(pct: number | null): string {
  if (pct == null || Number.isNaN(pct)) return DASH;
  const sign = pct > 0 ? "+" : "";
  const abs = Math.abs(pct);
  const digits = abs === 0 || abs >= 10 ? 0 : 1;
  return `${sign}${pct.toFixed(digits)}%`;
}

/** Tom semântico do Δ% para o CSS colorir — não uma cor. */
export type DeltaTone = "good" | "bad" | "neutral";

/**
 * Um Δ% é bom quando anda na direção desejada da métrica. `neutral` para métricas
 * neutras, Δ desconhecido ou exatamente 0 (sem mudança).
 */
export function deltaTone(pct: number | null, direction: MetricDirection): DeltaTone {
  if (pct == null || Number.isNaN(pct) || pct === 0 || direction === "neutral") return "neutral";
  const improving = direction === "lower-better" ? pct < 0 : pct > 0;
  return improving ? "good" : "bad";
}
