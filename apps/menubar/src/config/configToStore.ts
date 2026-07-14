/**
 * Pure projection: LoopyConfigParsed + Task[] → StoreState (preview).
 *
 * Replicates the effect of `pipeline_declared` + `edges_set` +
 * `task_registered` store events without running the engine, so the
 * menubar can render the Kanban board in idle state.
 *
 * No React, no Tauri, no side-effects — pure function, unit-testable.
 */
import type { LoopyConfigParsed } from "loopy/config";
import type { Task } from "loopy/backlog";
import type { StoreState, TaskState, TaskStatus } from "loopy/tui/store";

/**
 * Status de exibição de uma task **em repouso**, derivado só do `todo.md`.
 *
 * Marcada `- [x]` ⇒ `done` (o grouper a manda para "Fim"). Caso contrário vale a
 * regra do `readySet` do motor: só é `ready` quando *toda* dep já está `done`.
 * Dep pendente — ou id desconhecido, que o motor rejeita como Dep órfã — mantém
 * a task `blocked` (fail-closed).
 */
function statusOf(task: Task, doneIds: ReadonlySet<string>): TaskStatus {
  if (task.done) return "done";
  return task.deps.every((dep) => doneIds.has(dep)) ? "ready" : "blocked";
}

export function configToStore(
  config: LoopyConfigParsed,
  tasks: readonly Task[],
): StoreState {
  const pipeline = config.pipeline.map((s) => ({
    id: s.id,
    type: s.type,
  }));

  const doneIds = new Set(tasks.filter((t) => t.done).map((t) => t.id));

  const taskStates: TaskState[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: statusOf(t, doneIds),
    description: t.body,
    deps: t.deps,
    steps: [],
    stream: "",
  }));

  const edges: [string, string][] = tasks.flatMap((t) =>
    t.deps.map((d): [string, string] => [d, t.id]),
  );

  return {
    tasks: taskStates,
    edges,
    acpLog: [],
    activeAgents: new Set<string>(),
    pipeline,
  };
}
