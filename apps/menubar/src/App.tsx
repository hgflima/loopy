import { useState, useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { ReactFlowProvider } from "@xyflow/react";
import type { BridgeState } from "./state/store-bridge";
import { DepsFlow } from "./graph/DepsFlow";

/** Pulse interval — same cadence as the TUI timer (500 ms). */
const TICK_MS = 500;

interface AppProps {
  state: BridgeState;
}

function App({ state }: AppProps) {
  const { store, ui } = state;

  // Single tick counter for all running-task pulses (no timer per node).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <main>
      <h1>Loopy</h1>
      <p>Runtime: {isTauri() ? "Tauri" : "Web"}</p>
      <p>Run: {ui.runStatus}</p>
      <p>Tasks: {store.tasks.length}</p>
      {store.tasks.length > 0 && (
        <ReactFlowProvider>
          <div style={{ width: "100%", height: 300 }}>
            <DepsFlow tasks={store.tasks} edges={store.edges} tick={tick} />
          </div>
        </ReactFlowProvider>
      )}
      {store.tasks.map((t) => (
        <div key={t.id}>
          <strong>{t.id}</strong> — {t.title} [{t.status}]
        </div>
      ))}
      {ui.pendingApprovals.length > 0 && (
        <p>Pending approvals: {ui.pendingApprovals.length}</p>
      )}
    </main>
  );
}

export default App;
