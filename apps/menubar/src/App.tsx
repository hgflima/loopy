import { useState, useEffect, useCallback, useMemo } from "react";
import type { BridgeState } from "./state/store-bridge";
import type { TaskStatus } from "loopy/tui/store";
import { ViewSwitcher } from "./panes/ViewSwitcher";
import { StreamPanel } from "./panes/StreamPanel";
import { Banner } from "./panes/Banner";
import { headApproval } from "./panes/ApprovalPrompt";
import { LaunchConfig } from "./panes/LaunchConfig";
import { CardDetail } from "./kanban/CardDetail";
import { Pill, type Tone } from "./ui";
import logoGradient from "./assets/loopy-lockup-horizontal-gradient.svg";
import logoBlack from "./assets/loopy-lockup-horizontal-black.svg";
import logoWhite from "./assets/loopy-lockup-horizontal-white.svg";
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

  // Selection state — persists across column moves and task_finished.
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const handleSelectTask = useCallback((taskId: string) => {
    setSelectedTaskId((prev) => (prev === taskId ? null : taskId));
  }, []);
  const handleCloseDrawer = useCallback(() => setSelectedTaskId(null), []);

  // Gate auto-open (D6): pending approval forces the drawer to that card.
  const effectiveTaskId = currentApproval?.taskId ?? selectedTaskId;

  const effectiveTask = useMemo(
    () => (effectiveTaskId ? store.tasks.find((t) => t.id === effectiveTaskId) : undefined),
    [effectiveTaskId, store.tasks],
  );

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <img className="app-header__logo app-header__logo--gradient" src={logoGradient} alt="Loopy" />
          <img className="app-header__logo app-header__logo--light" src={logoBlack} alt="Loopy" />
          <img className="app-header__logo app-header__logo--dark" src={logoWhite} alt="Loopy" />
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
        <div className="app-body">
          <div className="app-body__left">
            <div className="app-main">
              <ViewSwitcher
                store={store}
                tick={tick}
                selectedTaskId={selectedTaskId}
                onSelectTask={handleSelectTask}
              />
            </div>
            <StreamPanel store={store} transcript={state.transcript} />
          </div>
          {effectiveTask && (
            <CardDetail
              taskId={effectiveTask.id}
              title={effectiveTask.title}
              onClose={handleCloseDrawer}
              description={effectiveTask.description}
              deps={effectiveTask.deps}
              tasks={store.tasks}
              transcript={state.transcript}
              approval={currentApproval}
              queueSize={approvals}
              onApprovalDecision={onApprovalDecision}
            />
          )}
        </div>
      )}
    </main>
  );
}

export default App;
