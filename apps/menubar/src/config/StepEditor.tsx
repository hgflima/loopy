/**
 * StepEditor — drawer to edit a single pipeline step (T-011, SC2/SC10/SC12).
 *
 * Opened by the ⋯ button in the Kanban column header.
 * Renders type-specific fields via the T-007 primitives, validates against the
 * draft's zod schema, and patches the configDraft on every change.
 *
 * Type migration (SC10): changing `type` via SelectField triggers a confirm
 * dialog (data loss warning), then applies `migrateStepType` and revalidates.
 *
 * Guard: on_fail in `agent` step requires `verify` OR `expect` — error from
 * the schema appears inline.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import type { StepConfig, StepType, AgentStep, ShellStep, ChecksStep, ApprovalStep } from "loopy/types";
import { agentCommandOf } from "./agent-source";
import type { AgentSource } from "./agent-source";
import type { ConfigDraftAPI, ConfigError } from "./useConfigDraft";
import { errorAt } from "./useConfigDraft";
import { migrateStepType } from "./pipeline-edit";
import { renameStepId } from "./rename";
import { useAgentCapabilities } from "./useAgentCapabilities";
import { effortDisabledReason } from "./capability-hints";
import {
  TextField,
  NumberField,
  SelectField,
  ToggleField,
  CommandListEditor,
} from "./fields";
import "./StepEditor.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StepEditorProps {
  /** Index of the step in `draft.pipeline[]`. */
  stepIndex: number;
  /** The config draft API (provides draft, errors, patch). */
  configDraft: ConfigDraftAPI;
  /** All step ids in the pipeline (for goto selects). */
  stepIds: readonly string[];
  /** Close the drawer. */
  onClose: () => void;
  /** Remove this step from the pipeline (idle only, T-012). */
  onRemoveStep?: (stepId: string) => void;
  /** Project directory — needed for the probe bridge (T-010). */
  dir?: string;
}

