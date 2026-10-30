import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { BridgeState } from "./state/store-bridge";
import type { TaskStatus } from "loopy/tui/store";
import { ViewSwitcher } from "./panes/ViewSwitcher";
import { StreamPanel } from "./panes/StreamPanel";
import { Banner } from "./panes/Banner";
import { headApproval } from "./panes/ApprovalPrompt";
import { CardDetail } from "./kanban/CardDetail";
import { StepEditor } from "./config/StepEditor";
import { useStreamHeight } from "./panes/useStreamHeight";
import { fractionToPercent } from "./panes/resize-helpers";
import { useConfigDraft } from "./config/useConfigDraft";
import { configToStore } from "./config/configToStore";
import {
  addStep as addStepPure,
  removeStep as removeStepPure,
  reorderStep as reorderStepPure,
  orphanRefs as computeOrphanRefs,
} from "./config/pipeline-edit";
import {
  isRunActive,
  normalizeDir,
  planLaunchArgs,
  type LaunchArgs,
  type LaunchArgsSource,
} from "./state/launch-args";
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

/**
 * Launch argv from the Rust side (C-0020 / E2+E3): the initial argv is *pulled*
 * once (`take_launch_args`), later instances are *pushed* (`launch-args`).
 */
const TAURI_LAUNCH_ARGS: LaunchArgsSource = {
  take: () => invoke<LaunchArgs | null>("take_launch_args"),
  subscribe: (onArgs) => listen<LaunchArgs>("launch-args", (e) => onArgs(e.payload)),
};

interface AppProps {
  state: BridgeState;
  /** `dir` is the target repo; `flags` are CLI-only (never written to loopy.yml). */
  onStartRun: (dir: string, flags: LaunchFlags) => void;
  onApprovalDecision?: (requestId: string, approved: boolean) => void;
  /** Where launch argv comes from; defaults to Tauri (none in dev:web). */
  launchArgsSource?: LaunchArgsSource | null;
  /** Leave a finished Run's board and return to idle (a launch argv asks for it). */
  onDismissRun?: () => void;
}

