/**
 * Glance — compact popover summary for the tray.
 *
 * Shows `done/total · running · ⚠ warnings` at a glance with two actions:
 * - **Abrir**: expand the full dashboard window (switches macOS identity to regular)
 * - **Parar**: stop the running sidecar
 */

import { invoke } from "@tauri-apps/api/core";
import type { BridgeState } from "../state/store-bridge";

interface GlanceProps {
  state: BridgeState;
  yesFlag: boolean;
}

export function Glance({ state, yesFlag }: GlanceProps) {
  const { store, ui } = state;

  const total = store.tasks.length;
  const done = store.tasks.filter((t) => t.status === "done").length;
  const running = store.tasks.filter((t) => t.status === "running").length;
  const warnings = ui.pendingApprovals.length;

  const isRunning = ui.runStatus === "running";
  const isIdle = ui.runStatus === "idle";

  return (
    <div
      style={{
        padding: "12px 16px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        fontSize: 13,
        userSelect: "none",
      }}
    >
      {/* Status line */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: "#333",
          marginBottom: 12,
        }}
      >
        {isIdle ? (
          <span style={{ color: "#999" }}>Nenhum run ativo</span>
        ) : (
          <>
            <span style={{ fontWeight: 600 }}>
              {done}/{total}
            </span>
            <span style={{ color: "#666" }}>·</span>
            <span style={{ color: running > 0 ? "cyan" : "#666" }}>
              {running} running
            </span>
            {warnings > 0 && (
              <>
                <span style={{ color: "#666" }}>·</span>
                <span style={{ color: "orange" }}>⚠ {warnings}</span>
              </>
            )}
          </>
        )}
      </div>

      {/* Delegation info */}
      {!isIdle && (
        <div
          style={{
            fontSize: 11,
            color: "#888",
            marginBottom: 8,
          }}
        >
          delegação: --yes {yesFlag ? "ON" : "OFF"} · {warnings} gate{warnings !== 1 ? "s" : ""}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => invoke("show_main_window")}
          style={{
            flex: 1,
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid #007AFF",
            background: "#007AFF",
            color: "#fff",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Abrir
        </button>
        <button
          onClick={() => invoke("stop_sidecar")}
          disabled={!isRunning}
          style={{
            flex: 1,
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid #ccc",
            background: isRunning ? "#fff" : "#f5f5f5",
            color: isRunning ? "#333" : "#999",
            fontSize: 13,
            cursor: isRunning ? "pointer" : "default",
          }}
        >
          Parar
        </button>
      </div>
    </div>
  );
}
