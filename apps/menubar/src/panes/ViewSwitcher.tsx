/**
 * ViewSwitcher — default Kanban, toggles to DepsFlow (graph).
 *
 * Both views are kept mounted (hidden via CSS) so state is preserved
 * on switch (acceptance criterion: "sem perder estado").
 *
 * DepsFlow (T-010) is not yet implemented — a placeholder is rendered.
 * When T-010 lands, replace the placeholder import with the real component.
 */
import { useState } from "react";
import type { StoreState } from "loopy/tui/store";
import { KanbanBoard } from "../kanban/KanbanBoard";

export type ViewId = "kanban" | "deps";

const TABS: { id: ViewId; label: string }[] = [
  { id: "kanban", label: "Kanban" },
  { id: "deps", label: "Deps" },
];

interface ViewSwitcherProps {
  store: StoreState;
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

export function ViewSwitcher({ store }: ViewSwitcherProps) {
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
      <div style={{ flex: 1, display: view === "deps" ? "flex" : "none", minHeight: 0, alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#555", fontSize: 13 }}>
          DepsFlow — pending (T-010)
        </span>
      </div>
    </div>
  );
}