/** Run-level status → the header pill tone + label. */
const RUN_PILL: Record<BridgeState["ui"]["runStatus"], { tone: Tone; label: string }> = {
  idle: { tone: "neutral", label: "Idle" },
  starting: { tone: "running", label: "Iniciando" },
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

function App({
  state,
  onStartRun,
  onApprovalDecision,
  launchArgsSource = IS_TAURI ? TAURI_LAUNCH_ARGS : null,
  onDismissRun,
}: AppProps) {
  const { store, ui } = state;
  const isIdle = ui.runStatus === "idle";
  // `starting` counts: the Run exists from the click on Iniciar (C-0021 / B2).
  const isRunning = isRunActive(ui.runStatus);
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
  // `forRun`: the load precedes a `--run` — the dialog says so (C-0021 / B3).
  const [dirtyConfirm, setDirtyConfirm] = useState<{ dir: string; forRun: boolean } | null>(null);

  // --- Launch argv (C-0020 / T-013) --------------------------------------
  // `--run` waiting for its dir's loopy.yml to load (`loaded`), then canStart.
  const [pendingStart, setPendingStart] = useState<{ dir: string; loaded: boolean } | null>(null);
  // Argv received while a Run is active: held (with `run` dropped) until it ends.
  const [deferredLaunch, setDeferredLaunch] = useState<LaunchArgs | null>(null);
  const [launchWarning, setLaunchWarning] = useState<string | null>(null);

  // Load persisted dir on mount (same source as the old LaunchConfig), then
  // apply the initial launch argv on top of it.
  useEffect(() => {
    let persisted: Promise<void>;
    if (!IS_TAURI) {
      // dev:web — useConfigDraft auto-loads the sample
      setDir("/sample");
      persisted = Promise.resolve();
    } else {
      persisted = invoke<{ dir: string; yes?: boolean; task_id?: string; verbose?: boolean }>("load_launch_config")
        .then((cfg) => {
          if (cfg.yes) setFlagYes(cfg.yes);
          if (cfg.task_id) setFlagTaskId(cfg.task_id);
          if (cfg.verbose) setFlagVerbose(cfg.verbose);
          if (cfg.dir) {
            setDir(cfg.dir);
            return configDraft.load(cfg.dir);
          }
        })
        .catch(() => { /* defaults are fine */ });
    }
    if (!launchArgsSource) return;
    // Not cancelled on cleanup: `take` hands the argv out once, so under
    // StrictMode's double mount the first effect is the one that gets it.
    void persisted
      .then(() => launchArgsSource.take())
      .then((args) => {
        if (args) applyLaunchArgsRef.current(args);
      })
      .catch(() => { /* launched bare / not in Tauri */ });
  }, []);

  // Point the GUI at a dir and load its draft; a pending `--run` for that dir
  // learns the load finished.
  const loadDir = useCallback(
    (newDir: string) => {
      setDir(newDir);
      const target = newDir.trim();
      if (!target) return;
      void Promise.resolve(configDraft.load(target)).then(() =>
        setPendingStart((p) =>
          p && normalizeDir(p.dir) === normalizeDir(target) ? { ...p, loaded: true } : p,
        ),
      );
    },
    [configDraft.load],
  );

  // Switch dir through the dirty guard (shared by the user and the launch argv).
  const requestDir = useCallback(
    (newDir: string, forRun = false) => {
      if (configDraft.dirty) {
        setDirtyConfirm({ dir: newDir, forRun });
        return;
      }
      loadDir(newDir);
    },
    [configDraft.dirty, loadDir],
  );

  // Reload draft when the user changes dir (with dirty guard). A manual change
  // supersedes any `--run` still waiting.
  const handleDirChange = useCallback(
    (newDir: string) => {
      setPendingStart(null);
      requestDir(newDir);
    },
    [requestDir],
  );

  // Dirty guard resolution — shared "apply pending dir" logic
  const applyPendingDir = useCallback(
    (pendingDir: string) => {
      setDirtyConfirm(null);
      loadDir(pendingDir);
    },
    [loadDir],
  );

  // Cancel keeps the current dir and drops a `--run` waiting on the switch.
  const handleDirtyConfirmCancel = useCallback(() => {
    setDirtyConfirm(null);
    setPendingStart(null);
  }, []);

  const handleDirtyConfirmSave = useCallback(async () => {
    if (!dirtyConfirm) return;
    await configDraft.save();
    applyPendingDir(dirtyConfirm.dir);
  }, [dirtyConfirm, configDraft.save, applyPendingDir]);

  const handleDirtyConfirmDiscard = useCallback(() => {
    if (!dirtyConfirm) return;
    applyPendingDir(dirtyConfirm.dir);
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
    onStartRun(dir.trim(), flags);
  }, [canStart, dir, configDraft.dirty, configDraft.save, flagYes, flagTaskId, flagVerbose, onStartRun]);

  // Apply a launch argv (planner in state/launch-args.ts — pure, AD-6).
  const applyLaunchArgs = useCallback(
    (args: LaunchArgs) => {
      const actions = planLaunchArgs(args, { currentDir: dir, isRunning });
      const forRun = actions.some((a) => a.kind === "startAfterLoad");
      // The idle editor (dir input, Iniciar) only exists in idle: a finished
      // Run's board would swallow the switch/start silently.
      if (actions.length > 0 && ui.runStatus === "finished") onDismissRun?.();
      for (const action of actions) {
        switch (action.kind) {
          case "setFlags":
            if (action.flags.yes !== undefined) setFlagYes(action.flags.yes);
            if (action.flags.verbose !== undefined) setFlagVerbose(action.flags.verbose);
            if (action.flags.taskId !== undefined) setFlagTaskId(action.flags.taskId);
            break;
          case "switchDir":
          case "reloadDir":
            setPendingStart(null);
            requestDir(action.dir, forRun);
            break;
          case "startAfterLoad":
            // Always behind a (re)load: only `loadDir` marks it loaded.
            setPendingStart({ dir: action.dir, loaded: false });
            break;
          case "warnRunActive":
            setDeferredLaunch(action.deferred);
            setLaunchWarning(
              (action.dir
                ? `Um Run está em andamento — ${action.dir} será aberto quando ele terminar.`
                : "Um Run está em andamento — as flags de launch serão aplicadas quando ele terminar.") +
                (action.runIgnored ? " O --run foi ignorado: um Run por vez." : ""),
            );
            break;
        }
      }
    },
    [dir, isRunning, ui.runStatus, onDismissRun, requestDir],
  );
  // Latest closure for the mount-time `take` and the `launch-args` listener.
  const applyLaunchArgsRef = useRef(applyLaunchArgs);
  applyLaunchArgsRef.current = applyLaunchArgs;

  // Later instances (E3) forward their argv as the `launch-args` event.
  useEffect(() => {
    if (!launchArgsSource) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    launchArgsSource
      .subscribe((args) => applyLaunchArgsRef.current(args))
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => { /* not in Tauri */ });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [launchArgsSource]);

  // `--run` fires only after its dir's loopy.yml loaded, and only if it can start.
  useEffect(() => {
    if (!pendingStart?.loaded) return;
    setPendingStart(null);
    if (!isRunning && canStart && normalizeDir(dir) === normalizeDir(pendingStart.dir)) {
      void handleLaunch();
    }
  }, [pendingStart, isRunning, canStart, dir, handleLaunch]);

  // The Run ended: apply what arrived while it was active (never a `--run`).
  useEffect(() => {
    if (isRunning || !deferredLaunch) return;
    setDeferredLaunch(null);
    setLaunchWarning(null);
    applyLaunchArgsRef.current(deferredLaunch);
  }, [isRunning, deferredLaunch]);

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

  // Step editor state (idle only — T-011)
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const handleEditStep = useCallback((stepId: string) => {
    setEditingStepId((prev) => (prev === stepId ? null : stepId));
  }, []);
  const handleCloseStepEditor = useCallback(() => setEditingStepId(null), []);

  // Pipeline mutation handlers (idle only — T-012)
  const handleAddStep = useCallback(() => {
    if (!configDraft.draft) return;
    const next = addStepPure(configDraft.draft.pipeline, "agent");
    configDraft.patch("pipeline", next);
    // Open editor on the new step
    const newStep = next[next.length - 1];
    if (newStep) setEditingStepId(newStep.id);
  }, [configDraft]);

  const handleRemoveStep = useCallback(
    (stepId: string) => {
      if (!configDraft.draft) return;
      const next = removeStepPure(configDraft.draft.pipeline, stepId);
      configDraft.patch("pipeline", next);
      // Close editor if the removed step was being edited
      if (editingStepId === stepId) setEditingStepId(null);
    },
    [configDraft, editingStepId],
  );

  const handleReorderStep = useCallback(
    (from: number, to: number) => {
      if (!configDraft.draft) return;
      const next = reorderStepPure(configDraft.draft.pipeline, from, to);
      configDraft.patch("pipeline", next);
    },
    [configDraft],
  );

  // Orphan refs (T-012) — recomputed on every draft change
  const idleOrphanRefs = useMemo(
    () => (configDraft.draft ? computeOrphanRefs(configDraft.draft.pipeline) : []),
    [configDraft.draft],
  );

  // "Abrir o board" (D11, T-015): the Interview's saved screen repoints the board
  // at the just-written Change. Patch the three inputs.* to the new folder — one
  // path each, never a single `inputs` object (that would drop inputs.backlog).
  // `patch` operates on the raw draft and deep-clones, so backlog survives;
  // patching inputs.todo re-reads the new backlog. This dirties the global save
  // bar; disk changes only on Salvar (SC8). The view switch to Kanban lives in the
  // ViewSwitcher, which owns `view`.
  const handleOpenBoard = useCallback(
    (changeDir: string) => {
      const base = changeDir.replace(/\/+$/, "");
      configDraft.patch("inputs.spec", `${base}/spec.md`);
      configDraft.patch("inputs.plan", `${base}/plan.md`);
      configDraft.patch("inputs.todo", `${base}/todo.md`);
    },
    [configDraft],
  );

  // Stream height — draggable divider, persisted in localStorage (T-011).
  const streamHeight = useStreamHeight();

  // Gate auto-open (D6): pending approval forces the drawer to that card.
  const effectiveTaskId = currentApproval?.taskId ?? selectedTaskId;

  const effectiveTask = useMemo(
    () => (effectiveTaskId ? activeStore.tasks.find((t) => t.id === effectiveTaskId) : undefined),
    [effectiveTaskId, activeStore.tasks],
  );

  // Step editor drawer (idle only)
  const editingStepIndex =
    isIdle && editingStepId && configDraft.draft
      ? configDraft.draft.pipeline.findIndex((s) => s.id === editingStepId)
      : -1;
  const stepEditorElement =
    editingStepIndex >= 0 && configDraft.draft ? (
      <StepEditor
        stepIndex={editingStepIndex}
        configDraft={configDraft}
        stepIds={configDraft.draft.pipeline.map((s) => s.id)}
        onClose={handleCloseStepEditor}
        onRemoveStep={handleRemoveStep}
        dir={dir || undefined}
      />
    ) : null;

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <img className="app-header__logo app-header__logo--on-light" src={logoOnLight} alt="Loopy" />
          <img className="app-header__logo app-header__logo--on-dark" src={logoOnDark} alt="Loopy" />
          <Pill tone={runPill.tone} pulse={isRunning}>
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

      {launchWarning && (
        <section className="banner banner--blocked" role="status" data-testid="launch-warning">
          <header className="banner__headline">
            <span className="t-title">{launchWarning}</span>
            <Button variant="ghost" data-testid="launch-warning-dismiss" onClick={() => setLaunchWarning(null)}>
              OK
            </Button>
          </header>
        </section>
      )}

      {/* Dirty guard confirm dialog (R10) */}
      {dirtyConfirm && (
        <div className="dirty-confirm-overlay" data-testid="dirty-confirm">
          <div className="dirty-confirm" role="alertdialog" aria-label="Alterações não salvas">
            <p className="dirty-confirm__message">
              Há alterações não salvas no <code>loopy.yml</code>.
              {dirtyConfirm.forRun &&
                " Pediram para iniciar um Run: salve o rascunho ou descarte-o para rodar o arquivo em disco."}
            </p>
            <div className="dirty-confirm__actions">
              <Button variant="primary" data-testid="dirty-save" onClick={() => void handleDirtyConfirmSave()}>
                Salvar
              </Button>
              <Button variant="secondary" data-testid="dirty-discard" onClick={handleDirtyConfirmDiscard}>
                Descartar
              </Button>
              <Button variant="ghost" data-testid="dirty-cancel" onClick={handleDirtyConfirmCancel}>
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* The tab bar is always visible (D20) — never replaced by the EmptyState.
          Without a yml: Kanban/Deps/Insights degrade to their own empty, the
          Config tab hosts "criar a partir do template", and Specs works normally. */}
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
              concurrency={configDraft.draft?.concurrency}
              maxConcurrency={configDraft.draft?.max_concurrency}
              configDraft={isIdle ? configDraft : undefined}
              dir={dir || undefined}
              runActive={isRunning}
              onEditStep={isIdle ? handleEditStep : undefined}
              onAddStep={isIdle ? handleAddStep : undefined}
              onRemoveStep={isIdle ? handleRemoveStep : undefined}
              onReorderStep={isIdle ? handleReorderStep : undefined}
              orphanRefs={isIdle ? idleOrphanRefs : undefined}
              onOpenBoard={handleOpenBoard}
            />
            {/* The todo hint is about a present-but-empty backlog — only when a
                config actually loaded (idleStore synthesised), never on no-yml. */}
            {isIdle && idleStore != null && configDraft.tasks.length === 0 && (
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
        {stepEditorElement}
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
    </main>
  );
}

export default App;
