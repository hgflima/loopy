import { useState, useEffect } from "react";
import type { BridgeState } from "./state/store-bridge";
import type { TaskStatus } from "loopy/tui/store";
import { ViewSwitcher } from "./panes/ViewSwitcher";
import { StreamPanel } from "./panes/StreamPanel";
import { Banner } from "./panes/Banner";
import { ApprovalPrompt, headApproval } from "./panes/ApprovalPrompt";
import { LaunchConfig } from "./panes/LaunchConfig";
import { Pill, type Tone } from "./ui";
import "./App.css";

/** Pulse interval — same cadence as the TUI timer (500 ms). */
const TICK_MS = 500;

interface AppProps {
  state: BridgeState;
  onStartRun: (yesFlag: boolean) => void;
  onApprovalDecision?: (requestId: string, approved: boolean) => void;
}

/** Run-level status → the header pill tone + label. */
const RUN_PILL: Record<BridgeState["ui"]["runStatus"], { tone: Tone; label: string }> = {
  idle: { tone: "neutral", label: "Idle" },
  running: { tone: "running", label: "Running" },
  finished: { tone: "done", label: "Finished" },
};

function countByStatus(tasks: readonly { status: TaskStatus }[]) {
  let done = 0;
  let running = 0;
  for (const t of tasks) {
    if (t.status === "done") done++;
    else if (t.status === "running") running++;
  }
  return { done, running, total: tasks.length };
}

function App({ state, onStartRun, onApprovalDecision }: AppProps) {
  const { store, ui } = state;
  const isStartFail = ui.sidecarFailure?.type === "start-fail";
  const showLaunchConfig = ui.runStatus === "idle" || isStartFail;
  const currentApproval = headApproval(ui);
  const runPill = RUN_PILL[ui.runStatus];
  const { done, running, total } = countByStatus(store.tasks);
  const approvals = ui.pendingApprovals.length;

  // Single tick counter for all running-task pulses (no timer per node).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__wordmark t-title">Loopy</span>
          <Pill tone={runPill.tone} pulse={ui.runStatus === "running"}>
            {runPill.label}
          </Pill>
        </div>

        <div className="app-header__meta">
          {!showLaunchConfig && total > 0 && (
            <span className="app-header__progress" aria-label={`${done} de ${total} tasks concluídas`}>
              <span className="t-data app-header__count">
                {done}/{total}
              </span>
              <span className="t-label u-muted">done</span>
              {running > 0 && (
                <span className="t-label app-header__running">{running} running</span>
              )}
            </span>
          )}
          {approvals > 0 && (
            <Pill tone="accent">
              {approvals} approval{approvals > 1 ? "s" : ""}
            </Pill>
          )}
        </div>
      </header>

      <Banner ui={ui} />

      {showLaunchConfig ? (
        <div className="app-scroll">
          <LaunchConfig onStart={onStartRun} startFailed={isStartFail} />
        </div>
      ) : (
        <>
          <div className="app-main">
            <ViewSwitcher store={store} tick={tick} />
          </div>
          <StreamPanel store={store} transcript={state.transcript} />
        </>
      )}

      {currentApproval && onApprovalDecision && (
        <ApprovalPrompt
          request={currentApproval}
          queueSize={ui.pendingApprovals.length}
          onDecision={onApprovalDecision}
        />
      )}
    </main>
  );
}

export default App;
