/**
 * CommandListEditor — ordered list of command strings (shell.run, approval.run).
 *
 * Add/remove/reorder; values render in mono (machine voice — commands).
 * Preserves order on all mutations.
 */

import "./fields.css";

export interface CommandListEditorProps {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  error?: string;
  placeholder?: string;
}

export function CommandListEditor({
  label,
  value,
  onChange,
  error,
  placeholder = "command",
}: CommandListEditorProps) {
  const items = value.length > 0 ? value : [""];

  function update(index: number, val: string) {
    const next = items.map((item, i) => (i === index ? val : item));
    onChange(next);
  }

  function add() {
    onChange([...items, ""]);
  }

  function remove(index: number) {
    const next = items.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : [""]);
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const next = [...items];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next);
  }

  function moveDown(index: number) {
    if (index >= items.length - 1) return;
    const next = [...items];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    onChange(next);
  }

  return (
    <div className={`field${error ? " field--error" : ""}`}>
      <span className="field__label">{label}</span>
      <div className="field__cmd-rows">
        {items.map((cmd, i) => (
          <div className="field__cmd-row" key={i}>
            <input
              className="field__cmd-input"
              type="text"
              value={cmd}
              onChange={(e) => update(i, e.target.value)}
              placeholder={placeholder}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <button
              type="button"
              className="field__icon-btn"
              onClick={() => moveUp(i)}
              disabled={i === 0}
              aria-label="Move up"
            >
              ↑
            </button>
            <button
              type="button"
              className="field__icon-btn"
              onClick={() => moveDown(i)}
              disabled={i >= items.length - 1}
              aria-label="Move down"
            >
              ↓
            </button>
            <button
              type="button"
              className="field__icon-btn field__icon-btn--danger"
              onClick={() => remove(i)}
              aria-label={`Remove command ${i + 1}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="field__add-btn" onClick={add}>
        + Add command
      </button>
      {error && (
        <div className="field__error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
