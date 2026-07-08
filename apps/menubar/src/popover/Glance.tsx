/**
 * Glance — compact popover summary for the tray.
 *
 * Shows `done/total · running · gates` at a glance with two actions:
 * - **Abrir**: expand the full dashboard window (accent primary)
 * - **Parar**: stop the running sidecar (secondary)
 *
 * Three states: idle (no run), running (progress), gate (pending approvals).
 * All styling via design system classes + tokens.css — zero inline colors.
 */

import { invoke } from "@tauri-apps/api/core";
import type { BridgeState } from "../state/store-bridge";
import { Button, StatusDot, Pill } from "../ui";
import "./Glance.css";

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
    <div className="glance t-body">
      {/* Status line */}
      <div className="glance__status">
        {isIdle ? (
          <span className="glance__idle">Nenhum run ativo</span>
        ) : (
          <>
            <span className="glance__progress">
              {done}/{total}
            </span>
            <span className="glance__sep">·</span>
            {running > 0 ? (
              <span className="glance__running">
                <StatusDot tone="running" pulse label={`${running} running`} />
                <span>{running} running</span>
              </span>
            ) : (
              <span className="u-muted">0 running</span>
            )}
            {warnings > 0 && (
              <>
                <span className="glance__sep">·</span>
                <Pill tone="accent">⚠ {warnings}</Pill>
              </>
            )}
          </>
        )}
      </div>

      {/* Delegation info */}
      {!isIdle && (
        <div className="glance__delegation t-label u-muted">
          delegação: --yes {yesFlag ? "ON" : "OFF"} · {warnings} gate
          {warnings !== 1 ? "s" : ""}
        </div>
      )}

      {/* Actions */}
      <div className="glance__actions">
        <Button variant="primary" onClick={() => invoke("show_main_window")}>
          Abrir
        </Button>
        <Button
          variant="secondary"
          onClick={() => invoke("stop_sidecar")}
          disabled={!isRunning}
        >
          Parar
        </Button>
      </div>
    </div>
  );
}
