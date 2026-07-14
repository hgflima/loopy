/**
 * SelectField — closed-enum selector (SC5: never offers values outside options).
 *
 * Receives a readonly `options` array and renders a native <select>.
 * The generic T constrains value+onChange to exactly the option type.
 *
 * T-010 additions: `hint`, `disabled`/`disabledReason`, `renderOption`.
 */

import "./fields.css";
import { makeFieldId } from "./makeFieldId";

export interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly T[];
  error?: string;
  id?: string;
  /** Help text below the select. */
  hint?: string;
  /** Disable the select (e.g. agent doesn't support this capability). */
  disabled?: boolean;
  /** Shown when disabled — explains why the field is unavailable. */
  disabledReason?: string;
  /** Custom display text per option (value is still the option itself). */
  renderOption?: (opt: T) => string;
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  error,
  id,
  hint,
  disabled,
  disabledReason,
  renderOption,
}: SelectFieldProps<T>) {
  const fieldId = makeFieldId(label, id);

  return (
    <div className={`field${error ? " field--error" : ""}${disabled ? " field--disabled" : ""}`}>
      <label className="field__label" htmlFor={fieldId}>
        {label}
      </label>
      <select
        id={fieldId}
        className="field__select"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        disabled={disabled}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {renderOption ? renderOption(opt) : opt}
          </option>
        ))}
      </select>
      {disabled && disabledReason && (
        <div className="field__hint field__hint--disabled">{disabledReason}</div>
      )}
      {!disabled && hint && <div className="field__hint">{hint}</div>}
      {error && (
        <div className="field__error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
