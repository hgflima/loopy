/**
 * Interview — the assembled Specs Interview flow (C-0018, ADR-0012, T-012).
 *
 * A **shell** (AD-6): it holds no flow logic of its own. The single source of
 * truth is {@link useInterviewProcess} (T-010), whose pure reducer (T-009) folds
 * every event — local (triage, describe, the gate) and process-driven (the
 * `interview://` control frames) — into one {@link InterviewState}. This
 * component only:
 *   1. renders the right T-011 component for the current `stage`, and
 *   2. wires the human's local gestures to `dispatch` and `start`.
 *
 * The flow it assembles (spec.md, "Fluxo, ponta a ponta"):
 *
 *   triage → describe → ┬ feature/other: spec Phase → gate → refine → gate →
 *                       │                 plan Phase → "✓ Salvo"
 *                       └ bug/debt: Handoff  (LOCAL — never spawns a process)
 *
 * **Triage and describe are local (D4):** no process is spawned until a Phase
 * begins, and the bug/debt trails never spawn one at all. The `dir` comes from
 * the header — the prototype's `PICK_FOLDER` does not exist here (D6).
 *
 * The demand the human types is **this shell's to deliver**: it rides the spawn
 * argv (`--demand`, via {@link buildInterviewArgs}) into the engine's turn-1
 * `/devy:spec <demand>`. Without that, `/devy:spec` would run bare and re-ask
 * what the describe stage already collected. Attachments the describe card
 * gathers do **not** travel yet: v1 has no byte channel from the webview to the
 * engine (a cross-task gap owned by the `loopy interview` transport, not this
 * shell), so only the demand text is wired.
 */

import { useEffect, useRef } from "react";
import type { Phase } from "loopy/tui/transport";
import type { StreamItem } from "loopy/tui/store";
import { Button, Pill } from "../ui";
import { useInterviewProcess } from "./useInterviewProcess";
import {
  gateOptions,
  trackOf,
  type GateChoice,
  type Track,
  type PendingQuestion,
} from "./interview-state";
import { QuestionCard } from "./QuestionCard";
import { PhaseGate } from "./PhaseGate";
import { WrittenFiles } from "./WrittenFiles";
import { ActivityLine } from "./ActivityLine";
import { Handoff } from "./Handoff";
import type { Attachment } from "./Attachable";
import "./specs.css";

// ---------------------------------------------------------------------------
// Static vocabulary — the labels are pt-BR, the keys stay English (repo rule)
// ---------------------------------------------------------------------------

/** One triage card. The `label` maps to a {@link Track} via {@link trackOf}. */
interface TriageCard {
  readonly label: string;
  readonly detail: string;
  readonly recommended?: boolean;
}

/**
 * The triage question "O que vamos desenvolver hoje?" (D24). "Nova feature" is
 * the single recommendation; "Outro tipo de demanda…" is the catch-all that
 * falls to the feature trail — the only trail that produces files, so routing
 * the unknown to the sterile hand-off would be the worst default.
 */
const TRIAGE: readonly TriageCard[] = [
  {
    label: "Nova feature",
    detail: "Vira spec, plan e todo — o caminho completo.",
    recommended: true,
  },
  {
    label: "Bug",
    detail: "Investigar um defeito. Termina num hand-off para o debug.",
  },
  {
    label: "Débito técnico",
    detail: "Registrar um débito técnico. Termina num hand-off.",
  },
  {
    label: "Outro tipo de demanda…",
    detail: "Na dúvida, seguimos pela trilha da feature.",
  },
];

/** The describe prompt, tuned to the chosen trail. */
const DESCRIBE_PROMPT: Readonly<Record<Track, string>> = {
  feature: "O que você quer construir?",
  bug: "Descreva o bug — o que acontece, e quando.",
  debt: "Descreva o débito técnico a registrar.",
};

/** pt-BR names for the three authoring phases. */
const PHASE_LABEL: Readonly<Record<Phase, string>> = {
  spec: "Especificação",
  refine: "Refinamento",
  plan: "Plano",
};

