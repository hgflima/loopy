/**
 * ConfigPane — visual editor for top-level `loopy.yml` settings.
 *
 * Single scroll, each section a fieldset/card with title + error counter (R5).
 * T-008 wired workspace + concurrency. T-009 wires ALL remaining top-level
 * sections (SC4): agents, acp, inputs, checks, stop_conditions, policies,
 * logging, metrics. Pipeline is excluded (Kanban — R2).
 *
 * Error routing (R7): field→inline, section header→counter, cross-field→banner.
 *
 * Saving is NOT done here: edits also happen on the board (steps via the ⋯ drawer,
 * columns via add/remove/reorder), so the Save affordance is the global save bar in
 * the ViewSwitcher tab bar — visible from every tab. This pane only patches the
 * shared draft. Save stays fail-closed: blocked while any error exists (C4).
 */

import { useCallback, useMemo, useState } from "react";
import type { ConfigDraftAPI, ConfigError } from "./useConfigDraft";
import { errorAt } from "./useConfigDraft";
import { renameAgent, renameChecksList } from "./rename";
import {
  TextField,
  NumberField,
  SelectField,
  ToggleField,
  RecordEditor,
  CommandListEditor,
} from "./fields";
import "./ConfigPane.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfigPaneProps {
  configDraft: ConfigDraftAPI;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Paths that belong to a visible section. */
const SECTION_PREFIXES = [
  "workspace",
  "concurrency",
  "agents",
  "acp",
  "inputs",
  "checks",
  "stop_conditions",
  "policies",
  "logging",
  "metrics",
] as const;

/**
 * Cross-field errors: those whose path does NOT start with any visible section
 * prefix. These come from the schema's `superRefine` (e.g. agents×acp.command).
 */
function crossFieldErrors(errors: readonly ConfigError[]): readonly ConfigError[] {
  return errors.filter(
    (e) =>
      !SECTION_PREFIXES.some(
        (p) => e.path === p || e.path.startsWith(p + "."),
      ),
  );
}

// ---------------------------------------------------------------------------
// Section header with error counter (R5)
// ---------------------------------------------------------------------------

function SectionHeader({ title, errorCount }: { title: string; errorCount: number }) {
  return (
    <legend className="config-pane__legend">
      <span>{title}</span>
      {errorCount > 0 && (
        <span className="config-pane__error-count" aria-label={`${errorCount} erro${errorCount > 1 ? "s" : ""}`}>
          {errorCount}
        </span>
      )}
    </legend>
  );
}

// ---------------------------------------------------------------------------
// Agent entry sub-editor
// ---------------------------------------------------------------------------

interface AgentEntryProps {
  name: string;
  agent: { command: string[]; env?: Record<string, string>; model?: string; effort?: string; display_name?: string };
  onPatch: (subpath: string, value: unknown) => void;
  onRemove: () => void;
  onRename: (newName: string) => void;
  fieldError: (path: string) => string | undefined;
}

