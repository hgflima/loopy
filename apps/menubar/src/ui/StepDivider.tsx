/**
 * StepDivider — hairline + centered pill separating transcript segments.
 *
 * Shared by StreamPanel and CardDetail (both render cross-step transcripts).
 */
import { memo } from "react";
import "./StepDivider.css";

export const StepDivider = memo(function StepDivider({
  label,
}: {
  readonly label: string;
}) {
  return (
    <div className="step-divider" aria-hidden="true">
      <span className="step-divider__pill t-label">{label}</span>
    </div>
  );
});
