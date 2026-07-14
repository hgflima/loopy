/**
 * ViewSwitcher — default Kanban, toggles to DepsFlow (graph) or Config (editor).
 *
 * All three views are kept mounted (hidden via CSS) so state is preserved
 * on switch (acceptance criterion: "sem perder estado").
 *
 * The tab bar also hosts the **global save bar**: every edit — a step via the ⋯
 * drawer, an added/removed/reordered column, or a field in the Config tab — writes
 * to the same `configDraft` and marks it dirty. Since editing happens on the board
 * too (not just in the Config tab), the Save affordance lives here, next to the
 * tabs, so it is visible from every view. Fail-closed: disabled while errors exist.
 */
import { useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import type { StoreState } from "loopy/tui/store";
import type { ConfigDraftAPI } from "../config/useConfigDraft";
import type { OrphanRef } from "../config/pipeline-edit";
import { KanbanBoard } from "../kanban/KanbanBoard";
import { DepsFlow } from "../graph/DepsFlow";
import { ConfigPane } from "../config/ConfigPane";
import { SegmentedControl, Button, type Segment } from "../ui";
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
  /** `concurrency` do yml — teto da frente de onda no grafo (vale também no Run). */
  concurrency?: number | "auto";
  /** `max_concurrency` do yml — teto do `auto`. */
  maxConcurrency?: number;
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
  concurrency,
  maxConcurrency,
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

        {/* Global save bar — dirty draft is savable from any tab (C4: fail-closed). */}
        {configDraft?.dirty && (
          <div className="view-switcher__save" data-testid="save-bar">
            {configDraft.errors.length > 0 ? (
              <span className="view-switcher__save-hint" data-testid="save-error-hint">
                {configDraft.errors.length} erro{configDraft.errors.length > 1 ? "s" : ""} — corrija na aba Config
              </span>
            ) : (
              <span className="view-switcher__dirty" data-testid="dirty-indicator">
                Alterações não salvas
              </span>
            )}
            <Button
              variant="primary"
              disabled={configDraft.errors.length > 0}
              onClick={() => void configDraft.save()}
              data-testid="btn-save"
            >
              Salvar
            </Button>
          </div>
        )}
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
              concurrency={concurrency}
              maxConcurrency={maxConcurrency}
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
