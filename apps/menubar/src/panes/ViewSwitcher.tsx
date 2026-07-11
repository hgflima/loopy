/**
 * ViewSwitcher — default Kanban, toggles to DepsFlow (graph).
 *
 * Both views are kept mounted (hidden via CSS) so state is preserved
 * on switch (acceptance criterion: "sem perder estado").
 */
import { useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import type { StoreState } from "loopy/tui/store";
import { KanbanBoard } from "../kanban/KanbanBoard";
import { DepsFlow } from "../graph/DepsFlow";
import { SegmentedControl, type Segment } from "../ui";
import "./ViewSwitcher.css";

export type ViewId = "kanban" | "deps";

const SEGMENTS: readonly Segment<ViewId>[] = [
  { id: "kanban", label: "Kanban" },
  { id: "deps", label: "Deps" },
];

interface ViewSwitcherProps {
  store: StoreState;
  tick: number;
  selectedTaskId?: string | null;
  onSelectTask?: (taskId: string) => void;
}

export function ViewSwitcher({ store, tick, selectedTaskId, onSelectTask }: ViewSwitcherProps) {
  const [view, setView] = useState<ViewId>("kanban");

  return (
    <div className="view-switcher">
      <div className="view-switcher__bar">
        <SegmentedControl
          segments={SEGMENTS}
          value={view}
          onChange={setView}
          ariaLabel="Visualização"
        />
      </div>

      {/* Both mounted, hidden via display — preserves state on switch */}
      <div
        className="view-switcher__pane"
        style={{ display: view === "kanban" ? "flex" : "none" }}
      >
        <KanbanBoard store={store} selectedTaskId={selectedTaskId} onSelectTask={onSelectTask} />
      </div>
      <div
        className="view-switcher__pane"
        style={{ display: view === "deps" ? "block" : "none" }}
      >
        <ReactFlowProvider>
          <div style={{ width: "100%", height: "100%" }}>
            <DepsFlow
              tasks={store.tasks}
              edges={store.edges}
              tick={tick}
              active={view === "deps"}
              selectedTaskId={selectedTaskId}
              onSelectTask={onSelectTask}
            />
          </div>
        </ReactFlowProvider>
      </div>
    </div>
  );
}
