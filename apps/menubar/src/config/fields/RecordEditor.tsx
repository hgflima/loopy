/**
 * RecordEditor — key-value pair editor for records (agents, checks, env).
 *
 * Free-form keys (only place in the editor where keys are arbitrary).
 * Add/remove rows; preserves insertion order via [key, value][] internally.
 * Values and keys render in mono (machine voice).
 */

import "./fields.css";

export interface RecordEditorProps {
  label: string;
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  error?: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

type Entry = [string, string];

function toEntries(rec: Record<string, string>): Entry[] {
  const entries = Object.entries(rec);
  return entries.length > 0 ? entries : [["", ""]];
}

function fromEntries(entries: Entry[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (k) result[k] = v;
  }
  return result;
}

export function RecordEditor({
  label,
  value,
  onChange,
  error,
  keyPlaceholder = "key",
  valuePlaceholder = "value",
}: RecordEditorProps) {
  const entries = toEntries(value);

  function update(index: number, pos: 0 | 1, val: string) {
    const next = [...entries];
    const entry: Entry = [...next[index]];
    entry[pos] = val;
    next[index] = entry;
    onChange(fromEntries(next));
  }

  function add() {
    onChange(fromEntries([...entries, ["", ""]]));
  }

  function remove(index: number) {
    const next = entries.filter((_, i) => i !== index);
    onChange(fromEntries(next.length > 0 ? next : [["", ""]]));
  }

  return (
    <div className={`field${error ? " field--error" : ""}`}>
      <span className="field__label">{label}</span>
      <div className="field__record-rows">
        {entries.map(([k, v], i) => (
          <div className="field__record-row" key={i}>
            <input
              className="field__record-key"
              type="text"
              value={k}
              onChange={(e) => update(i, 0, e.target.value)}
              placeholder={keyPlaceholder}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <input
              className="field__record-val"
              type="text"
              value={v}
              onChange={(e) => update(i, 1, e.target.value)}
              placeholder={valuePlaceholder}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <button
              type="button"
              className="field__icon-btn field__icon-btn--danger"
              onClick={() => remove(i)}
              aria-label={`Remove ${k || "entry"}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="field__add-btn" onClick={add}>
        + Add entry
      </button>
      {error && (
        <div className="field__error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
