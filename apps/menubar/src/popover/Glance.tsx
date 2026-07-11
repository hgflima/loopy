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

import { useEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { BridgeState } from "../state/store-bridge";
import { Button, StatusDot, Pill } from "../ui";
import "./Glance.css";

interface GlanceProps {
  state: BridgeState;
  yesFlag: boolean;
}

/** Drop focus off any control so no resting `:focus-visible` ring shows. */
function dropControlFocus(): void {
  const el = document.activeElement;
  if (el instanceof HTMLElement && el.classList.contains("btn")) {
    el.blur();
  }
}

export function Glance({ state, yesFlag }: GlanceProps) {
  const { store, ui } = state;
  const cardRef = useRef<HTMLDivElement>(null);

  // Native-popover chrome, applied only inside the Tauri popover window:
  //  1. Size the panel to its content — the backend sizes it via the panel's
  //     synchronous `setContentSize:` (see panel.rs `resize_popover`), so the
  //     vibrant card hugs its content instead of standing tall. Re-measured on
  //     open (window `focus`) and on any content change (`ResizeObserver`), so a
  //     run starting while the popover is open re-fits it live.
  //  2. Drop the resting magenta focus ring: the panel grabs key focus on open
  //     and the webview auto-focuses the primary button. The rAF pass covers the
  //     auto-focus that lands a frame later; a real keyboard Tab still rings.
  useEffect(() => {
    if (!isTauri()) return;
    const card = cardRef.current;
    if (!card) return;
    let raf = 0;
    const syncHeight = () => {
      const height = Math.ceil(card.getBoundingClientRect().height);
      if (height > 0) invoke("resize_popover", { height }).catch(() => {});
    };
    const scheduleSync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(syncHeight);
    };
    const onFocus = () => {
      dropControlFocus();
      requestAnimationFrame(dropControlFocus);
      scheduleSync();
    };
    const observer = new ResizeObserver(scheduleSync);
    observer.observe(card);
    syncHeight();
    window.addEventListener("focus", onFocus);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const total = store.tasks.length;
  const done = store.tasks.filter((t) => t.status === "done").length;
  const running = store.tasks.filter((t) => t.status === "running").length;
  const warnings = ui.pendingApprovals.length;

  const isRunning = ui.runStatus === "running";
  const isIdle = ui.runStatus === "idle";

  return (
    <div className="glance t-body" ref={cardRef}>
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