/** The phases in order, for the progress indicator. */
const PHASE_ORDER: readonly Phase[] = ["spec", "refine", "plan"];

// ---------------------------------------------------------------------------
// Pure helpers (AD-6)
// ---------------------------------------------------------------------------

/**
 * Derive the Change id (`C-XXXX`) from its dir (`.harn/devy/changes/C-XXXX-slug`)
 * for the `--change` flag. Falls back to the last path segment, then `undefined`
 * — a value at the boundary, never a throw.
 */
export function changeIdFromDir(changeDir: string | null): string | undefined {
  if (!changeDir) return undefined;
  const seg = changeDir.split("/").filter(Boolean).pop() ?? "";
  const match = seg.match(/^C-\d+/i);
  return match ? match[0] : seg || undefined;
}

/** Attachment chips carry no path yet; the engine writes them — lift the names. */
function attachmentNames(
  attachments?: readonly Attachment[],
): readonly string[] | undefined {
  if (!attachments || attachments.length === 0) return undefined;
  return attachments.map((a) => a.name);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Resume into an existing partial Change at a chosen Phase (D12/D13). */
export interface InterviewResume {
  readonly change: string;
  readonly phase: Phase;
  readonly changeDir?: string;
}

export interface InterviewProps {
  /** The project dir — the header's single source of truth (D6). */
  readonly dir: string;
  /** The probed agent preset (D16), supplied by the SpecsPane. */
  readonly agent?: string;
  /** The probed model (D18, best-effort). */
  readonly model?: string;
  /** The probed reasoning effort (D18, best-effort). */
  readonly effort?: string;
  /** When set, skip triage/describe and enter `resume.phase` directly (Continuar). */
  readonly resume?: InterviewResume;
  /** Close the Interview and return to the Specs list. */
  readonly onClose: () => void;
  /** "Abrir o board" at the saved screen — patches `inputs.*` in the draft (D11). */
  readonly onOpenBoard?: (changeDir: string) => void;
  /** Open a written file (passed through to the gate/saved screens). */
  readonly onOpenFile?: (path: string) => void;
}

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

export function Interview({
  dir,
  agent,
  model,
  effort,
  resume,
  onClose,
  onOpenBoard,
  onOpenFile,
}: InterviewProps) {
  const bridge = useInterviewProcess();
  const { state, dispatch, start, answer, wrapUp, cancel } = bridge;

  /** Spawn one Phase — the only place a process is born (D4). */
  function spawnPhase(phase: Phase, change?: string, demand?: string): void {
    // `buildInterviewArgs` drops falsy flags, so an omitted `change`/`demand`
    // yields no `--change`/`--demand` — passing undefined is identical, no
    // branch needed. Only the spec phase carries a demand (refine/plan re-read
    // the written `.md`).
    void start({ dir, phase, agent, model, effort, change, demand });
  }

  // Resume (D12/D13): a partial Change enters its chosen Phase on mount. Seed
  // the reducer so the Phase shows at once; the process's `phase_started`
  // confirms it. Guarded by a ref so React StrictMode's double-mount spawns once.
  const resumed = useRef(false);
  useEffect(() => {
    if (!resume || resumed.current) return;
    resumed.current = true;
    dispatch({
      kind: "phase_started",
      phase: resume.phase,
      command: "",
      ...(resume.changeDir !== undefined
        ? { changeDir: resume.changeDir }
        : {}),
    });
    // Spawn once, on mount — `resume` is a launch parameter, not reactive state.
    spawnPhase(resume.phase, resume.change);
  }, []);

  // --- Local gestures --------------------------------------------------------

  function chooseTriage(label: string): void {
    dispatch({ kind: "triaged", track: trackOf(label) });
  }

  function submitDemand(text: string): void {
    dispatch({ kind: "described", text });
    // feature/other begin the spec Phase, seeded with the demand (→ `--demand`
    // → `/devy:spec <demand>`); bug/debt stop at the local hand-off, spawning
    // nothing (the reducer routes both — this only mirrors the spawn). The
    // describe card's attachments are not forwarded (no byte channel yet — see
    // the module docstring).
    if (state.track === "feature") spawnPhase("spec", undefined, text);
  }

  function submitAnswer(
    text: string,
    attachments?: readonly Attachment[],
  ): void {
    if (!state.pending) return;
    answer(state.pending.questionId, text, attachmentNames(attachments));
  }

  function decideGate(next: GateChoice): void {
    // "Fechar" leaves the Change partial and returns to the list (D12).
    if (next === "close") {
      onClose();
      return;
    }
    dispatch({ kind: "gate_decision", next });
    spawnPhase(next, changeIdFromDir(state.changeDir));
  }

  function handleClose(): void {
    // A live Phase is torn down (interview_cancel); anything terminal just
    // leaves. Cancel erases nothing (D25) — a partial Change reappears in the list.
    if (state.stage === "phase") cancel();
    onClose();
  }

  // --- Render ----------------------------------------------------------------

  return (
    <div className="spec-flow">
      <div className="spec-flow__bar">
        <span className="spec-flow__title t-title">
          {state.changeDir ?? "Nova spec"}
        </span>
        <Button
          variant="ghost"
          className="spec-flow__close"
          aria-label="Voltar à lista"
          onClick={handleClose}
        >
          ✕
        </Button>
      </div>

      {state.warnings.length > 0 && (
        <ul className="spec-warnings" role="status">
          {state.warnings.map((w, i) => (
            <li className="spec-warning" key={i}>
              {w}
            </li>
          ))}
        </ul>
      )}

      <div className="spec-flow__body">{renderStage()}</div>
    </div>
  );

  function renderStage() {
    switch (state.stage) {
      case "triage":
        return <Triage onChoose={chooseTriage} />;

      case "describe":
        return (
          <QuestionCard
            key="describe"
            question={describeQuestion(state.track)}
            onAnswer={submitDemand}
          />
        );

      case "phase":
        return (
          <PhaseView
            phase={state.phase}
            pending={state.pending}
            activityLine={state.activityLine}
            transcript={state.transcript}
            wrappingUp={state.wrappingUp}
            onAnswer={submitAnswer}
            onWrapUp={wrapUp}
          />
        );

      case "gate":
        return (
          <PhaseGate
            phase={state.phase ?? "spec"}
            changeDir={state.changeDir}
            files={state.files}
            options={gateOptions(state)}
            onDecide={decideGate}
            onOpenFile={onOpenFile}
          />
        );

      case "handoff":
        return (
          <Handoff track={state.track ?? "bug"} demand={state.demand ?? ""} />
        );

      case "saved":
        return (
          <Saved
            changeDir={state.changeDir}
            files={state.files}
            onOpenBoard={onOpenBoard}
            onOpenFile={onOpenFile}
            onClose={onClose}
          />
        );

      case "failed":
        return (
          <Terminal
            title="A entrevista falhou"
            detail={state.failure}
            lines={bridge.stderrTail}
            onClose={onClose}
          />
        );

      case "closed":
      case "cancelled":
        return (
          <Terminal
            title="Entrevista encerrada"
            detail="O que foi gravado ficou no disco; a Change reaparece na lista como parcial."
            onClose={onClose}
          />
        );
    }
  }
}

/** A synthetic open question for the describe stage (reuses QuestionCard's free-text path). */
function describeQuestion(track: Track | null): PendingQuestion {
  return {
    questionId: "describe",
    phase: "spec",
    prompt: DESCRIBE_PROMPT[track ?? "feature"],
  };
}

// ---------------------------------------------------------------------------
// Stage views (presentational — no flow logic)
// ---------------------------------------------------------------------------

/** Triage: "O que vamos desenvolver hoje?" — one recommendation, a catch-all (D24). */
function Triage({ onChoose }: { readonly onChoose: (label: string) => void }) {
  return (
    <div className="spec-card">
      <h2 className="spec-card__prompt t-headline">
        O que vamos desenvolver hoje?
      </h2>
      <div className="spec-options">
        {TRIAGE.map((t) => (
          <button
            key={t.label}
            type="button"
            className={`spec-option${t.recommended ? " is-recommended" : ""}`}
            onClick={() => onChoose(t.label)}
          >
            <span className="spec-option__head">
              <span className="spec-option__label">{t.label}</span>
              {t.recommended && (
                <Pill tone="accent" noDot>
                  RECOMENDADA
                </Pill>
              )}
            </span>
            <span className="spec-option__detail">{t.detail}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface PhaseViewProps {
  readonly phase: Phase | null;
  readonly pending: PendingQuestion | null;
  readonly activityLine: string | null;
  /** The running Phase's timeline — tool cards + prose, in arrival order (T-014). */
  readonly transcript: readonly StreamItem[];
  readonly wrappingUp: boolean;
  readonly onAnswer: (
    text: string,
    attachments?: readonly Attachment[],
  ) => void;
  readonly onWrapUp: () => void;
}

/** The stepper class for phase index `i` relative to the `current` one. */
function phaseStepClass(i: number, current: number): string {
  if (i === current) return "spec-phase-step is-current";
  if (i < current) return "spec-phase-step is-done";
  return "spec-phase-step";
}

/**
 * A running Phase: the progress indicator + the always-visible "Chega" button
 * (D17), then either the pending question (QuestionCard) or the live activity
 * line (ActivityLine — proof of life, since the spike saw ~5 min to turn 1).
 */
function PhaseView({
  phase,
  pending,
  activityLine,
  transcript,
  wrappingUp,
  onAnswer,
  onWrapUp,
}: PhaseViewProps) {
  const current = phase ? PHASE_ORDER.indexOf(phase) : -1;
  return (
    <div className="spec-phase-view">
      <div className="spec-phasebar">
        <ol className="spec-phases">
          {PHASE_ORDER.map((p, i) => (
            <li key={p} className={phaseStepClass(i, current)}>
              {PHASE_LABEL[p]}
            </li>
          ))}
        </ol>
        {/* Always visible (D17): the human is the ceiling — no counter, no config. */}
        <Button variant="secondary" disabled={wrappingUp} onClick={onWrapUp}>
          Chega, grave o que temos
        </Button>
      </div>

      {pending ? (
        <QuestionCard
          key={pending.questionId}
          question={pending}
          onAnswer={onAnswer}
        />
      ) : (
        <ActivityLine line={activityLine} transcript={transcript} busy />
      )}
    </div>
  );
}

interface SavedProps {
  readonly changeDir: string | null;
  readonly files: readonly string[];
  readonly onOpenBoard?: (changeDir: string) => void;
  readonly onOpenFile?: (path: string) => void;
  readonly onClose: () => void;
}

/** The "✓ Salvo" screen — the written Change plus "Abrir o board" (D11). */
function Saved({
  changeDir,
  files,
  onOpenBoard,
  onOpenFile,
  onClose,
}: SavedProps) {
  return (
    <div className="spec-gate">
      <div className="spec-gate__summary">
        <p className="spec-gate__title t-title">
          <span className="spec-gate__check" aria-hidden="true">
            ✓
          </span>
          Salvo
        </p>
        <WrittenFiles
          changeDir={changeDir}
          files={files}
          onOpenFile={onOpenFile}
        />
      </div>

      <div className="spec-gate__actions">
        {onOpenBoard && changeDir && (
          <Button variant="primary" onClick={() => onOpenBoard(changeDir)}>
            Abrir o board
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      </div>
    </div>
  );
}

interface TerminalProps {
  readonly title: string;
  readonly detail?: string | null;
  readonly lines?: readonly string[];
  readonly onClose: () => void;
}

/** A terminal note (failed / closed / cancelled) with a way back to the list. */
function Terminal({ title, detail, lines, onClose }: TerminalProps) {
  return (
    <div className="spec-terminal">
      <p className="spec-terminal__title t-title">{title}</p>
      {detail && <p className="spec-terminal__detail">{detail}</p>}
      {lines && lines.length > 0 && (
        <pre className="spec-terminal__log t-data">{lines.join("\n")}</pre>
      )}
      <div className="spec-actions">
        <Button variant="secondary" onClick={onClose}>
          Voltar à lista
        </Button>
      </div>
    </div>
  );
}
