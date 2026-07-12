/**
 * NumberField — numeric input that normalizes to int/positive per schema.
 *
 * Accepts free text, parses on change, and reports the numeric value.
 * Non-numeric input is rejected (onChange not called with NaN).
 * Empty string → onChange(0) so the field is never uncontrolled.
 */

import "./fields.css";
import { makeFieldId } from "./makeFieldId";

export interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  error?: string;
  hint?: string;
  min?: number;
  id?: string;
}

export function NumberField({
  label,
  value,
  onChange,
  error,
  hint,
  min,
  id,
}: NumberFieldProps) {
  const fieldId = makeFieldId(label, id);

  function handleChange(raw: string) {
    if (raw === "") {
      onChange(min != null ? min : 0);
      return;
    }
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) return; // reject non-numeric
    const clamped = min != null ? Math.max(min, parsed) : parsed;
    onChange(clamped);
  }

  return (
    <div className={`field${error ? " field--error" : ""}`}>
      <label className="field__label" htmlFor={fieldId}>
        {label}
      </label>
      <input
        id={fieldId}
        className="field__input"
        type="text"
        inputMode="numeric"
        value={String(value)}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      {error && (
        <div className="field__error" role="alert">
          {error}
        </div>
      )}
      {!error && hint && <div className="field__hint">{hint}</div>}
    </div>
  );
}
