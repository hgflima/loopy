/**
 * Menu — native macOS NSMenu primitives (DESIGN.md §5).
 *
 * A generic, composable menu vocabulary for the tray popover:
 *  - `Menu`          → the `role="menu"` container; owns roving keyboard focus.
 *  - `MenuItem`      → a `role="menuitem"` row (icon + label); activates on
 *                      click AND Enter. `disabled` → `aria-disabled` and never
 *                      fires `onSelect`.
 *  - `MenuSeparator` → a `role="separator"` hairline between item groups.
 *
 * Highlight doctrine (spec §Decisões): the highlighted row — hovered OR reached
 * by ↑/↓ — paints a full accent fill (`--accent` + `--accent-ink`), exactly like
 * a native NSMenu. Only one row highlights at a time, and a disabled row never
 * does. Ships the full state set: default / hover / focus-visible / active /
 * disabled — half a state set is a bug.
 */
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import "./Menu.css";

interface MenuProps {
  readonly children: ReactNode;
  /** Accessible name for the menu (e.g. "Actions"). */
  readonly ariaLabel?: string;
  readonly className?: string;
}

/**
 * Roving focus is DOM-driven: the container queries its live menuitems and
 * moves focus with `.focus()`, so `document.activeElement` is the single source
 * of truth (no index state, no re-renders). Disabled rows carry
 * `aria-disabled="true"` and are filtered out, which naturally skips them and
 * every non-menuitem child (separators included).
 */
export function Menu({ children, ariaLabel, className }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  function enabledItems(): HTMLElement[] {
    const root = ref.current;
    if (!root) return [];
    return Array.from(
      root.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).filter((el) => el.getAttribute("aria-disabled") !== "true");
  }

  function moveFocus(delta: number) {
    const items = enabledItems();
    if (items.length === 0) return;

    const active = document.activeElement;
    const current = active instanceof HTMLElement ? items.indexOf(active) : -1;

    // From nowhere: ↓ opens on the first row, ↑ on the last.
    if (current === -1) {
      items[delta > 0 ? 0 : items.length - 1]?.focus();
      return;
    }
    // Otherwise wrap around.
    items[(current + delta + items.length) % items.length]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(-1);
    }
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      tabIndex={-1}
      className={`menu${className ? ` ${className}` : ""}`}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}

interface MenuItemProps {
  readonly children: ReactNode;
  /** Monochrome glyph (inherits currentColor). Decorative — hidden from AT. */
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
  readonly onSelect?: () => void;
  readonly className?: string;
}

export function MenuItem({
  children,
  icon,
  disabled = false,
  onSelect,
  className,
}: MenuItemProps) {
  function activate() {
    if (disabled) return;
    onSelect?.();
  }

  return (
    <button
      type="button"
      role="menuitem"
      // Semantic disable via ARIA (not the native attribute): keeps the row in
      // the accessibility tree and lets the container decide focus, while the
      // guards below ensure it can never fire `onSelect`.
      aria-disabled={disabled || undefined}
      tabIndex={-1}
      className={`menu__item t-body${className ? ` ${className}` : ""}`}
      // `activate` guards `disabled`, so it stays inert on a disabled row.
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          // Own the activation so it fires exactly once (jsdom does not
          // synthesize a click here, and preventDefault stops the browser's).
          e.preventDefault();
          activate();
        }
      }}
    >
      <span className="menu__item-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="menu__item-label">{children}</span>
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="menu__separator" />;
}
