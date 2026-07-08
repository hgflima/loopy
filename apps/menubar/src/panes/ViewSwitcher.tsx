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

export type ViewId = "kanban" | "deps";

const TABS: { id: ViewId; label: string }[] = [
  { id: "kanban", label: "Kanban" },
  { id: "deps", label: "Deps" },
];

interface ViewSwitcherProps {
  store: StoreState;
  tick: number;
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: "4px 12px",
    fontSize: 12,
    borderRadius: 4,
    border: "1px solid #333",
    background: active ? "#2a4a7f" : "#1a1a2e",
    color: active ? "#fff" : "#888",
    cursor: "pointer",
  };
}

export function ViewSwitcher({ store, tick }: ViewSwitcherProps) {
  const [view, setView] = useState<ViewId>("kanban");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", gap: 4, padding: "8px 12px" }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setView(tab.id)}
            style={tabStyle(view === tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Both mounted, hidden via display — preserves state on switch */}
      <div style={{ flex: 1, display: view === "kanban" ? "flex" : "none", minHeight: 0 }}>
        <KanbanBoard store={store} />
      </div>
      <div style={{ flex: 1, display: view === "deps" ? "block" : "none", minHeight: 0 }}>
        <ReactFlowProvider>
          <div style={{ width: "100%", height: "100%" }}>
            <DepsFlow tasks={store.tasks} edges={store.edges} tick={tick} />
          </div>
        </ReactFlowProvider>
      </div>
    </div>
  );
}
