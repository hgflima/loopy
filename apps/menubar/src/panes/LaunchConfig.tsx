/**
 * LaunchConfig — configure and launch a Run (idle-state surface of `main`).
 *
 * - Directory picker via `@tauri-apps/plugin-dialog` (text input fallback for dev:web).
 * - Toggles: `--yes` (default OFF, SC #6), `--verbose`.
 * - Text field: `--task <id>`.
 * - App **always** injects `--no-tui --emit-events`; `--dry-run` fora do v1.
 * - Persists last dir + flags via Rust `fs` (load on mount, save on start).
 * - "Iniciar Run" calls `start_sidecar`; relaunch kills the old sidecar (one Run at a time).
 *
 * Chrome is the shared design system (tokens.css + the Button vocabulary);
 * styling lives in LaunchConfig.css, so light/dark track the system.
 */

import { useState, useEffect } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { Button } from "../ui";
import "./LaunchConfig.css";

const IS_TAURI = isTauri();

interface LaunchConfigProps {
  onStart: (yesFlag: boolean) => void;
  /** True when the sidecar exited before `run_started` — re-enable the button for a retry. */
  startFailed?: boolean;
}

interface PersistedConfig {
  dir: string;
  yes: boolean;
  task_id: string;
  verbose: boolean;
}

export function LaunchConfig({ onStart, startFailed }: LaunchConfigProps) {
  const [dir, setDir] = useState("");
  const [yes, setYes] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [verbose, setVerbose] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedDir = dir.trim();
  const trimmedTaskId = taskId.trim();
  const disabled = !trimmedDir || starting;

  // A sidecar start-fail leaves `starting` stuck true (the component never
  // unmounts because runStatus stays "idle"). Re-enable the button so the
  // Banner's error is actionable — the user can fix and retry.
  useEffect(() => {
    if (startFailed) setStarting(false);
  }, [startFailed]);

  // Load persisted config on mount
  useEffect(() => {
    if (!IS_TAURI) return;
    invoke<PersistedConfig>("load_launch_config")
      .then((cfg) => {
        setDir(cfg.dir);
        setYes(cfg.yes);
        setTaskId(cfg.task_id);
        setVerbose(cfg.verbose);
      })
      .catch(() => {
        // Ignore — defaults are fine
      });
  }, []);

  async function pickDir() {
    if (!IS_TAURI) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setDir(selected);
    }
  }

  async function handleStart() {
    if (!trimmedDir) return;
    setStarting(true);
    setError(null);

    const flags: string[] = [];
    if (yes) flags.push("--yes");
    if (trimmedTaskId) flags.push("--task", trimmedTaskId);
    if (verbose) flags.push("--verbose");

    try {
      if (IS_TAURI) {
        await invoke("save_launch_config", {
          config: { dir: trimmedDir, yes, task_id: trimmedTaskId, verbose },
        });
        await invoke("start_sidecar", { dir: trimmedDir, flags });
      }
      onStart(yes);
    } catch (e) {
      setError(String(e));
      setStarting(false);
    }
  }

  return (
    <div className="launch">
      <div className="launch__panel">
        <h2 className="launch__title">Configurar Run</h2>
        <p className="launch__subtitle">
          O projeto precisa de um <code>loopy.yml</code> e um backlog (<code>todo.md</code>).
          O run executa cada task até o merge.
        </p>

        {/* Directory picker */}
        <div className="launch__field">
          <label className="launch__label" htmlFor="launch-dir">
            Diretório-alvo
          </label>
          <div className="launch__row">
            <input
              id="launch-dir"
              className="launch__input"
              type="text"
              value={dir}
              onChange={(e) => setDir(e.target.value)}
              placeholder="/caminho/do/projeto"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            {IS_TAURI && (
              <Button variant="secondary" onClick={pickDir}>
                Escolher…
              </Button>
            )}
          </div>
        </div>

        {/* --task <id> */}
        <div className="launch__field">
          <label className="launch__label" htmlFor="launch-task">
            Task (opcional)
          </label>
          <input
            id="launch-task"
            className="launch__input"
            type="text"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            placeholder="T-001"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </div>

        {/* Flag toggles — the ubiquitous flag names lead, the description follows */}
        <div className="launch__toggles">
          <label className="launch__toggle">
            <input
              className="launch__checkbox"
              type="checkbox"
              checked={yes}
              onChange={(e) => setYes(e.target.checked)}
            />
            <span className="launch__flag">--yes</span>
            <span className="launch__hint">auto-aprovar gates</span>
          </label>
          <label className="launch__toggle">
            <input
              className="launch__checkbox"
              type="checkbox"
              checked={verbose}
              onChange={(e) => setVerbose(e.target.checked)}
            />
            <span className="launch__flag">--verbose</span>
            <span className="launch__hint">saída detalhada</span>
          </label>
        </div>

        {/* Injected flags footnote */}
        <p className="launch__injected">
          Sempre injetadas: <code>--no-tui</code> <code>--emit-events</code>
        </p>

        {/* Local start error (save/spawn failure) */}
        {error && (
          <div className="launch__error" role="alert">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M8 4.8V8.6M8 11h.01"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Primary action */}
        <Button
          variant="primary"
          className="launch__submit"
          onClick={handleStart}
          disabled={disabled}
          aria-busy={starting}
        >
          {starting ? "Iniciando…" : "Iniciar Run"}
        </Button>
      </div>
    </div>
  );
}
