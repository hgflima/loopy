/**
 * Pure function to detect cards that moved backward in the Kanban board
 * (i.e., a `goto` desvio sent the task to an earlier pipeline step).
 *
 * Compares column indices between two snapshots. A card whose column index
 * decreased is a "goto return" — the fix-loop visual centrepiece (SC #5).
 */
import type { KanbanColumn } from "./grouper";

/**
 * Build a map from taskId → column index for a set of columns.
 */
function buildPositionMap(columns: readonly KanbanColumn[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < columns.length; i++) {
    for (const card of columns[i]!.cards) {
      map.set(card.taskId, i);
    }
  }
  return map;
}

/**
 * Detect task IDs whose column index decreased between two snapshots.
 *
 * @param prev - Previous columns (undefined on first render → empty set).
 * @param next - Current columns.
 * @returns Set of taskIds that moved to an earlier column (goto).
 */
export function detectGotoCards(
  prev: readonly KanbanColumn[] | undefined,
  next: readonly KanbanColumn[],
): ReadonlySet<string> {
  if (!prev) return new Set<string>();

  const prevPos = buildPositionMap(prev);
  const nextPos = buildPositionMap(next);
  const gotos = new Set<string>();

  for (const [taskId, nextIdx] of nextPos) {
    const prevIdx = prevPos.get(taskId);
    if (prevIdx !== undefined && nextIdx < prevIdx) {
      gotos.add(taskId);
    }
  }

  return gotos;
}
