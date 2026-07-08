import type { BridgeState } from "./state/store-bridge";
import { ViewSwitcher } from "./panes/ViewSwitcher";

const SEP = <span style={{ color: "#555" }}>|</span>;

interface AppProps {
  state: BridgeState;
}

function App({ state }: AppProps) {
  const { store, ui } = state;

  return (
    <main style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0f0f23", color: "#ccc" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 12px", borderBottom: "1px solid #1a1a2e", fontSize: 12 }}>
        <strong style={{ color: "#fff" }}>Loopy</strong>
        {SEP}
        <span>Run: {ui.runStatus}</span>
        {SEP}
        <span>Tasks: {store.tasks.length}</span>
        {ui.pendingApprovals.length > 0 && (
          <>
            {SEP}
            <span style={{ color: "magenta" }}>
              Approvals: {ui.pendingApprovals.length}
            </span>
          </>
        )}
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ViewSwitcher store={store} />
      </div>
    </main>
  );
}

export default App;
