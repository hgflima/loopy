/**
 * Seleção de changes do cabeçalho da aba Insights — pura e testável (AD-6).
 *
 * Duas escolhas de default que a `InsightsPane` faz ao abrir a aba, ambas
 * derivadas só da lista de changes (`v_change`, newest-first do Rust):
 *
 * - **Esta change** (coluna 1) = a mais recente (a que está em andamento durante
 *   um run, ou a última mergeada em revisão fria).
 * - **Change comparada** (coluna 3, D22) = a change **merged** imediatamente
 *   anterior a "esta change" por `created_at`. Um dropdown troca o alvo depois.
 */
import type { ChangeRow } from "./rows";

/** A change de maior `created_at` entre as que passam no `accept` (`null` se nenhuma). */
function latestChange(
  changes: readonly ChangeRow[],
  accept: (c: ChangeRow) => boolean,
): ChangeRow | null {
  let best: ChangeRow | null = null;
  for (const c of changes) {
    if (!accept(c)) continue;
    if (best === null || c.created_at > best.created_at) best = c;
  }
  return best;
}

/**
 * A change em foco por default: a mais recente da lista. O Rust já devolve
 * `v_change` ordenado por `created_at DESC`, então é a primeira — mas não
 * dependemos disso: escolhemos o `created_at` máximo explicitamente. `null`
 * quando não há nenhuma change (sem telemetria).
 */
export function pickDefaultThisChange(changes: readonly ChangeRow[]): string | null {
  return latestChange(changes, () => true)?.change_id ?? null;
}

/**
 * A change comparada por default (D22): a **merged** com maior `created_at`
 * **estritamente anterior** ao da change em foco. Ignora não-merged (a change em
 * andamento nunca é alvo de comparação) e a própria change em foco. `null` quando
 * não há merged anterior — a 3ª coluna nasce vazia e o usuário escolhe no dropdown.
 */
export function pickDefaultCompared(
  changes: readonly ChangeRow[],
  thisChangeId: string | null,
): string | null {
  const focus = changes.find((c) => c.change_id === thisChangeId);
  if (!focus) return null;
  const prev = latestChange(
    changes,
    (c) =>
      c.change_id !== focus.change_id &&
      c.status === "merged" &&
      c.created_at < focus.created_at,
  );
  return prev?.change_id ?? null;
}

/** Acha a linha de uma change na lista por id (`null` quando ausente). */
export function findChange(
  changes: readonly ChangeRow[],
  changeId: string | null,
): ChangeRow | null {
  if (changeId === null) return null;
  return changes.find((c) => c.change_id === changeId) ?? null;
}
