/**
 * PlanBlock — the agent's plan for the current turn.
 *
 * A DUMB component: it paints the `PlanEntryState[]` it is handed. Each entry
 * carries a status (pending/in_progress/completed) and a priority (high/medium/
 * low). The status rides on a {@link StatusDot} in the existing state hues (so
 * a completed step is told apart by dot + strikethrough, not hue alone — the
 * Meaning-Only Rule), and the priority reads as a small pt-BR tag.
 *
 * Unknown status/priority values (the wire is untrusted) degrade gracefully —
 * status falls back to `pending`, priority prints its raw value — rather than
 * crashing the list.
 */
import { memo } from "react";
import type { PlanEntryState } from "loopy/tui/store";
import { StatusDot, type Tone } from "./StatusIndicator";
import "./StreamTimeline.css";

type PlanStatus = PlanEntryState["status"];
type PlanPriority = PlanEntryState["priority"];

interface PlanStatusMeta {
  readonly tone: Tone;
  readonly label: string;
  readonly hollow?: boolean;
  readonly pulse?: boolean;
}

/** The three plan statuses → a state tone + pt-BR label for the dot. */
const STATUS_META: Readonly<Record<PlanStatus, PlanStatusMeta>> = {
  pending: { tone: "neutral", label: "Pendente", hollow: true },
  in_progress: { tone: "running", label: "Em progresso", pulse: true },
  completed: { tone: "done", label: "Concluído" },
};

/** The three priorities → a pt-BR label. */
const PRIORITY_LABEL: Readonly<Record<PlanPriority, string>> = {
  high: "Alta",
  medium: "Média",
  low: "Baixa",
};

export interface PlanBlockProps {
  readonly entries: readonly PlanEntryState[];
}

export const PlanBlock = memo(function PlanBlock({ entries }: PlanBlockProps) {
  // The wire is untrusted (D3): a malformed `plan` update could carry a
  // non-array `entries`. A dumb block paints nothing rather than crashing the
  // whole timeline on `.map`.
  const list: readonly PlanEntryState[] = Array.isArray(entries) ? entries : [];
  return (
    <section className="plan-block">
      <header className="plan-block__header t-label">Plano</header>
      <ul className="plan-block__list">
        {list.map((entry, i) => {
          const status = STATUS_META[entry.status] ?? STATUS_META.pending;
          const priority = PRIORITY_LABEL[entry.priority] ?? entry.priority;
          return (
            <li
              key={i}
              className={`plan-block__entry plan-block__entry--${entry.status}`}
            >
              <StatusDot
                tone={status.tone}
                hollow={status.hollow}
                pulse={status.pulse}
                label={status.label}
              />
              <span className="plan-block__content t-body">
                {entry.content}
              </span>
              <span
                className={`plan-block__priority plan-block__priority--${entry.priority} t-label`}
              >
                {priority}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
});
