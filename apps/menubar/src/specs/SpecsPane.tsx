/**
 * SpecsPane — the Specs tab (C-0018, ADR-0012, T-013).
 *
 * The shell of the fifth `ViewSwitcher` segment. It does four things and holds
 * no flow logic of its own (the Interview owns that — T-012):
 *
 *  1. **Lists the project's Changes** (`read_changes`, T-007), newest first,
 *     each with the state of its three `.md` and its task count.
 *  2. **Starts a fresh Interview** (`+ Nova spec`) or **resumes a partial one**
 *     at a chosen Phase (`Continuar` → the phase picker; D12/D13 — never re-enters
 *     `spec` implicitly, the human picks).
 *  3. **Discards** a Change with confirmation (`discard_change`, D21 — a move to
 *     `.loopy/trash/`, never a delete).
 *  4. **Selects the authoring agent + model + effort** (D16/D18) and persists the
 *     three keys to `launch-config.json`.
 *
 * **Only Claude in v1 (D16).** The agent select lists just the `claude` preset
 * (plus a `command`-custom entry the operator takes responsibility for): the
 * `/devy:*` commands are Claude Code's, so the adapter `if` lives **only here**,
 * never in the engine (`src/acp/catalog.ts` has no `if (agent === "claude")`).
 * The probe reuses C-0016 wholesale — `useAgentCapabilities` (by argv, per
 * `(agent, model)`), `SelectField`, `capOptions`/`ensureOption` — and degrades to
 * free-text when the probe fails, without corrupting a value already present.
 *
 * **Run-active warning (D22).** With a Run in progress the pane *warns and lets
 * the human decide* — it never blocks. The warning tells the truth: writing a
 * new Change dirties the parent, and with `require_clean_parent: true` that can
 * stop the Run at the next mark-done. This pane does **not** touch
 * `require_clean_parent` or `isParentClean` to paper over it.
 *
 * Works **without a `loopy.yml`** (D20) — authoring precedes the yml.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import type { Phase } from "loopy/tui/transport";
import { findAgentPreset } from "loopy/config";
import { CUSTOM_PRESET } from "../config/agent-source";
import { useAgentCapabilities } from "../config/useAgentCapabilities";
import { capOptions } from "../config/cap-options";
import {
  effortDisabledReason,
  effortHint,
  probeFallbackHint,
  type CapsSummary,
} from "../config/capability-hints";
import { SelectField, TextField } from "../config/fields";
import { Button, Pill } from "../ui";
import { Interview, type InterviewResume } from "./Interview";
import "./specs.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One Change summary, mirroring the Rust `ChangeSummary` (serde snake_case) that
 * `read_changes` returns (T-007). The engine — not this app — owns the
 * `.harn/devy/changes` address (plan AD-4), so this type carries `id`/`slug`,
 * never the resolved dir.
 */
export interface ChangeSummary {
  readonly id: string;
  readonly slug: string;
  readonly has_spec: boolean;
  readonly has_plan: boolean;
  readonly has_todo: boolean;
  readonly task_count: number;
  readonly done_count: number;
}

/** The launch-config shape this pane reads/writes (only the authoring keys matter here). */
interface LaunchConfigShape {
  readonly authoring_agent?: string;
  readonly authoring_model?: string;
  readonly authoring_effort?: string;
  readonly [key: string]: unknown;
}

