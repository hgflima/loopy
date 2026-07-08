/**
 * Banner — sidecar failure overlay (T-018).
 *
 * Displays contextual error information when the sidecar process exits without
 * a clean `run_finished` control frame. Two scenarios:
 *
 * - **start-fail**: sidecar exited before `run_started` — the run never began.
 *   The user sees a banner with the failure reason and is returned to
 *   LaunchConfig (idle) state.
 *
 * - **death-mid-run**: sidecar exited after `run_started` — the run was
 *   interrupted. The last {@link StoreState} is frozen and remains visible;
 *   the banner overlays a diagnostic message.
 *
 * Both cases show the **tail of stderr** so the user can see why the sidecar
 * died. The app itself never crashes (refino #10).
 *
 * The pure data extraction ({@link bannerInfo}) is exported for testing (AD-6).
 */

import type { UIState } from "../state/store-bridge";

// ---------------------------------------------------------------------------
// Pure data extraction (AD-6)
// ---------------------------------------------------------------------------

export interface BannerData {
  readonly type: "start-fail" | "death-mid-run";
  readonly exitCode: number;
  readonly headline: string;
  readonly stderrTail: readonly string[];
}

/**
 * Extract banner display data from UI state, or `null` if no failure.
 */
export function bannerInfo(ui: UIState): BannerData | null {
  if (!ui.sidecarFailure) return null;

  const { type, exitCode } = ui.sidecarFailure;
  const headline =
    type === "start-fail"
      ? `Run não iniciou (exit ${exitCode})`
      : `Run encerrado (exit ${exitCode})`;

  return { type, exitCode, headline, stderrTail: ui.stderrTail };
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

interface BannerProps {
  readonly ui: UIState;
}

const PALETTE = {
  "start-fail": { border: "#e53e3e", bg: "#fff5f5", icon: "\u26D4" },
  "death-mid-run": { border: "#dd6b20", bg: "#fffaf0", icon: "\u26A0\uFE0F" },
} as const;

export function Banner({ ui }: BannerProps) {
  const info = bannerInfo(ui);
  if (!info) return null;

  const { border, bg, icon } = PALETTE[info.type];

  return (
    <section
      className={`banner banner--${info.type}`}
      role="alert"
      style={{
        padding: "0.75rem 1rem",
        borderLeft: `4px solid ${border}`,
        background: bg,
        marginBottom: "0.5rem",
      }}
    >
      <header className="banner__headline" style={{ fontWeight: "bold" }}>
        {icon} {info.headline}
      </header>

      {info.stderrTail.length > 0 && (
        <pre
          className="banner__stderr"
          style={{
            marginTop: "0.5rem",
            fontSize: "0.8rem",
            maxHeight: "12rem",
            overflow: "auto",
            whiteSpace: "pre-wrap",
            background: "#1a1a2e",
            color: "#e0e0e0",
            padding: "0.5rem",
            borderRadius: "4px",
          }}
        >
          {info.stderrTail.join("\n")}
        </pre>
      )}
    </section>
  );
}
