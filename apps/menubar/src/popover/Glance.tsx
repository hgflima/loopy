/**
 * Glance — the tray popover, styled and operated as a native macOS NSMenu
 * (C-0012). A glanceable status header (`done/total · running · ⚠`) sits above
 * the menu, preserving the "altitude of the glance"; below it, four items grouped
 * by separators:
 *
 *   [⤢] Abrir  → show_main_window
 *   [■] Parar  → stop_sidecar   (disabled while idle)
 *   ───────────
 *   [ⓘ] Sobre  → show_about_window
 *   [⏻] Sair   → quit_app
 *
 * Native-menu semantics: every activation closes the popover — Parar included
 * (its feedback comes from the tray badge/title, not a lingering menu). Esc
 * closes too. Both reuse the same order-out path the resign-key handler uses
 * (panel.rs `hide_popover_panel`). No resting highlight on open: rows are
 * `tabIndex=-1`, so the roving highlight only appears once the user presses ↑/↓.
 *
 * All styling via the design system + tokens.css — zero inline colors.
 */

import { useEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { BridgeState } from "../state/store-bridge";
import {
  StatusDot,
  Pill,
  Menu,
  MenuItem,
  MenuSeparator,
  IconOpen,
  IconStop,
  IconInfo,
  IconPower,
} from "../ui";
import "./Glance.css";

interface GlanceProps {
  state: BridgeState;
}

/** Drop focus off any menu row so no resting highlight shows when the popover
 *  opens — the roving highlight only appears once the user presses ↑/↓. */
function dropControlFocus(): void {
  const el = document.activeElement;
  if (el instanceof HTMLElement && el.getAttribute("role") === "menuitem") {
    el.blur();
  }
}

/** Close the popover like a native NSMenu: order the panel out via the same
 *  hide path the resign-key handler uses (panel.rs `hide_popover_panel` →
 *  `order_out`). Routed through the `hide_popover` command — not
 *  `Window.hide()`, which needs the `core:window:allow-hide` permission the app
 *  doesn't grant (and wouldn't reliably order a swizzled NSPanel out anyway).
 *  Every activation and Esc route through here. No-op outside Tauri (the
 *  dev:web preview and jsdom have no panel to hide). */
function closePopover(): void {
  if (!isTauri()) return;
  invoke("hide_popover").catch(() => {});
}

export function Glance({ state }: GlanceProps) {
  const { store, ui } = state;
  const cardRef = useRef<HTMLDivElement>(null);

  // Native-popover chrome, applied only inside the Tauri popover window:
  //  1. Size the panel to its content — the backend sizes it via the panel's
  //     synchronous `setContentSize:` (see panel.rs `resize_popover`), so the
  //     vibrant card hugs its content instead of standing tall. Re-measured on
  //     open (window `focus`) and on any content change (`ResizeObserver`), so a
  //     run starting while the popover is open re-fits it live.
  //  2. Drop the resting highlight: the panel grabs key focus on open. The rAF
  //     pass covers a focus that lands a frame later; a real keyboard ↑/↓ still
  //     lights the roving row.
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

  // Esc closes the popover, like a native menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePopover();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const total = store.tasks.length;
  const done = store.tasks.filter((t) => t.status === "done").length;
  const running = store.tasks.filter((t) => t.status === "running").length;
  const warnings = ui.pendingApprovals.length;

  const isRunning = ui.runStatus === "running";
  const isIdle = ui.runStatus === "idle";

  // Every activation invokes its command AND closes the popover (native menu
  // semantics) — Parar included.
  const runAndClose = (command: string) => () => {
    invoke(command).catch(() => {});
    closePopover();
  };

  return (
    <div className="glance t-body" ref={cardRef}>
      {/* Status header — the glanceable altitude above the menu */}
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

      {/* Menu — Abrir/Parar · Sobre/Sair, each with a monochrome icon */}
      <Menu ariaLabel="Ações">
        <MenuSeparator />
        <MenuItem icon={<IconOpen />} onSelect={runAndClose("show_main_window")}>
          Abrir
        </MenuItem>
        <MenuItem
          icon={<IconStop />}
          disabled={!isRunning}
          onSelect={runAndClose("stop_sidecar")}
        >
          Parar
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={<IconInfo />}
          onSelect={runAndClose("show_about_window")}
        >
          Sobre
        </MenuItem>
        <MenuItem icon={<IconPower />} onSelect={runAndClose("quit_app")}>
          Sair
        </MenuItem>
      </Menu>
    </div>
  );
}