const STEP_TYPES: readonly StepType[] = ["agent", "shell", "checks", "approval"];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StepEditor({
  stepIndex,
  configDraft,
  stepIds,
  onClose,
  onRemoveStep,
  dir,
}: StepEditorProps) {
  const { draft, errors, patch } = configDraft;
  const step = draft?.pipeline[stepIndex] as StepConfig | undefined;

  // Type migration confirm state
  const [pendingType, setPendingType] = useState<StepType | null>(null);

  // Escape to close
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Error filtering for this step
  const basePath = `pipeline.${stepIndex}`;
  const stepErrors = useMemo(
    () => errorAt(errors, basePath),
    [errors, basePath],
  );

  const fieldError = useCallback(
    (field: string): string | undefined => {
      const path = `${basePath}.${field}`;
      const match = errors.find((e: ConfigError) => e.path === path);
      return match?.message;
    },
    [errors, basePath],
  );

  // Patch helper scoped to this step
  const patchStep = useCallback(
    (field: string, value: unknown) => {
      patch(`${basePath}.${field}`, value);
    },
    [patch, basePath],
  );

  // Type change handlers
  const handleTypeSelect = useCallback(
    (newType: StepType) => {
      if (!step || newType === step.type) return;
      setPendingType(newType);
    },
    [step],
  );

  const confirmTypeChange = useCallback(() => {
    if (!step || !pendingType) return;
    const migrated = migrateStepType(step, pendingType);
    // Replace entire step in the pipeline
    patch(`${basePath}`, migrated);
    setPendingType(null);
  }, [step, pendingType, patch, basePath]);

  const cancelTypeChange = useCallback(() => {
    setPendingType(null);
  }, []);

  if (!step) return null;

  // Goto options: all step ids except this one
  const gotoOptions = stepIds.filter((id) => id !== step.id);

  // on_fail value decomposition
  const onFailValue =
    step.on_fail === undefined || step.on_fail === "escalate"
      ? "escalate"
      : "goto";
  const onFailGotoTarget =
    typeof step.on_fail === "object" ? step.on_fail.goto : "";

  // on_success value decomposition
  const onSuccessGotoTarget =
    step.on_success ? step.on_success.goto : "";

  return (
    <aside className="step-editor" aria-label={`Editor for ${step.id}`} data-testid="step-editor">
      <header className="step-editor__header">
        <span className="step-editor__id t-data">{step.id}</span>
        <span className="step-editor__type t-label">{step.type}</span>
        {stepErrors.length > 0 && (
          <span className="step-editor__errors" data-testid="step-error-count">
            {stepErrors.length}
          </span>
        )}
        <span className="step-editor__spacer" />
        <button
          className="step-editor__close"
          onClick={onClose}
          aria-label="Close editor"
          type="button"
        >
          ✕
        </button>
      </header>

      <div className="step-editor__body">
        {/* Type selector + confirm */}
        <fieldset className="step-editor__section">
          <legend className="step-editor__legend">Type</legend>
          <SelectField
            label="type"
            value={step.type}
            options={STEP_TYPES}
            onChange={handleTypeSelect}
          />
          {pendingType && (
            <div className="step-editor__confirm" data-testid="type-confirm">
              <p className="step-editor__confirm-msg">
                Trocar para <strong>{pendingType}</strong> descartará os campos
                específicos de <strong>{step.type}</strong>. Continuar?
              </p>
              <div className="step-editor__confirm-actions">
                <button
                  type="button"
                  className="step-editor__confirm-btn step-editor__confirm-btn--cancel"
                  onClick={cancelTypeChange}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="step-editor__confirm-btn step-editor__confirm-btn--confirm"
                  onClick={confirmTypeChange}
                  data-testid="type-confirm-ok"
                >
                  Confirmar
                </button>
              </div>
            </div>
          )}
        </fieldset>

        {/* Base fields */}
        <fieldset className="step-editor__section">
          <legend className="step-editor__legend">Base</legend>
          <TextField
            label="id"
            value={step.id}
            onChange={(v) => {
              if (!draft || v === step.id) return;
              const result = renameStepId(draft, step.id, v);
              if (result.ok) {
                patch("pipeline", result.config.pipeline);
              } else {
                // Fall back to plain patch so zod shows the error inline
                patchStep("id", v);
              }
            }}
            error={fieldError("id")}
          />
          <ToggleField
            label="parallel_safe"
            value={step.parallel_safe ?? false}
            onChange={(v) => patchStep("parallel_safe", v)}
          />
          <ToggleField
            label="always"
            value={step.always ?? false}
            onChange={(v) => patchStep("always", v)}
          />
          <SelectField
            label="on_success.goto"
            value={onSuccessGotoTarget}
            options={["", ...gotoOptions]}
            onChange={(v) =>
              patchStep("on_success", v ? { goto: v } : undefined)
            }
            error={fieldError("on_success.goto")}
          />
          <SelectField
            label="on_fail"
            value={onFailValue}
            options={["escalate", "goto"] as const}
            onChange={(v) => {
              if (v === "escalate") {
                patchStep("on_fail", "escalate");
              } else {
                patchStep("on_fail", { goto: gotoOptions[0] ?? "" });
              }
            }}
            error={fieldError("on_fail")}
          />
          {onFailValue === "goto" && (
            <SelectField
              label="on_fail.goto"
              value={onFailGotoTarget}
              options={gotoOptions.length > 0 ? gotoOptions : [""]}
              onChange={(v) => patchStep("on_fail", { goto: v })}
              error={fieldError("on_fail.goto")}
            />
          )}
        </fieldset>

        {/* Type-specific fields */}
        {step.type === "agent" && (
          <AgentFields
            step={step}
            patchStep={patchStep}
            fieldError={fieldError}
            agents={draft?.agents}
            defaultAgentName={draft?.acp?.default_agent}
            dir={dir}
          />
        )}
        {step.type === "shell" && (
          <ShellFields
            step={step}
            patchStep={patchStep}
            fieldError={fieldError}
          />
        )}
        {step.type === "checks" && (
          <ChecksFields
            step={step}
            patchStep={patchStep}
            fieldError={fieldError}
          />
        )}
        {step.type === "approval" && (
          <ApprovalFields
            step={step}
            patchStep={patchStep}
            fieldError={fieldError}
          />
        )}

        {/* Remove step (T-012) */}
        {onRemoveStep && (
          <div className="step-editor__danger">
            <button
              type="button"
              className="step-editor__remove-btn"
              data-testid="remove-step-btn"
              onClick={() => {
                onRemoveStep(step.id);
                onClose();
              }}
            >
              Remove step
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Type-specific field sections
// ---------------------------------------------------------------------------

interface FieldSectionProps<S> {
  step: S;
  patchStep: (field: string, value: unknown) => void;
  fieldError: (field: string) => string | undefined;
}

// ---------------------------------------------------------------------------
// Agent fields — probed selects for agent/mode/model/effort (T-010)
// ---------------------------------------------------------------------------

interface AgentFieldsProps extends FieldSectionProps<AgentStep> {
  agents?: Readonly<Record<string, AgentSource>>;
  defaultAgentName?: string;
  dir?: string;
}

/**
 * Ensure the current value is present in the options list.
 * If not, prepend it — preserving unknown values that were already in the yml (D31).
 */
function ensureOption(
  options: readonly string[],
  currentValue: string | undefined,
): readonly string[] {
  if (!currentValue || currentValue === "" || options.includes(currentValue)) {
    return options;
  }
  return [currentValue, ...options];
}

/**
 * Options for a probed mode/model/effort select.
 *
 * There is **no placeholder option**: an omitted `mode`/`model`/`effort` is not
 * "no value" — it *is* the agent's default, so the select just sits on that
 * value. Offering both "default do agente: xhigh" and "xhigh" listed the same
 * outcome twice and left the reader guessing which one they were on.
 *
 * The empty option survives in exactly one case: the probe announced values but
 * couldn't name the inherited default, so something has to mean "don't override".
 */
function capOptions(
  values: readonly string[],
  current: string | undefined,
  inherited: string | undefined,
): readonly string[] {
  const withCurrent = ensureOption(values, current);
  if (!inherited) return ["", ...withCurrent];
  return ensureOption(withCurrent, inherited);
}

/**
 * Selecting the inherited default means "no override" — it clears the key
 * instead of writing a redundant one back into the yml.
 */
function capChange(
  inherited: string | undefined,
  apply: (value: string | undefined) => void,
): (value: string) => void {
  return (value) => apply(value && value !== inherited ? value : undefined);
}

/** Hint for the text-field fallback when the probe isn't "ok" yet. */
function probeFallbackHint(
  probeStatus: string,
  probeReason: string | undefined,
  defaultHint: string,
): string {
  if (probeStatus === "probing") return "Sondando capabilities…";
  if (probeStatus === "failed") return `Sondagem falhou: ${probeReason ?? "erro desconhecido"}`;
  return defaultHint;
}

function AgentFields({ step, patchStep, fieldError, agents, defaultAgentName, dir }: AgentFieldsProps) {
  const agentNames = useMemo(() => Object.keys(agents ?? {}), [agents]);
  const selectedAgent = step.agent ?? "";
  const resolvedAgentName = selectedAgent || defaultAgentName || agentNames[0] || "";
  const agentDef = resolvedAgentName ? agents?.[resolvedAgentName] : undefined;

  /**
   * O model que ESTE step roda — a mesma precedência do motor
   * (`step.model ?? registry[agent].model`). Entra na sondagem porque em
   * adapters como o OpenCode o effort é derivado do model (variants): sondar sem
   * ele responde "sem effort" para um agente que tem effort.
   */
  const effectiveModel = step.model ?? agentDef?.model;

  // Probe capabilities for the selected agent. A chave é o argv RESOLVIDO — um
  // agente por `preset` não tem `command` no yml, e o cache é keyed por argv+model.
  const { status: probeStatus, caps, reason: probeReason, probe } = useAgentCapabilities(
    resolvedAgentName || undefined,
    agentCommandOf(agentDef),
    dir,
    effectiveModel,
    agentDef?.env,
  );

  // Agent select: closed, keys from registry + "" for default (D26)
  const agentOptions = useMemo(() => ["", ...agentNames], [agentNames]);
  const renderAgentOption = useCallback(
    (opt: string) => {
      if (opt === "") {
        const name = defaultAgentName || agentNames[0];
        return name ? `(default: ${name})` : "(default)";
      }
      return opt;
    },
    [defaultAgentName, agentNames],
  );

  /**
   * What the step runs with when it declares no override.
   *
   * Precedence mirrors the engine: `step.model ?? registry[agent].model` (idem
   * effort) and, failing that, whatever the agent selected at `session/new`
   * (`currentValue`). `mode` has no registry level — and `acp.default_mode` is
   * inert in the engine (no reader), so it is deliberately NOT consulted here.
   */
  const inheritedMode = caps?.defaultMode;
  const inheritedModel = agentDef?.model ?? caps?.defaultModel;
  const inheritedEffort = agentDef?.effort ?? caps?.defaultEffort;

  // Mode/model/effort select options — include current value if unknown (D31)
  const modeOptions = useMemo(() => {
    if (probeStatus !== "ok" || !caps) return [];
    return capOptions(caps.modes, step.mode, inheritedMode);
  }, [probeStatus, caps, step.mode, inheritedMode]);

  const modelOptions = useMemo(() => {
    if (probeStatus !== "ok" || !caps) return [];
    return capOptions(caps.models, step.model, inheritedModel);
  }, [probeStatus, caps, step.model, inheritedModel]);

  const effortOptions = useMemo(() => {
    if (probeStatus !== "ok" || !caps) return [];
    return capOptions(caps.efforts, step.effort, inheritedEffort);
  }, [probeStatus, caps, step.effort, inheritedEffort]);

  const renderCapOption = useCallback(
    (knownValues: readonly string[]) =>
      (opt: string) => {
        // Only reachable when the probe couldn't name the inherited default.
        if (opt === "") return "default do agente";
        if (!knownValues.includes(opt)) return `${opt} (desconhecido)`;
        return opt;
      },
    [],
  );

  /**
   * Switching agent drops mode/model/effort (D29).
   *
   * The yml stores the agent's **literal dialect** and the engine never
   * translates it, so a value picked for the previous agent is meaningless for
   * the new one — it would linger as `"… (desconhecido)"` in the probed selects
   * and be sent verbatim to an agent that doesn't know it. Clearing the three
   * overrides makes the step inherit the chosen agent's defaults
   * (`registry[agent].model`/`.effort`, `acp.default_mode`).
   */
  const handleAgentChange = useCallback(
    (v: string) => {
      const next = v || undefined;
      if (next === step.agent) return;
      patchStep("agent", next);
      patchStep("mode", undefined);
      patchStep("model", undefined);
      patchStep("effort", undefined);
    },
    [patchStep, step.agent],
  );

  // Effort disabled when agent doesn't announce it
  const effortDisabled = probeStatus === "ok" && caps?.efforts.length === 0;

  // Fallback to text field when probe failed or still probing
  const useSelects = probeStatus === "ok" && caps != null;

  return (
    <fieldset className="step-editor__section">
      <legend className="step-editor__legend">Agent</legend>
      <TextField
        label="prompt"
        value={step.prompt}
        onChange={(v) => patchStep("prompt", v)}
        error={fieldError("prompt")}
      />
      <TextField
        label="retry_prompt"
        value={step.retry_prompt ?? ""}
        onChange={(v) => patchStep("retry_prompt", v || undefined)}
        error={fieldError("retry_prompt")}
      />
      {/* agent — closed select (D26) */}
      {agentNames.length > 0 ? (
        <SelectField
          label="agent"
          value={selectedAgent}
          options={agentOptions}
          onChange={handleAgentChange}
          error={fieldError("agent")}
          renderOption={renderAgentOption}
          hint="Agente no registry"
        />
      ) : (
        <TextField
          label="agent"
          value={selectedAgent}
          onChange={handleAgentChange}
          error={fieldError("agent")}
          hint="Nenhum agente no registry — adicione em Config > Agents"
        />
      )}
      <ToggleField
        label="clear_context"
        value={step.clear_context ?? true}
        onChange={(v) => patchStep("clear_context", v)}
      />
      {/* mode — probed select or text fallback (D30/D31) */}
      {useSelects ? (
        <SelectField
          label="mode"
          value={step.mode ?? inheritedMode ?? ""}
          options={modeOptions}
          onChange={capChange(inheritedMode, (v) => patchStep("mode", v))}
          error={fieldError("mode")}
          renderOption={renderCapOption(caps!.modes)}
          hint="ACP autonomy mode"
        />
      ) : (
        <TextField
          label="mode"
          value={step.mode ?? ""}
          onChange={(v) => patchStep("mode", v || undefined)}
          error={fieldError("mode")}
          hint={probeFallbackHint(probeStatus, probeReason, "ACP autonomy mode (e.g. acceptEdits, plan)")}
        />
      )}
      {/* model — probed select or text fallback */}
      {useSelects ? (
        <SelectField
          label="model"
          value={step.model ?? inheritedModel ?? ""}
          options={modelOptions}
          onChange={capChange(inheritedModel, (v) => patchStep("model", v))}
          error={fieldError("model")}
          renderOption={renderCapOption(caps!.models)}
          hint="Model override (best-effort)"
        />
      ) : (
        <TextField
          label="model"
          value={step.model ?? ""}
          onChange={(v) => patchStep("model", v || undefined)}
          error={fieldError("model")}
          hint={probeFallbackHint(probeStatus, probeReason, "Model override (best-effort)")}
        />
      )}
      {/* effort — probed select, disabled if unsupported, or text fallback */}
      {useSelects ? (
        <SelectField
          label="effort"
          value={effortDisabled ? "" : step.effort ?? inheritedEffort ?? ""}
          options={effortDisabled ? [""] : effortOptions}
          onChange={capChange(inheritedEffort, (v) => patchStep("effort", v))}
          error={fieldError("effort")}
          disabled={effortDisabled}
          disabledReason={effortDisabledReason(caps!, effectiveModel)}
          renderOption={effortDisabled ? undefined : renderCapOption(caps!.efforts)}
          hint={effortDisabled ? undefined : "Reasoning effort override (best-effort)"}
        />
      ) : (
        <TextField
          label="effort"
          value={step.effort ?? ""}
          onChange={(v) => patchStep("effort", v || undefined)}
          error={fieldError("effort")}
          hint={probeFallbackHint(probeStatus, probeReason, "Reasoning effort override (best-effort)")}
        />
      )}
      {/* Probe status indicator */}
      {probeStatus === "probing" && (
        <div className="step-editor__probe-status" data-testid="probe-status">Sondando capabilities de "{resolvedAgentName}"…</div>
      )}
      {probeStatus === "failed" && (
        <div className="step-editor__probe-status step-editor__probe-status--failed" data-testid="probe-failed">
          Sondagem falhou: {probeReason ?? "erro desconhecido"}.{" "}
          <button type="button" className="step-editor__probe-retry" onClick={probe}>Tentar novamente</button>
        </div>
      )}
      <TextField
        label="verify.run"
        value={step.verify?.run ?? ""}
        onChange={(v) =>
          patchStep("verify", v ? { run: v, max_attempts: step.verify?.max_attempts ?? 3 } : undefined)
        }
        error={fieldError("verify.run")}
        hint="Nome da lista de checks para verify"
      />
      {step.verify && (
        <NumberField
          label="verify.max_attempts"
          value={step.verify.max_attempts}
          onChange={(v) =>
            patchStep("verify", { ...step.verify, max_attempts: v })
          }
          error={fieldError("verify.max_attempts")}
          min={1}
          hint="Max tentativas do verify loop"
        />
      )}
      <TextField
        label="expect"
        value={step.expect ?? ""}
        onChange={(v) => patchStep("expect", v || undefined)}
        error={fieldError("expect")}
        hint="Verdict gate (e.g. AUDIT: PASS)"
      />
    </fieldset>
  );
}

function ShellFields({ step, patchStep, fieldError }: FieldSectionProps<ShellStep>) {
  return (
    <fieldset className="step-editor__section">
      <legend className="step-editor__legend">Shell</legend>
      <CommandListEditor
        label="run"
        value={[...step.run]}
        onChange={(v) => patchStep("run", v)}
        error={fieldError("run")}
      />
    </fieldset>
  );
}

function ChecksFields({ step, patchStep, fieldError }: FieldSectionProps<ChecksStep>) {
  return (
    <fieldset className="step-editor__section">
      <legend className="step-editor__legend">Checks</legend>
      <TextField
        label="run"
        value={step.run}
        onChange={(v) => patchStep("run", v)}
        error={fieldError("run")}
        hint="Nome da lista de checks (definida em checks:)"
      />
    </fieldset>
  );
}

function ApprovalFields({ step, patchStep, fieldError }: FieldSectionProps<ApprovalStep>) {
  return (
    <fieldset className="step-editor__section">
      <legend className="step-editor__legend">Approval</legend>
      <TextField
        label="prompt"
        value={step.prompt}
        onChange={(v) => patchStep("prompt", v)}
        error={fieldError("prompt")}
      />
      <CommandListEditor
        label="run"
        value={step.run ? [...step.run] : []}
        onChange={(v) => patchStep("run", v.length > 0 ? v : undefined)}
        error={fieldError("run")}
        optional
      />
    </fieldset>
  );
}