export interface SpecsPaneProps {
  /** The project dir — the header's single source of truth (D6). Empty until picked. */
  readonly dir?: string;
  /** True while a Run is in progress (D22): the pane warns but never blocks. */
  readonly runActive?: boolean;
  /** "Abrir o board" at the Interview's saved screen — patches `inputs.*` (D11, T-015). */
  readonly onOpenBoard?: (changeDir: string) => void;
  /** Open a written file (passed through to the Interview). */
  readonly onOpenFile?: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Static vocabulary — pt-BR labels, English keys (repo rule)
// ---------------------------------------------------------------------------

/** pt-BR names for the three authoring phases. */
const PHASE_LABEL: Readonly<Record<Phase, string>> = {
  spec: "Especificação",
  refine: "Refinamento",
  plan: "Plano",
};

/** The three `.md` an Interview produces, in the order they appear. */
const MD_FLAGS: readonly {
  readonly key: "spec" | "plan" | "todo";
  readonly present: (c: ChangeSummary) => boolean;
}[] = [
  { key: "spec", present: (c) => c.has_spec },
  { key: "plan", present: (c) => c.has_plan },
  { key: "todo", present: (c) => c.has_todo },
];

// ---------------------------------------------------------------------------
// Pure helpers (AD-6)
// ---------------------------------------------------------------------------

/** A Change is complete once all three `.md` exist; anything less is partial. */
export function isComplete(c: ChangeSummary): boolean {
  return c.has_spec && c.has_plan && c.has_todo;
}

/**
 * The phases `Continuar` offers for a partial Change (D12/D13). With the spec
 * written, `refine` and `plan` remain (refine leaves no file, plan can re-run);
 * without even a spec, only `spec` is offerable. Never re-enters a phase
 * implicitly — the human picks from what is left.
 */
export function remainingPhases(c: ChangeSummary): readonly Phase[] {
  if (!c.has_spec) return ["spec"];
  return ["refine", "plan"];
}

/** The effective agent string from the two-part selector (preset vs custom). */
function effectiveAgentOf(preset: string, custom: string): string {
  return preset === CUSTOM_PRESET ? custom.trim() : "claude";
}

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

export function SpecsPane({
  dir,
  runActive,
  onOpenBoard,
  onOpenFile,
}: SpecsPaneProps) {
  const [changes, setChanges] = useState<readonly ChangeSummary[]>([]);

  // Authoring selection (D16/D18). `agentPreset` is the select value; a custom
  // preset reveals a free-text agent the operator assumes.
  const [agentPreset, setAgentPreset] = useState<string>("claude");
  const [agentCustom, setAgentCustom] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [effort, setEffort] = useState<string>("");

  // Flow: which Interview to mount (null = the list). `phasePick` holds the
  // Change whose remaining phases the picker is showing; `discardTarget`, the one
  // awaiting a discard confirmation.
  const [flow, setFlow] = useState<null | {
    readonly resume?: InterviewResume;
  }>(null);
  const [phasePick, setPhasePick] = useState<ChangeSummary | null>(null);
  const [discardTarget, setDiscardTarget] = useState<ChangeSummary | null>(
    null,
  );

  const effectiveAgent = effectiveAgentOf(agentPreset, agentCustom);
  const agentCommand =
    agentPreset === CUSTOM_PRESET
      ? undefined
      : findAgentPreset("claude")?.command;

  // Probe capabilities — by the resolved argv, keyed by (agent, model) (C-0016).
  const {
    status: probeStatus,
    caps,
    reason: probeReason,
  } = useAgentCapabilities(
    effectiveAgent || undefined,
    agentCommand,
    dir || undefined,
    model || undefined,
  );

  // --- Loads ----------------------------------------------------------------

  const reloadChanges = useCallback(async () => {
    if (!isTauri() || !dir) {
      setChanges([]);
      return;
    }
    try {
      setChanges(await invoke<ChangeSummary[]>("read_changes", { dir }));
    } catch {
      // Absent/unreadable → empty list, not an error (same discipline as the Rust side).
      setChanges([]);
    }
  }, [dir]);

  useEffect(() => {
    void reloadChanges();
  }, [reloadChanges]);

  // Seed the authoring selection from launch-config.json on mount.
  useEffect(() => {
    if (!isTauri()) return;
    invoke<LaunchConfigShape>("load_launch_config")
      .then((cfg) => {
        const a = cfg.authoring_agent ?? "";
        if (a && a !== "claude") {
          setAgentPreset(CUSTOM_PRESET);
          setAgentCustom(a);
        }
        setModel(cfg.authoring_model ?? "");
        setEffort(cfg.authoring_effort ?? "");
      })
      .catch(() => {
        /* defaults are fine */
      });
  }, []);

  // --- Persistence (D18) ----------------------------------------------------

  /**
   * Persist the three authoring keys, re-reading the current config first so
   * dir/flags written by the App are preserved. Best-effort — a write failure
   * must never block authoring.
   */
  const persist = useCallback(async (a: string, m: string, e: string) => {
    if (!isTauri()) return;
    try {
      const cur = await invoke<LaunchConfigShape>("load_launch_config");
      await invoke("save_launch_config", {
        config: {
          ...cur,
          authoring_agent: a,
          authoring_model: m,
          authoring_effort: e,
        },
      });
    } catch {
      /* persisting is a convenience, not a precondition */
    }
  }, []);

  function changeAgentPreset(v: string): void {
    const preset = v === CUSTOM_PRESET ? CUSTOM_PRESET : "claude";
    setAgentPreset(preset);
    // Switching adapter drops model/effort — they are dialect per-agent (D29).
    setModel("");
    setEffort("");
    void persist(effectiveAgentOf(preset, agentCustom), "", "");
  }

  function changeAgentCustom(v: string): void {
    setAgentCustom(v);
    void persist(effectiveAgentOf(CUSTOM_PRESET, v), model, effort);
  }

  function changeModel(v: string): void {
    setModel(v);
    void persist(effectiveAgent, v, effort);
  }

  function changeEffort(v: string): void {
    setEffort(v);
    void persist(effectiveAgent, model, v);
  }

  // --- Flow gestures --------------------------------------------------------

  function startNewSpec(): void {
    setFlow({});
  }

  function choosePhase(c: ChangeSummary, phase: Phase): void {
    setPhasePick(null);
    // The engine resolves the changeDir from `--change <id>` (AD-4), so the
    // resume carries id + phase only.
    setFlow({ resume: { change: c.id, phase } });
  }

  function closeInterview(): void {
    setFlow(null);
    // A finished/partial Change may have appeared or changed — refresh the list.
    void reloadChanges();
  }

  async function confirmDiscard(): Promise<void> {
    const target = discardTarget;
    if (!target) return;
    setDiscardTarget(null);
    if (!isTauri() || !dir) return;
    try {
      await invoke("discard_change", { dir, id: target.id });
    } catch {
      /* the row simply stays; the move never destroys anything (D21) */
    }
    void reloadChanges();
  }

  // --- Render ---------------------------------------------------------------

  if (flow) {
    return (
      <Interview
        dir={dir ?? ""}
        agent={effectiveAgent || undefined}
        model={model || undefined}
        effort={effort || undefined}
        resume={flow.resume}
        onClose={closeInterview}
        onOpenBoard={onOpenBoard}
        onOpenFile={onOpenFile}
      />
    );
  }

  return (
    <div className="specs-pane" data-testid="specs-pane">
      <div className="specs-pane__head">
        <div className="specs-pane__title-row">
          <h2 className="specs-pane__title t-title">Specs</h2>
          <Button
            variant="primary"
            onClick={startNewSpec}
            disabled={!dir}
            data-testid="new-spec"
          >
            + Nova spec
          </Button>
        </div>

        <AuthoringSelector
          agentPreset={agentPreset}
          agentCustom={agentCustom}
          model={model}
          effort={effort}
          probeStatus={probeStatus}
          probeReason={probeReason}
          caps={caps}
          onAgentPreset={changeAgentPreset}
          onAgentCustom={changeAgentCustom}
          onModel={changeModel}
          onEffort={changeEffort}
        />
      </div>

      {runActive && (
        <div
          className="specs-pane__warning"
          role="status"
          data-testid="run-active-warning"
        >
          <span className="specs-pane__warning-icon" aria-hidden="true">
            ⚠
          </span>
          <span>
            Há um Run em andamento. Gravar uma Change nova suja o parent e, com{" "}
            <code>require_clean_parent: true</code>, pode parar o Run no próximo
            mark-done. A escolha é sua.
          </span>
        </div>
      )}

      <ul className="specs-pane__list">
        {changes.length === 0 ? (
          <li className="specs-pane__empty t-label u-muted">
            Nenhuma Change ainda — comece uma nova spec acima.
          </li>
        ) : (
          changes.map((c) => (
            <ChangeRow
              key={c.id}
              change={c}
              onContinue={() => setPhasePick(c)}
              onDiscard={() => setDiscardTarget(c)}
            />
          ))
        )}
      </ul>

      {phasePick && (
        <PhasePicker
          change={phasePick}
          onChoose={(phase) => choosePhase(phasePick, phase)}
          onCancel={() => setPhasePick(null)}
        />
      )}

      {discardTarget && (
        <DiscardConfirm
          change={discardTarget}
          onConfirm={() => void confirmDiscard()}
          onCancel={() => setDiscardTarget(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The authoring selector (D16/D18) — reuses C-0016 wholesale
// ---------------------------------------------------------------------------

interface AuthoringSelectorProps {
  readonly agentPreset: string;
  readonly agentCustom: string;
  readonly model: string;
  readonly effort: string;
  readonly probeStatus: string;
  readonly probeReason?: string;
  readonly caps?: CapsSummary;
  readonly onAgentPreset: (v: string) => void;
  readonly onAgentCustom: (v: string) => void;
  readonly onModel: (v: string) => void;
  readonly onEffort: (v: string) => void;
}

function AuthoringSelector({
  agentPreset,
  agentCustom,
  model,
  effort,
  probeStatus,
  probeReason,
  caps,
  onAgentPreset,
  onAgentCustom,
  onModel,
  onEffort,
}: AuthoringSelectorProps) {
  const isCustom = agentPreset === CUSTOM_PRESET;

  // Probed selects are only offered once the probe resolved with capabilities;
  // otherwise every field degrades to free-text (D31). The option lists derive
  // straight from the probe + the current value, so they live with their use.
  const probeOk = probeStatus === "ok" && caps != null;
  const modelOptions = useMemo(
    () => (probeOk && caps ? capOptions(caps.models, model || undefined) : []),
    [probeOk, caps, model],
  );
  const effortOptions = useMemo(
    () => (probeOk && caps ? capOptions(caps.efforts, effort || undefined) : []),
    [probeOk, caps, effort],
  );
  const effortDisabled = probeOk && caps!.efforts.length === 0;

  return (
    <div className="specs-pane__authoring" data-testid="authoring-selector">
      {/* Only Claude in v1 (D16): the single claude preset + a custom escape. */}
      <SelectField
        label="agente"
        value={agentPreset}
        options={["claude", CUSTOM_PRESET]}
        onChange={onAgentPreset}
        renderOption={(id) =>
          id === CUSTOM_PRESET ? "Custom (assumido pelo operador)" : "Claude"
        }
        hint="Os /devy:* são do Claude Code — daí só Claude no v1."
      />
      {isCustom && (
        <TextField
          label="command"
          value={agentCustom}
          onChange={onAgentCustom}
          hint="Agente custom — você assume o adapter."
        />
      )}
      {/* model — probed select or free-text fallback (D31). */}
      {probeOk ? (
        <SelectField
          label="model"
          value={model}
          options={modelOptions}
          onChange={onModel}
          hint="Model ID (best-effort)"
        />
      ) : (
        <TextField
          label="model"
          value={model}
          onChange={onModel}
          hint={probeFallbackHint(
            probeStatus,
            probeReason,
            "Model ID (best-effort)",
          )}
        />
      )}
      {/* effort — probed select (disabled if unsupported) or free-text fallback. */}
      {probeOk ? (
        <SelectField
          label="effort"
          value={effort}
          options={effortDisabled ? [""] : effortOptions}
          onChange={onEffort}
          disabled={effortDisabled}
          disabledReason={
            caps ? effortDisabledReason(caps, model || undefined) : undefined
          }
          hint={effortDisabled ? undefined : effortHint(model || undefined)}
        />
      ) : (
        <TextField
          label="effort"
          value={effort}
          onChange={onEffort}
          hint={probeFallbackHint(
            probeStatus,
            probeReason,
            "Reasoning effort (best-effort)",
          )}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A Change row
// ---------------------------------------------------------------------------

interface ChangeRowProps {
  readonly change: ChangeSummary;
  readonly onContinue: () => void;
  readonly onDiscard: () => void;
}

function ChangeRow({ change: c, onContinue, onDiscard }: ChangeRowProps) {
  const complete = isComplete(c);
  return (
    <li className="specs-pane__row" data-testid={`change-${c.id}`}>
      <div className="specs-pane__row-main">
        <span className="specs-pane__row-id t-data">{c.id}</span>
        <span className="specs-pane__row-slug">{c.slug}</span>
      </div>

      <ul className="specs-pane__flags" aria-label="Arquivos gravados">
        {MD_FLAGS.map(({ key, present }) => {
          const on = present(c);
          return (
            <li
              key={key}
              className={`specs-pane__flag${on ? " is-present" : " is-absent"}`}
              data-testid={`flag-${key}`}
              data-present={on ? "true" : "false"}
              title={on ? `${key}.md gravado` : `${key}.md ausente`}
            >
              {key}
            </li>
          );
        })}
      </ul>

      <span className="specs-pane__count t-data" data-testid="task-count">
        {c.done_count}/{c.task_count}
        <span className="specs-pane__count-label t-label u-muted"> tasks</span>
      </span>

      <div className="specs-pane__row-actions">
        {complete ? (
          <Pill tone="done" noDot>
            completa
          </Pill>
        ) : (
          <Button variant="secondary" onClick={onContinue}>
            Continuar
          </Button>
        )}
        <Button variant="ghost" onClick={onDiscard}>
          Descartar
        </Button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// The phase picker (Continuar → D12/D13)
// ---------------------------------------------------------------------------

interface PhasePickerProps {
  readonly change: ChangeSummary;
  readonly onChoose: (phase: Phase) => void;
  readonly onCancel: () => void;
}

function PhasePicker({ change: c, onChoose, onCancel }: PhasePickerProps) {
  const phases = remainingPhases(c);
  return (
    <div
      className="specs-pane__overlay"
      role="dialog"
      aria-label="Continuar a Change"
    >
      <div className="specs-pane__dialog" data-testid="phase-picker">
        <p className="specs-pane__dialog-title t-title">
          Continuar {c.id} — em qual fase?
        </p>
        <div className="specs-pane__phase-options">
          {phases.map((phase) => (
            <button
              key={phase}
              type="button"
              className="specs-pane__phase-option"
              onClick={() => onChoose(phase)}
            >
              {PHASE_LABEL[phase]}
            </button>
          ))}
        </div>
        <div className="specs-pane__dialog-actions">
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The discard confirmation (D21)
// ---------------------------------------------------------------------------

interface DiscardConfirmProps {
  readonly change: ChangeSummary;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

function DiscardConfirm({
  change: c,
  onConfirm,
  onCancel,
}: DiscardConfirmProps) {
  return (
    <div
      className="specs-pane__overlay"
      role="alertdialog"
      aria-label="Descartar a Change"
    >
      <div className="specs-pane__dialog" data-testid="discard-confirm">
        <p className="specs-pane__dialog-title t-title">
          Descartar {c.id} — {c.slug}?
        </p>
        <p className="specs-pane__dialog-detail">
          A pasta vai para <code>.loopy/trash/</code> — reversível com um{" "}
          <code>mv</code>, nada é apagado.
        </p>
        <div className="specs-pane__dialog-actions">
          <Button variant="primary" onClick={onConfirm}>
            Descartar
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </div>
    </div>
  );
}
