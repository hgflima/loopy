import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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

/** Launch flags passed to the sidecar (persisted in launch-config.json, NOT in yml). */
export interface LaunchFlags {
  yes: boolean;
  taskId: string;
  verbose: boolean;
}

interface AppProps {
  state: BridgeState;
  onStartRun: (flags: LaunchFlags) => void;
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

  // --- Launch popover flags (T-014) — persisted in launch-config.json -----
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [flagYes, setFlagYes] = useState(false);
  const [flagTaskId, setFlagTaskId] = useState("");
  const [flagVerbose, setFlagVerbose] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!popoverOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [popoverOpen]);

  // --- Dirty guard confirm state (T-014/R10) ------------------------------
  const [dirtyConfirm, setDirtyConfirm] = useState<string | null>(null);

  // Load persisted dir on mount (same source as the old LaunchConfig)
  useEffect(() => {
    if (!IS_TAURI) {
      // dev:web — useConfigDraft auto-loads the sample
      setDir("/sample");
      return;
    }
    invoke<{ dir: string; yes?: boolean; task_id?: string; verbose?: boolean }>("load_launch_config")
      .then((cfg) => {
        if (cfg.dir) {
          setDir(cfg.dir);
          void configDraft.load(cfg.dir);
        }
        if (cfg.yes) setFlagYes(cfg.yes);
        if (cfg.task_id) setFlagTaskId(cfg.task_id);
        if (cfg.verbose) setFlagVerbose(cfg.verbose);
      })
      .catch(() => { /* defaults are fine */ });
  }, []);

  // Reload draft when dir changes (with dirty guard)
  const handleDirChange = useCallback(
    (newDir: string) => {
      if (configDraft.dirty) {
        setDirtyConfirm(newDir);
        return;
      }
      setDir(newDir);
      if (newDir.trim()) {
        void configDraft.load(newDir.trim());
      }
    },
    [configDraft.dirty, configDraft.load],
  );

  // Dirty guard resolution — shared "apply pending dir" logic
  const applyPendingDir = useCallback(
    (pendingDir: string) => {
      setDirtyConfirm(null);
      setDir(pendingDir);
      if (pendingDir.trim()) {
        void configDraft.load(pendingDir.trim());
      }
    },
    [configDraft.load],
  );

  const handleDirtyConfirmSave = useCallback(async () => {
    if (!dirtyConfirm) return;
    await configDraft.save();
    applyPendingDir(dirtyConfirm);
  }, [dirtyConfirm, configDraft.save, applyPendingDir]);

  const handleDirtyConfirmDiscard = useCallback(() => {
    if (!dirtyConfirm) return;
    applyPendingDir(dirtyConfirm);
  }, [dirtyConfirm, applyPendingDir]);

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

  // --- Launch (auto-save + flags) -----------------------------------------
  const canStart = !!(dir.trim() && idleStore && configDraft.errors.length === 0);

  const handleLaunch = useCallback(async () => {
    if (!canStart) return;
    // Auto-save dirty draft before starting (C2)
    if (configDraft.dirty) {
      const saved = await configDraft.save();
      if (!saved) return; // fail-closed
    }
    const flags: LaunchFlags = { yes: flagYes, taskId: flagTaskId.trim(), verbose: flagVerbose };
    setPopoverOpen(false);
    onStartRun(flags);
  }, [canStart, configDraft.dirty, configDraft.save, flagYes, flagTaskId, flagVerbose, onStartRun]);

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
            <div className="app-header__launch" ref={popoverRef}>
              <Button
                variant="primary"
                disabled={!canStart}
                data-testid="btn-iniciar"
                onClick={() => void handleLaunch()}
              >
                Iniciar
              </Button>
              <Button
                variant="ghost"
                className="app-header__launch-toggle"
                data-testid="btn-launch-flags"
                aria-label="Opções de launch"
                aria-expanded={popoverOpen}
                onClick={() => setPopoverOpen((o) => !o)}
              >
                ⋯
              </Button>
              {popoverOpen && (
                <div className="launch-popover" data-testid="launch-popover" role="dialog" aria-label="Flags de launch">
                  <label className="launch-popover__toggle">
                    <input
                      type="checkbox"
                      checked={flagYes}
                      onChange={(e) => setFlagYes(e.target.checked)}
                      data-testid="flag-yes"
                    />
                    <span className="launch-popover__flag">--yes</span>
                    <span className="launch-popover__hint">auto-aprovar gates</span>
                  </label>
                  <label className="launch-popover__toggle">
                    <input
                      type="checkbox"
                      checked={flagVerbose}
                      onChange={(e) => setFlagVerbose(e.target.checked)}
                      data-testid="flag-verbose"
                    />
                    <span className="launch-popover__flag">--verbose</span>
                    <span className="launch-popover__hint">saída detalhada</span>
                  </label>
                  <label className="launch-popover__field">
                    <span className="launch-popover__flag">--task</span>
                    <input
                      type="text"
                      className="launch-popover__input"
                      value={flagTaskId}
                      onChange={(e) => setFlagTaskId(e.target.value)}
                      placeholder="T-001"
                      spellCheck={false}
                      data-testid="flag-task-id"
                    />
                  </label>
                </div>
              )}
            </div>
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

      {/* Dirty guard confirm dialog (R10) */}
      {dirtyConfirm && (
        <div className="dirty-confirm-overlay" data-testid="dirty-confirm">
          <div className="dirty-confirm" role="alertdialog" aria-label="Alterações não salvas">
            <p className="dirty-confirm__message">Há alterações não salvas no <code>loopy.yml</code>.</p>
            <div className="dirty-confirm__actions">
              <Button variant="primary" data-testid="dirty-save" onClick={() => void handleDirtyConfirmSave()}>
                Salvar
              </Button>
              <Button variant="secondary" data-testid="dirty-discard" onClick={handleDirtyConfirmDiscard}>
                Descartar
              </Button>
              <Button variant="ghost" data-testid="dirty-cancel" onClick={() => setDirtyConfirm(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}

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
                configDraft={isIdle ? configDraft : undefined}
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
