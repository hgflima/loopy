/**
 * ViewSwitcher — default Kanban, toggles to DepsFlow (graph) or Config (editor).
 *
 * All three views are kept mounted (hidden via CSS) so state is preserved
 * on switch (acceptance criterion: "sem perder estado").
 */
import { useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import type { StoreState } from "loopy/tui/store";
import type { ConfigDraftAPI } from "../config/useConfigDraft";
import type { OrphanRef } from "../config/pipeline-edit";
import { KanbanBoard } from "../kanban/KanbanBoard";
import { DepsFlow } from "../graph/DepsFlow";
import { ConfigPane } from "../config/ConfigPane";
import { SegmentedControl, type Segment } from "../ui";
import "./ViewSwitcher.css";

export type ViewId = "kanban" | "deps" | "config";

const SEGMENTS: readonly Segment<ViewId>[] = [
  { id: "kanban", label: "Kanban" },
  { id: "deps", label: "Deps" },
  { id: "config", label: "Config" },
];

interface ViewSwitcherProps {
  store: StoreState;
  tick: number;
  selectedTaskId?: string | null;
  onSelectTask?: (taskId: string) => void;
  configDraft?: ConfigDraftAPI;
  /** Open step editor for a given step id (idle only). */
  onEditStep?: (stepId: string) => void;
  /** Add a new step (idle only, T-012). */
  onAddStep?: () => void;
  /** Remove a step by id (idle only, T-012). */
  onRemoveStep?: (stepId: string) => void;
  /** Reorder steps (idle only, T-012). */
  onReorderStep?: (from: number, to: number) => void;
  /** Orphan refs for highlighting (idle only, T-012). */
  orphanRefs?: readonly OrphanRef[];
}

export function ViewSwitcher({
  store,
  tick,
  selectedTaskId,
  onSelectTask,
  configDraft,
  onEditStep,
  onAddStep,
  onRemoveStep,
  onReorderStep,
  orphanRefs,
}: ViewSwitcherProps) {
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

      {/* All three mounted, hidden via display — preserves state on switch */}
      <div
        className="view-switcher__pane"
        style={{ display: view === "kanban" ? "flex" : "none" }}
      >
        <KanbanBoard
          store={store}
          selectedTaskId={selectedTaskId}
          onSelectTask={onSelectTask}
          onEditStep={onEditStep}
          onAddStep={onAddStep}
          onRemoveStep={onRemoveStep}
          onReorderStep={onReorderStep}
          orphanRefs={orphanRefs}
        />
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
      <div
        className="view-switcher__pane"
        style={{ display: view === "config" ? "flex" : "none" }}
      >
        {configDraft && <ConfigPane configDraft={configDraft} />}
      </div>
    </div>
  );
}
