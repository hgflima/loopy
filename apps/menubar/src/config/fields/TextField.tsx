/**
 * TextField — free-text input with label, error, and hint.
 *
 * Values render in --font-mono (machine voice); labels in sans (human voice).
 * Error uses --state-failed-* tokens (meaning-only color, DESIGN.md §2).
 */

import "./fields.css";
import { makeFieldId } from "./makeFieldId";

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  placeholder?: string;
  id?: string;
}

export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
  id,
}: TextFieldProps) {
  const fieldId = makeFieldId(label, id);

  return (
    <div className={`field${error ? " field--error" : ""}`}>
      <label className="field__label" htmlFor={fieldId}>
        {label}
      </label>
      <input
        id={fieldId}
        className="field__input"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
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
