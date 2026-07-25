/**
 * ViewSwitcher — five segments: Kanban (default), Deps (graph), Config (editor),
 * Insights (telemetry) and Specs (authoring, C-0018).
 *
 * All views are kept mounted (hidden via CSS) so state is preserved on switch
 * (acceptance criterion: "sem perder estado").
 *
 * **The tab bar is always visible (D20).** It is no longer replaced wholesale by
 * the EmptyState when a project has no `loopy.yml` — authoring precedes the yml,
 * and `Specs` must be reachable in exactly that project. Instead the EmptyState
 * degrades the **Config** tab (its "criar a partir do template" seeds the draft);
 * Kanban/Deps/Insights show their own empty; `Specs` works normally.
 *
 * The tab bar also hosts the **global save bar**: every edit — a step via the ⋯
 * drawer, an added/removed/reordered column, or a field in the Config tab — writes
 * to the same `configDraft` and marks it dirty. Since editing happens on the board
 * too (not just in the Config tab), the Save affordance lives here, next to the
 * tabs, so it is visible from every view. Fail-closed: disabled while errors exist.
 */
import { useState, useCallback } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import type { StoreState } from "loopy/tui/store";
import type { ConfigDraftAPI } from "../config/useConfigDraft";
import type { OrphanRef } from "../config/pipeline-edit";
import { KanbanBoard } from "../kanban/KanbanBoard";
import { DepsFlow } from "../graph/DepsFlow";
import { ConfigPane } from "../config/ConfigPane";
import { InsightsPane } from "../insights/InsightsPane";
import { SpecsPane } from "../specs/SpecsPane";
import { EmptyState } from "../config/EmptyState";
import { SegmentedControl, Button, type Segment } from "../ui";
import "./ViewSwitcher.css";

export type ViewId = "kanban" | "deps" | "config" | "insights" | "specs";

const SEGMENTS: readonly Segment<ViewId>[] = [
  { id: "kanban", label: "Kanban" },
  { id: "deps", label: "Deps" },
  { id: "config", label: "Config" },
  { id: "insights", label: "Insights" },
  { id: "specs", label: "Specs" },
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
  /**
   * Diretório do projeto. **Load-bearing, não cosmético**: é o que habilita a
   * Sondagem de capabilities no `ConfigPane` (o `useAgentCapabilities` devolve
   * `idle` sem ele, e os selects de model/effort degradam para texto livre).
   */
  dir?: string;
  /**
   * True while a Run is in progress — forwarded to the `Specs` tab, which *warns*
   * (D22) that authoring a Change dirties the parent and can stop the Run. It
   * never blocks; the flag is ours, the warning is the pane's.
   */
  runActive?: boolean;
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
  /**
   * "Abrir o board" from the Specs tab's saved screen (D11, T-015). The App
   * patches `inputs.*` (it owns `configDraft`); switching the view to the Kanban
   * board is ours (we own `view`) — both happen in one gesture.
   */
  onOpenBoard?: (changeDir: string) => void;
}

export function ViewSwitcher({
  store,
  tick,
  selectedTaskId,
  onSelectTask,
  concurrency,
  maxConcurrency,
  configDraft,
  dir,
  runActive,
  onEditStep,
  onAddStep,
  onRemoveStep,
  onReorderStep,
  orphanRefs,
  onOpenBoard,
}: ViewSwitcherProps) {
  const [view, setView] = useState<ViewId>("kanban");

  // "Abrir o board" (D11): let the App repoint inputs.* on the draft, then reveal
  // the Kanban board so the human sees the just-written backlog.
  const handleOpenBoard = useCallback(
    (changeDir: string) => {
      onOpenBoard?.(changeDir);
      setView("kanban");
    },
    [onOpenBoard],
  );

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

      {/* All panes mounted, hidden via display — preserves state on switch */}
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
      {/* Config: hosts the EmptyState when the dir has no yml (D20) — the empty
          state degrades this tab instead of replacing the whole bar. */}
      <div
        className="view-switcher__pane"
        style={{ display: view === "config" ? "flex" : "none" }}
      >
        {configDraft &&
          (configDraft.hasConfig === false ? (
            <EmptyState onCreateFromTemplate={configDraft.seedFromTemplate} />
          ) : (
            <ConfigPane configDraft={configDraft} dir={dir} />
          ))}
      </div>
      {/* Insights: 4ª aba, sempre montada (lê o `.db` por Rust; funciona em idle e no run). */}
      <div
        className="view-switcher__pane"
        style={{ display: view === "insights" ? "flex" : "none" }}
      >
        <InsightsPane dir={dir} />
      </div>
      {/* Specs: 5ª aba (C-0018, D20), sempre montada — a autoria de spec/plan/todo
          precede o yml, então funciona com ou sem `loopy.yml`. */}
      <div
        className="view-switcher__pane"
        style={{ display: view === "specs" ? "flex" : "none" }}
      >
        <SpecsPane dir={dir} runActive={runActive} onOpenBoard={handleOpenBoard} />
      </div>
    </div>
  );
}
