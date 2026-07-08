/**
 * LaunchConfig — configure and launch a Run.
 *
 * - Directory picker via `@tauri-apps/plugin-dialog` (text input fallback for dev:web).
 * - Toggles: `--yes` (default OFF, SC #6), `--verbose`.
 * - Text field: `--task <id>`.
 * - App **always** injects `--no-tui --emit-events`; `--dry-run` fora do v1.
 * - Persists last dir + flags via Rust `fs` (load on mount, save on start).
 * - "Iniciar Run" calls `start_sidecar`; relaunch kills the old sidecar (one Run at a time).
 */

import { useState, useEffect } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";

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
    <div style={{ padding: "24px 32px", maxWidth: 480, margin: "0 auto" }}>
      <h2 style={{ color: "#fff", fontSize: 16, marginBottom: 20, fontWeight: 600 }}>
        Configurar Run
      </h2>

      {/* Directory picker */}
      <label style={labelStyle}>Diretório-alvo</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          placeholder="/caminho/do/projeto"
          style={{ ...inputStyle, flex: 1 }}
        />
        {IS_TAURI && (
          <button onClick={pickDir} style={secondaryBtnStyle}>
            Escolher…
          </button>
        )}
      </div>

      {/* --task <id> */}
      <label style={labelStyle}>Task (opcional)</label>
      <input
        type="text"
        value={taskId}
        onChange={(e) => setTaskId(e.target.value)}
        placeholder="T-001"
        style={{ ...inputStyle, marginBottom: 16, width: "100%" }}
      />

      {/* Toggles */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        <label style={toggleRowStyle}>
          <input
            type="checkbox"
            checked={yes}
            onChange={(e) => setYes(e.target.checked)}
          />
          <span>--yes</span>
          <span style={hintStyle}>auto-aprovar gates</span>
        </label>
        <label style={toggleRowStyle}>
          <input
            type="checkbox"
            checked={verbose}
            onChange={(e) => setVerbose(e.target.checked)}
          />
          <span>--verbose</span>
          <span style={hintStyle}>saída detalhada</span>
        </label>
      </div>

      {/* Injected flags info */}
      <p style={{ fontSize: 11, color: "#666", marginBottom: 16 }}>
        Flags injetadas automaticamente: --no-tui --emit-events
      </p>

      {/* Error */}
      {error && (
        <p style={{ color: "#ff6b6b", fontSize: 12, marginBottom: 12 }}>{error}</p>
      )}

      {/* Start button */}
      <button
        onClick={handleStart}
        disabled={disabled}
        style={{
          ...primaryBtnStyle,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? "default" : "pointer",
        }}
      >
        {starting ? "Iniciando…" : "Iniciar Run"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "#999",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 4,
  border: "1px solid #333",
  background: "#1a1a2e",
  color: "#ccc",
  fontSize: 13,
  outline: "none",
};

const toggleRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  color: "#ccc",
  cursor: "pointer",
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#666",
};

const primaryBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 16px",
  borderRadius: 6,
  border: "none",
  background: "#2a4a7f",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 4,
  border: "1px solid #333",
  background: "#1a1a2e",
  color: "#ccc",
  fontSize: 13,
  cursor: "pointer",
};
