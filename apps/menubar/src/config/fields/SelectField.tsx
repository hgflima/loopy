/**
 * SelectField — closed-enum selector (SC5: never offers values outside options).
 *
 * Receives a readonly `options` array and renders a native <select>.
 * The generic T constrains value+onChange to exactly the option type.
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
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  error,
  id,
}: SelectFieldProps<T>) {
  const fieldId = makeFieldId(label, id);

  return (
    <div className={`field${error ? " field--error" : ""}`}>
      <label className="field__label" htmlFor={fieldId}>
        {label}
      </label>
      <select
        id={fieldId}
        className="field__select"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      {error && (
        <div className="field__error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
