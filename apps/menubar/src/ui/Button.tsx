/**
 * Button — the one button vocabulary for the whole app.
 *
 * Three variants (DESIGN.md §5):
 *  - primary   → accent fill, the primary action of a surface (Start, Approve).
 *  - secondary → neutral fill + hairline, neutral actions (Cancel, Stop).
 *  - ghost     → transparent, tertiary/inline actions.
 *
 * Ships the full state set: default / hover / focus-visible / active /
 * disabled. Half a state set is a bug.
 */
import type { ButtonHTMLAttributes } from "react";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
}

export function Button({
  variant = "secondary",
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn--${variant}${className ? ` ${className}` : ""}`}
      {...rest}
    />
  );
}
