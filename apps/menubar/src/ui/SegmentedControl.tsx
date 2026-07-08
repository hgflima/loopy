/**
 * SegmentedControl — native macOS segmented control (DESIGN.md §5).
 *
 * Not tabs-with-underline: a neutral track with the selected segment raised on
 * `surface-elevated`. Radio-group semantics + arrow-key navigation, because
 * the audience lives on the keyboard.
 */
import { useRef } from "react";
import "./SegmentedControl.css";

export interface Segment<T extends string> {
  readonly id: T;
  readonly label: string;
}

interface SegmentedControlProps<T extends string> {
  readonly segments: readonly Segment<T>[];
  readonly value: T;
  readonly onChange: (id: T) => void;
  /** Accessible name for the group (e.g. "View"). */
  readonly ariaLabel: string;
}

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  ariaLabel,
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function move(delta: number, from: number) {
    const next = (from + delta + segments.length) % segments.length;
    const target = segments[next]!;
    onChange(target.id);
    refs.current[next]?.focus();
  }

  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {segments.map((seg, i) => {
        const selected = seg.id === value;
        return (
          <button
            key={seg.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={`segmented__seg t-body${selected ? " is-selected" : ""}`}
            onClick={() => onChange(seg.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(1, i);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(-1, i);
              }
            }}
          >
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}
