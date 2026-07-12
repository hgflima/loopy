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
import type { StoreState, TaskState } from "loopy/tui/store";

export function configToStore(
  config: LoopyConfigParsed,
  tasks: readonly Task[],
): StoreState {
  const pipeline = config.pipeline.map((s) => ({
    id: s.id,
    type: s.type,
  }));

  const taskStates: TaskState[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.deps.length > 0 ? ("blocked" as const) : ("pending" as const),
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
