/**
 * PhaseGate — the human gate between Phases (D12).
 *
 * When a Phase reports `<loopy-done/>` the Interview stops and shows this: what
 * was written (the Change dir and its files), and the next step to take —
 * `Refinar`, `Ir direto ao plano`, or `Fechar`. Reading the spec before
 * refining, and being able to skip the most expensive Phase, is the whole point
 * of the gate (D12).
 *
 * The gate is a human decision point, so its primary advance action carries the
 * accent (interactive / human gate). `Fechar` — leaving the Change partial on
 * disk — stays a quiet ghost.
 */
import type { Phase } from "loopy/tui/transport";
import type { GateChoice, GateOption } from "./interview-state";
import { Button } from "../ui";
import { WrittenFiles } from "./WrittenFiles";
import "./specs.css";

/** pt-BR labels for the gate choices; the reducer deals only in English keys. */
const GATE_LABEL: Readonly<Record<GateChoice, string>> = {
  refine: "Refinar",
  plan: "Ir direto ao plano",
  close: "Fechar",
};

/** pt-BR names for the phase that just finished. */
const PHASE_LABEL: Readonly<Record<Phase, string>> = {
  spec: "Especificação",
  refine: "Refinamento",
  plan: "Plano",
};

interface PhaseGateProps {
  /** The Phase that just finished. */
  readonly phase: Phase;
  readonly changeDir: string | null;
  readonly files: readonly string[];
  /** The next-step choices (from `gateOptions(state)`). */
  readonly options: readonly GateOption[];
  readonly onDecide: (next: GateChoice) => void;
  /** When present, each file gets an "Abrir" affordance. */
  readonly onOpenFile?: (path: string) => void;
}

export function PhaseGate({
  phase,
  changeDir,
  files,
  options,
  onDecide,
  onOpenFile,
}: PhaseGateProps) {
  // The first advance choice (refine or plan) is the primary action; any later
  // advance is secondary; `close` is the quiet exit.
  const firstAdvance = options.findIndex((o) => o.next !== "close");

  return (
    <div className="spec-gate">
      <div className="spec-gate__summary">
        <p className="spec-gate__title t-title">
          <span className="spec-gate__check" aria-hidden="true">
            ✓
          </span>
          {PHASE_LABEL[phase]} gravada
        </p>
        <WrittenFiles
          changeDir={changeDir}
          files={files}
          onOpenFile={onOpenFile}
        />
      </div>

      <div className="spec-gate__actions">
        {options.map((o, i) => (
          <Button
            key={o.next}
            variant={
              o.next === "close"
                ? "ghost"
                : i === firstAdvance
                  ? "primary"
                  : "secondary"
            }
            onClick={() => onDecide(o.next)}
          >
            {GATE_LABEL[o.next]}
          </Button>
        ))}
      </div>
    </div>
  );
}
