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
import { StatusDot, type Tone } from "../ui";
import "./Banner.css";

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

/** start-fail is a hard failure (red); death-mid-run reads as interrupted (amber). */
const TONE: Record<BannerData["type"], Tone> = {
  "start-fail": "failed",
  "death-mid-run": "blocked",
};

export function Banner({ ui }: BannerProps) {
  const info = bannerInfo(ui);
  if (!info) return null;

  const tone = TONE[info.type];

  return (
    <section className={`banner banner--${tone}`} role="alert">
      <header className="banner__headline">
        <StatusDot tone={tone} label={info.type} />
        <span className="t-title">{info.headline}</span>
      </header>

      {info.stderrTail.length > 0 && (
        <pre className="banner__stderr t-data">{info.stderrTail.join("\n")}</pre>
      )}
    </section>
  );
}
