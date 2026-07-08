import { useState, useEffect } from "react";
import type { BridgeState } from "./state/store-bridge";
import { ViewSwitcher } from "./panes/ViewSwitcher";
import { StreamPanel } from "./panes/StreamPanel";
import { Banner } from "./panes/Banner";
import { LaunchConfig } from "./panes/LaunchConfig";

/** Pulse interval — same cadence as the TUI timer (500 ms). */
const TICK_MS = 500;

const SEP = <span style={{ color: "#555" }}>|</span>;

interface AppProps {
  state: BridgeState;
  onStartRun: (yesFlag: boolean) => void;
}

function App({ state, onStartRun }: AppProps) {
  const { store, ui } = state;
  const isStartFail = ui.sidecarFailure?.type === "start-fail";
  const showLaunchConfig = ui.runStatus === "idle" || isStartFail;

  // Single tick counter for all running-task pulses (no timer per node).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <main style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0f0f23", color: "#ccc" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 12px", borderBottom: "1px solid #1a1a2e", fontSize: 12 }}>
        <strong style={{ color: "#fff" }}>Loopy</strong>
        {SEP}
        <span>Run: {ui.runStatus}</span>
        {!showLaunchConfig && (
          <>
            {SEP}
            <span>Tasks: {store.tasks.length}</span>
          </>
        )}
        {ui.pendingApprovals.length > 0 && (
          <>
            {SEP}
            <span style={{ color: "magenta" }}>
              Approvals: {ui.pendingApprovals.length}
            </span>
          </>
        )}
      </header>
      <Banner ui={ui} />
      {showLaunchConfig ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <LaunchConfig onStart={onStartRun} />
        </div>
      ) : (
        <>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ViewSwitcher store={store} tick={tick} />
          </div>
          <StreamPanel store={store} />
        </>
      )}
    </main>
  );
}

export default App;
