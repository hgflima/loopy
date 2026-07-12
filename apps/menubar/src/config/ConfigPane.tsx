/**
 * ConfigPane — visual editor for top-level `loopy.yml` settings.
 *
 * Single scroll, each section a fieldset/card with title + error counter (R5).
 * This task wires workspace (3 TextFields) + concurrency (NumberField) end-to-end.
 * Error routing (R7): field→inline, section header→counter, cross-field→banner.
 * Save is fail-closed: disabled while any error exists (C4).
 */

import { useCallback, useMemo } from "react";
import type { ConfigDraftAPI, ConfigError } from "./useConfigDraft";
import { errorAt } from "./useConfigDraft";
import { TextField, NumberField } from "./fields";
import { Button } from "../ui";
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

/** Paths that belong to a visible section in this task. */
const SECTION_PREFIXES = ["workspace", "concurrency"] as const;

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
// Component
// ---------------------------------------------------------------------------

export function ConfigPane({ configDraft }: ConfigPaneProps) {
  const { draft, errors, dirty, patch, save } = configDraft;

  const handleSave = useCallback(() => {
    void save();
  }, [save]);

  // Error counts per section
  const wsErrors = useMemo(() => errorAt(errors, "workspace"), [errors]);
  const concErrors = useMemo(() => errorAt(errors, "concurrency"), [errors]);
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

      {/* Toolbar: dirty indicator + Save */}
      <div className="config-pane__toolbar">
        {dirty && <span className="config-pane__dirty" data-testid="dirty-indicator">Alterações não salvas</span>}
        <Button
          variant="primary"
          disabled={errors.length > 0 || !dirty}
          onClick={handleSave}
          data-testid="btn-save"
        >
          Salvar
        </Button>
      </div>

      {/* Workspace section */}
      <fieldset className="config-pane__section" data-testid="section-workspace">
        <SectionHeader title="Workspace" errorCount={wsErrors.length} />
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
        <SectionHeader title="Concurrency" errorCount={concErrors.length} />
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
    </div>
  );
}
