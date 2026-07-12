/**
 * ToggleField — boolean checkbox with label.
 *
 * Uses accent-color for the native checkbox (DESIGN.md §2).
 * Label is sans (human voice); the toggle name is the label itself.
 */

import "./fields.css";
import { makeFieldId } from "./makeFieldId";

export interface ToggleFieldProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  error?: string;
  hint?: string;
  id?: string;
}

export function ToggleField({
  label,
  value,
  onChange,
  error,
  hint,
  id,
}: ToggleFieldProps) {
  const fieldId = makeFieldId(label, id);

  return (
    <div className={`field${error ? " field--error" : ""}`}>
      <label className="field__toggle" htmlFor={fieldId}>
        <input
          id={fieldId}
          className="field__checkbox"
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="field__toggle-label">{label}</span>
        {hint && <span className="field__hint">{hint}</span>}
      </label>
      {error && (
        <div className="field__error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
