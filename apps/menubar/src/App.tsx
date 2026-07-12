import { useState, useEffect, useCallback, useMemo } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import type { BridgeState } from "./state/store-bridge";
import type { TaskStatus } from "loopy/tui/store";
import { ViewSwitcher } from "./panes/ViewSwitcher";
import { StreamPanel } from "./panes/StreamPanel";
import { Banner } from "./panes/Banner";
import { headApproval } from "./panes/ApprovalPrompt";
import { CardDetail } from "./kanban/CardDetail";
import { useStreamHeight } from "./panes/useStreamHeight";
import { fractionToPercent } from "./panes/resize-helpers";
import { useConfigDraft } from "./config/useConfigDraft";
import { configToStore } from "./config/configToStore";
import { EmptyState } from "./config/EmptyState";
import { Pill, Button, type Tone } from "./ui";
// Brand wordmark (pink loop + text). Dark text for light surfaces, white text
// for dark surfaces — the visible one is chosen by theme in App.css.
import logoOnLight from "./assets/loopy-wordmark-pink-dark.svg";
import logoOnDark from "./assets/loopy-wordmark-pink-white.svg";
import "./App.css";

/** Pulse interval — same cadence as the TUI timer (500 ms). */
const TICK_MS = 500;

const IS_TAURI = isTauri();

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
  const isIdle = ui.runStatus === "idle";
  const currentApproval = headApproval(ui);
  const runPill = RUN_PILL[ui.runStatus];
  const { done, running, total } = countByStatus(store.tasks);
  const approvals = ui.pendingApprovals.length;

  // --- Idle-state config draft (T-006) ------------------------------------
  const configDraft = useConfigDraft();
  const [dir, setDir] = useState("");

  // Load persisted dir on mount (same source as the old LaunchConfig)
  useEffect(() => {
    if (!IS_TAURI) {
      // dev:web — useConfigDraft auto-loads the sample
      setDir("/sample");
      return;
    }
    invoke<{ dir: string }>("load_launch_config")
      .then((cfg) => {
        if (cfg.dir) {
          setDir(cfg.dir);
          void configDraft.load(cfg.dir);
        }
      })
      .catch(() => { /* defaults are fine */ });
  }, []);

  // Reload draft when dir changes
  const handleDirChange = useCallback(
    (newDir: string) => {
      setDir(newDir);
      if (newDir.trim()) {
        void configDraft.load(newDir.trim());
      }
    },
    [configDraft.load],
  );

  async function pickDir() {
    if (!IS_TAURI) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      handleDirChange(selected);
    }
  }

  // Idle store: synthetic preview from config + tasks
  const idleStore = useMemo(() => {
    if (!configDraft.draft) return null;
    return configToStore(configDraft.draft, configDraft.tasks);
  }, [configDraft.draft, configDraft.tasks]);

  // The active store depends on run status
  const activeStore = isIdle && idleStore ? idleStore : store;

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

  // Stream height — draggable divider, persisted in localStorage (T-011).
  const streamHeight = useStreamHeight();

  // Gate auto-open (D6): pending approval forces the drawer to that card.
  const effectiveTaskId = currentApproval?.taskId ?? selectedTaskId;

  const effectiveTask = useMemo(
    () => (effectiveTaskId ? activeStore.tasks.find((t) => t.id === effectiveTaskId) : undefined),
    [effectiveTaskId, activeStore.tasks],
  );

  const showEmptyState = isIdle && configDraft.hasConfig === false;
  const showBoard = !isIdle || idleStore != null;

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <img className="app-header__logo app-header__logo--on-light" src={logoOnLight} alt="Loopy" />
          <img className="app-header__logo app-header__logo--on-dark" src={logoOnDark} alt="Loopy" />
          <Pill tone={runPill.tone} pulse={ui.runStatus === "running"}>
            {runPill.label}
          </Pill>
        </div>

        {/* Dir picker + Iniciar — visible in idle */}
        {isIdle && (
          <div className="app-header__dir" data-testid="dir-picker">
            <input
              className="app-header__dir-input"
              type="text"
              value={dir}
              onChange={(e) => handleDirChange(e.target.value)}
              placeholder="/caminho/do/projeto"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-label="Diretório-alvo"
            />
            {IS_TAURI && (
              <Button variant="secondary" onClick={pickDir}>
                Escolher…
              </Button>
            )}
            <Button
              variant="primary"
              disabled={!dir.trim() || !idleStore}
              data-testid="btn-iniciar"
              onClick={() => onStartRun(false)}
            >
              Iniciar
            </Button>
          </div>
        )}

        <div className="app-header__meta">
          {!isIdle && total > 0 && (
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

      {showEmptyState ? (
        <EmptyState onCreateFromTemplate={configDraft.seedFromTemplate} />
      ) : showBoard ? (
        <div className="app-body">
          <div
            className={`app-body__left${streamHeight.dragging ? " app-body__left--dragging" : ""}`}
            style={{ "--stream-h": fractionToPercent(streamHeight.fraction) } as React.CSSProperties}
          >
            <div className="app-main">
              <ViewSwitcher
                store={activeStore}
                tick={tick}
                selectedTaskId={selectedTaskId}
                onSelectTask={handleSelectTask}
              />
              {isIdle && configDraft.tasks.length === 0 && (
                <p className="t-label u-muted app-todo-hint" data-testid="todo-hint">
                  Nenhuma task encontrada — verifique o <code>todo.md</code> no diretório-alvo.
                </p>
              )}
            </div>
            {!isIdle && (
              <>
                <div
                  className="resize-divider"
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Redimensionar painel de streams"
                  onMouseDown={streamHeight.onDragStart}
                  onDoubleClick={streamHeight.onReset}
                  data-testid="resize-divider"
                >
                  <span className="resize-divider__handle" />
                </div>
                <StreamPanel store={store} transcript={state.transcript} />
              </>
            )}
          </div>
          {effectiveTask && (
            <CardDetail
              taskId={effectiveTask.id}
              title={effectiveTask.title}
              onClose={handleCloseDrawer}
              description={effectiveTask.description}
              deps={effectiveTask.deps}
              tasks={activeStore.tasks}
              transcript={state.transcript}
              steps={effectiveTask.steps}
              approval={currentApproval}
              queueSize={approvals}
              onApprovalDecision={onApprovalDecision}
            />
          )}
        </div>
      ) : (
        <div className="app-scroll app-idle-empty">
          <p className="t-label u-muted">Selecione um diretório com <code>loopy.yml</code> para visualizar o board.</p>
        </div>
      )}
    </main>
  );
}

export default App;