function AgentEntry({ name, agent, onPatch, onRemove, onRename, fieldError }: AgentEntryProps) {
  return (
    <div className="config-pane__agent-entry" data-testid={`agent-entry-${name}`}>
      <div className="config-pane__entry-header">
        <TextField
          label="name"
          value={name}
          onChange={(v) => { if (v && v !== name) onRename(v); }}
        />
        <button type="button" className="field__icon-btn field__icon-btn--danger" onClick={onRemove} aria-label={`Remove agent ${name}`}>×</button>
      </div>
      <CommandListEditor
        label="command"
        value={agent.command}
        onChange={(v) => onPatch("command", v)}
        error={fieldError("command")}
      />
      <RecordEditor
        label="env"
        value={agent.env ?? {}}
        onChange={(v) => onPatch("env", Object.keys(v).length > 0 ? v : undefined)}
        error={fieldError("env")}
        keyPlaceholder="VAR"
        valuePlaceholder="value"
      />
      <TextField
        label="model"
        value={agent.model ?? ""}
        onChange={(v) => onPatch("model", v || undefined)}
        error={fieldError("model")}
        hint="Model ID (best-effort)"
      />
      <TextField
        label="effort"
        value={agent.effort ?? ""}
        onChange={(v) => onPatch("effort", v || undefined)}
        error={fieldError("effort")}
        hint="Reasoning effort (best-effort)"
      />
      <TextField
        label="display_name"
        value={agent.display_name ?? ""}
        onChange={(v) => onPatch("display_name", v || undefined)}
        error={fieldError("display_name")}
        hint="Nome exibido na TUI"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Check group sub-editor
// ---------------------------------------------------------------------------

interface CheckGroupProps {
  groupName: string;
  commands: { name: string; run: string }[];
  onPatch: (value: { name: string; run: string }[]) => void;
  onRemove: () => void;
  onRename: (newName: string) => void;
}

function CheckGroup({ groupName, commands, onPatch, onRemove, onRename }: CheckGroupProps) {
  const items = commands.length > 0 ? commands : [{ name: "", run: "" }];

  function updateEntry(index: number, field: "name" | "run", val: string) {
    const next = items.map((item, i) => (i === index ? { ...item, [field]: val } : item));
    onPatch(next);
  }

  function addEntry() {
    onPatch([...items, { name: "", run: "" }]);
  }

  function removeEntry(index: number) {
    const next = items.filter((_, i) => i !== index);
    onPatch(next.length > 0 ? next : [{ name: "", run: "" }]);
  }

  return (
    <div className="config-pane__check-group" data-testid={`check-group-${groupName}`}>
      <div className="config-pane__entry-header">
        <TextField
          label="name"
          value={groupName}
          onChange={(v) => { if (v && v !== groupName) onRename(v); }}
        />
        <button type="button" className="field__icon-btn field__icon-btn--danger" onClick={onRemove} aria-label={`Remove check group ${groupName}`}>×</button>
      </div>
      {items.map((cmd, i) => (
        <div className="field__record-row" key={i}>
          <input
            className="field__record-key"
            type="text"
            value={cmd.name}
            onChange={(e) => updateEntry(i, "name", e.target.value)}
            placeholder="name"
            aria-label={`${groupName} check ${i + 1} name`}
          />
          <input
            className="field__record-val"
            type="text"
            value={cmd.run}
            onChange={(e) => updateEntry(i, "run", e.target.value)}
            placeholder="run"
            aria-label={`${groupName} check ${i + 1} run`}
          />
          <button type="button" className="field__icon-btn field__icon-btn--danger" onClick={() => removeEntry(i)} aria-label={`Remove check ${i + 1}`}>×</button>
        </div>
      ))}
      <button type="button" className="field__add-btn" onClick={addEntry}>+ Add check</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConfigPane({ configDraft }: ConfigPaneProps) {
  // Save lives in the ViewSwitcher tab bar (global save bar), not here — edits
  // also happen on the board (steps/columns), so the affordance must be shared.
  const { draft, errors, patch } = configDraft;

  // --- New agent / check group input state ---
  const [newAgentName, setNewAgentName] = useState("");
  const [newCheckGroupName, setNewCheckGroupName] = useState("");

  // Error counts per section — single pass
  const sectionErrors = useMemo(() => {
    const result: Record<string, readonly ConfigError[]> = {};
    for (const p of SECTION_PREFIXES) result[p] = errorAt(errors, p);
    return result;
  }, [errors]);
  const crossErrors = useMemo(() => crossFieldErrors(errors), [errors]);

  // Inline error helpers — exact path match only
  const fieldError = useCallback(
    (path: string): string | undefined => {
      const match = errors.find((e) => e.path === path);
      return match?.message;
    },
    [errors],
  );

  if (!draft) {
    return (
      <div className="config-pane" data-testid="config-pane">
        <p className="config-pane__empty">Nenhuma configuração carregada.</p>
      </div>
    );
  }

  // --- Agents helpers ---
  const agents = draft.agents ?? {};
  const agentNames = Object.keys(agents);

  function addAgent() {
    const name = newAgentName.trim();
    if (!name || agents[name]) return;
    patch("agents", { ...agents, [name]: { command: [""] } });
    setNewAgentName("");
  }

  function removeAgent(name: string) {
    const next = { ...agents };
    delete next[name];
    patch("agents", Object.keys(next).length > 0 ? next : undefined);
  }

  // --- Checks helpers ---
  const checks = draft.checks ?? {};
  const checkGroupNames = Object.keys(checks);

  function addCheckGroup() {
    const name = newCheckGroupName.trim();
    if (!name || checks[name]) return;
    patch("checks", { ...checks, [name]: [{ name: "", run: "" }] });
    setNewCheckGroupName("");
  }

  function removeCheckGroup(name: string) {
    const next = { ...checks };
    delete next[name];
    patch("checks", next);
  }

  // --- Metrics opt-in ---
  const metricsEnabled = draft.metrics !== undefined;

  return (
    <div className="config-pane" data-testid="config-pane">
      {/* Cross-field error banner (R7) */}
      {crossErrors.length > 0 && (
        <div className="config-pane__banner" role="alert" data-testid="config-banner">
          {crossErrors.map((e, i) => (
            <p key={i} className="config-pane__banner-msg">{e.message}</p>
          ))}
        </div>
      )}

      {/* Workspace section */}
      <fieldset className="config-pane__section" data-testid="section-workspace">
        <SectionHeader title="Workspace" errorCount={sectionErrors.workspace.length} />
        <TextField
          label="root"
          value={draft.workspace.root}
          onChange={(v) => patch("workspace.root", v)}
          error={fieldError("workspace.root")}
          hint="Caminho raiz do projeto-alvo"
          id="ws-root"
        />
        <TextField
          label="parent_branch"
          value={draft.workspace.parent_branch}
          onChange={(v) => patch("workspace.parent_branch", v)}
          error={fieldError("workspace.parent_branch")}
          hint="Branch destino dos merges"
          id="ws-parent-branch"
        />
        <TextField
          label="worktrees_dir"
          value={draft.workspace.worktrees_dir}
          onChange={(v) => patch("workspace.worktrees_dir", v)}
          error={fieldError("workspace.worktrees_dir")}
          hint="Diretório para os worktrees isolados"
          id="ws-worktrees-dir"
        />
      </fieldset>

      {/* Concurrency section */}
      <fieldset className="config-pane__section" data-testid="section-concurrency">
        <SectionHeader title="Concurrency" errorCount={sectionErrors.concurrency.length} />
        <NumberField
          label="concurrency"
          value={draft.concurrency}
          onChange={(v) => patch("concurrency", v)}
          error={fieldError("concurrency")}
          hint="Número máximo de tasks simultâneas"
          min={1}
          id="concurrency"
        />
      </fieldset>

      {/* Agents section */}
      <fieldset className="config-pane__section" data-testid="section-agents">
        <SectionHeader title="Agents" errorCount={sectionErrors.agents.length} />
        {agentNames.map((name) => (
          <AgentEntry
            key={name}
            name={name}
            agent={agents[name]!}
            onPatch={(subpath, value) => patch(`agents.${name}.${subpath}`, value)}
            onRemove={() => removeAgent(name)}
            onRename={(newName) => {
              const result = renameAgent(draft, name, newName);
              if (result.ok) {
                patch("agents", result.config.agents);
                patch("acp", result.config.acp);
                patch("pipeline", result.config.pipeline);
              }
            }}
            fieldError={(sub) => fieldError(`agents.${name}.${sub}`)}
          />
        ))}
        <div className="config-pane__add-row">
          <input
            type="text"
            value={newAgentName}
            onChange={(e) => setNewAgentName(e.target.value)}
            placeholder="agent name"
            aria-label="New agent name"
            className="field__record-key"
          />
          <button type="button" className="field__add-btn" onClick={addAgent}>+ Add agent</button>
        </div>
      </fieldset>

      {/* ACP section */}
      <fieldset className="config-pane__section" data-testid="section-acp">
        <SectionHeader title="ACP" errorCount={sectionErrors.acp.length} />
        {/*
          `acp.command` is the legacy single-agent path, mutually exclusive with
          the `agents:` registry (ADR-0006). When agents are configured it is
          dead config, so hide the field entirely — unless a stale value is still
          present (a conflicting config), in which case keep it visible and
          removable so the user can clear the conflict. Optional-mode lets the
          row be fully deleted (→ undefined), instead of a phantom empty row.
        */}
        {(agentNames.length === 0 || draft.acp.command !== undefined) && (
          <CommandListEditor
            label="command"
            value={draft.acp.command ?? []}
            onChange={(v) => patch("acp.command", v.length > 0 && v.some((s) => s !== "") ? v : undefined)}
            error={fieldError("acp.command")}
            placeholder="acp command"
            optional={agentNames.length > 0}
          />
        )}
        <TextField
          label="default_agent"
          value={draft.acp.default_agent ?? ""}
          onChange={(v) => patch("acp.default_agent", v || undefined)}
          error={fieldError("acp.default_agent")}
          hint="Agente padrão do registry"
        />
        <NumberField
          label="request_timeout_seconds"
          value={draft.acp.request_timeout_seconds}
          onChange={(v) => patch("acp.request_timeout_seconds", v)}
          error={fieldError("acp.request_timeout_seconds")}
          hint="Timeout em segundos"
          min={1}
        />
        <TextField
          label="default_mode"
          value={draft.acp.permissions.default_mode}
          onChange={(v) => patch("acp.permissions.default_mode", v)}
          error={fieldError("acp.permissions.default_mode")}
          hint="Modo de autonomia ACP (texto livre)"
        />
        <SelectField
          label="on_request"
          value={draft.acp.permissions.on_request}
          onChange={(v) => patch("acp.permissions.on_request", v)}
          options={["allow", "policy"] as const}
          error={fieldError("acp.permissions.on_request")}
        />
      </fieldset>

      {/* Inputs section */}
      <fieldset className="config-pane__section" data-testid="section-inputs">
        <SectionHeader title="Inputs" errorCount={sectionErrors.inputs.length} />
        <TextField
          label="spec"
          value={draft.inputs.spec}
          onChange={(v) => patch("inputs.spec", v)}
          error={fieldError("inputs.spec")}
          hint="Caminho do spec"
        />
        <TextField
          label="plan"
          value={draft.inputs.plan}
          onChange={(v) => patch("inputs.plan", v)}
          error={fieldError("inputs.plan")}
          hint="Caminho do plan"
        />
        <TextField
          label="todo"
          value={draft.inputs.todo}
          onChange={(v) => patch("inputs.todo", v)}
          error={fieldError("inputs.todo")}
          hint="Caminho do todo/backlog"
        />
        <TextField
          label="pending_marker"
          value={draft.inputs.backlog.pending_marker}
          onChange={(v) => patch("inputs.backlog.pending_marker", v)}
          error={fieldError("inputs.backlog.pending_marker")}
          hint="Marcador de task pendente"
        />
        <TextField
          label="done_marker"
          value={draft.inputs.backlog.done_marker}
          onChange={(v) => patch("inputs.backlog.done_marker", v)}
          error={fieldError("inputs.backlog.done_marker")}
          hint="Marcador de task concluída"
        />
        <TextField
          label="task_id_pattern"
          value={draft.inputs.backlog.task_id_pattern}
          onChange={(v) => patch("inputs.backlog.task_id_pattern", v)}
          error={fieldError("inputs.backlog.task_id_pattern")}
          hint="Regex para extrair ID da task"
        />
        <TextField
          label="deps_pattern"
          value={draft.inputs.backlog.deps_pattern ?? ""}
          onChange={(v) => patch("inputs.backlog.deps_pattern", v || undefined)}
          error={fieldError("inputs.backlog.deps_pattern")}
          hint="Regex para extrair dependências"
        />
        <SelectField
          label="body"
          value={draft.inputs.backlog.body}
          onChange={(v) => patch("inputs.backlog.body", v)}
          options={["indented"] as const}
          error={fieldError("inputs.backlog.body")}
        />
        <ToggleField
          label="mark_done_on_success"
          value={draft.inputs.backlog.mark_done_on_success}
          onChange={(v) => patch("inputs.backlog.mark_done_on_success", v)}
          error={fieldError("inputs.backlog.mark_done_on_success")}
          hint="Marcar task como done ao concluir com sucesso"
        />
      </fieldset>

      {/* Checks section */}
      <fieldset className="config-pane__section" data-testid="section-checks">
        <SectionHeader title="Checks" errorCount={sectionErrors.checks.length} />
        {checkGroupNames.map((name) => (
          <CheckGroup
            key={name}
            groupName={name}
            commands={checks[name]!}
            onPatch={(value) => patch(`checks.${name}`, value)}
            onRemove={() => removeCheckGroup(name)}
            onRename={(newName) => {
              const result = renameChecksList(draft, name, newName);
              if (result.ok) {
                patch("checks", result.config.checks);
                patch("pipeline", result.config.pipeline);
              }
            }}
          />
        ))}
        <div className="config-pane__add-row">
          <input
            type="text"
            value={newCheckGroupName}
            onChange={(e) => setNewCheckGroupName(e.target.value)}
            placeholder="group name"
            aria-label="New check group name"
            className="field__record-key"
          />
          <button type="button" className="field__add-btn" onClick={addCheckGroup}>+ Add check group</button>
        </div>
      </fieldset>

      {/* Stop Conditions section */}
      <fieldset className="config-pane__section" data-testid="section-stop_conditions">
        <SectionHeader title="Stop Conditions" errorCount={sectionErrors.stop_conditions.length} />
        <NumberField
          label="max_iterations"
          value={draft.stop_conditions.max_iterations}
          onChange={(v) => patch("stop_conditions.max_iterations", v)}
          error={fieldError("stop_conditions.max_iterations")}
          hint="Máximo de tasks iniciadas"
          min={1}
        />
        <NumberField
          label="max_step_visits"
          value={draft.stop_conditions.max_step_visits}
          onChange={(v) => patch("stop_conditions.max_step_visits", v)}
          error={fieldError("stop_conditions.max_step_visits")}
          hint="Máximo de visitas a um step (fail-closed)"
          min={1}
        />
        <TextField
          label="stop_signal_file"
          value={draft.stop_conditions.stop_signal_file}
          onChange={(v) => patch("stop_conditions.stop_signal_file", v)}
          error={fieldError("stop_conditions.stop_signal_file")}
          hint="Arquivo de stop signal"
        />
      </fieldset>

      {/* Policies section */}
      <fieldset className="config-pane__section" data-testid="section-policies">
        <SectionHeader title="Policies" errorCount={sectionErrors.policies.length} />
        <SelectField
          label="action"
          value={draft.policies.escalation.action}
          onChange={(v) => patch("policies.escalation.action", v)}
          options={["pause", "skip_task", "abort_loop"] as const}
          error={fieldError("policies.escalation.action")}
        />
        <ToggleField
          label="keep_worktree"
          value={draft.policies.escalation.keep_worktree}
          onChange={(v) => patch("policies.escalation.keep_worktree", v)}
          error={fieldError("policies.escalation.keep_worktree")}
          hint="Manter worktree após escalonamento"
        />
        <TextField
          label="notify"
          value={draft.policies.escalation.notify}
          onChange={(v) => patch("policies.escalation.notify", v)}
          error={fieldError("policies.escalation.notify")}
          hint="Comando de notificação"
        />
        <ToggleField
          label="require_clean_parent"
          value={draft.policies.git.require_clean_parent}
          onChange={(v) => patch("policies.git.require_clean_parent", v)}
          error={fieldError("policies.git.require_clean_parent")}
          hint="Exigir parent branch limpo antes de iniciar"
        />
        <SelectField
          label="on_merge_conflict"
          value={draft.policies.git.on_merge_conflict}
          onChange={(v) => patch("policies.git.on_merge_conflict", v)}
          options={["escalate", "rebase"] as const}
          error={fieldError("policies.git.on_merge_conflict")}
        />
      </fieldset>

      {/* Logging section */}
      <fieldset className="config-pane__section" data-testid="section-logging">
        <SectionHeader title="Logging" errorCount={sectionErrors.logging.length} />
        <TextField
          label="dir"
          value={draft.logging.dir}
          onChange={(v) => patch("logging.dir", v)}
          error={fieldError("logging.dir")}
          hint="Diretório de logs"
        />
        <ToggleField
          label="per_task"
          value={draft.logging.per_task}
          onChange={(v) => patch("logging.per_task", v)}
          error={fieldError("logging.per_task")}
          hint="Logs separados por task"
        />
        <ToggleField
          label="capture_acp_traffic"
          value={draft.logging.capture_acp_traffic}
          onChange={(v) => patch("logging.capture_acp_traffic", v)}
          error={fieldError("logging.capture_acp_traffic")}
          hint="Capturar tráfego ACP nos logs"
        />
      </fieldset>

      {/* Metrics section (opt-in by presence) */}
      <fieldset className="config-pane__section" data-testid="section-metrics">
        <SectionHeader title="Metrics" errorCount={sectionErrors.metrics.length} />
        <ToggleField
          label="Habilitar métricas"
          value={metricsEnabled}
          onChange={(v) => patch("metrics", v ? {} : undefined)}
          hint="Ativa coleta de métricas (opt-in por presença)"
        />
        {metricsEnabled && (
          <TextField
            label="report.index"
            value={draft.metrics?.report?.index ?? ""}
            onChange={(v) => patch("metrics.report", v ? { index: v } : undefined)}
            error={fieldError("metrics.report.index")}
            hint="Template do relatório de change (${...})"
          />
        )}
      </fieldset>
    </div>
  );
}
