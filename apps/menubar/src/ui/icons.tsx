/**
 * icons — monochrome 16×16 menu glyphs (C-0012, §Decisões #6, DESIGN.md §5).
 *
 * SF Symbols-flavored inline SVG (never emoji/ASCII glyphs). Each icon inherits
 * its color from the surrounding text via `currentColor` — so a MenuItem turns
 * it `accent-ink` when highlighted and `ink-tertiary` when disabled, with zero
 * hardcoded color. `aria-hidden` keeps them out of the a11y tree (the MenuItem
 * label is the accessible name). Props flow through so callers can size/style.
 *
 *   macwindow → IconOpen · stop.fill → IconStop · info.circle → IconInfo · power → IconPower
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const SIZE = 16;
/** Outline weight tuned to read as one stroke family at 16px. */
const STROKE = 1.3;
/** Heavier weight for small detail marks (the "i" stem, the power ring/stem). */
const STROKE_BOLD = 1.4;

/**
 * Shared canvas: fixed 16×16 size, `currentColor` inheritance, and `aria-hidden`
 * in one place so each icon only describes its glyph. Extra props reach the <svg>.
 */
function IconSvg({ children, ...props }: IconProps) {
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      fill="none"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

/** macwindow — a rounded window with a title bar (always active → Abrir). */
export function IconOpen(props: IconProps) {
  return (
    <IconSvg {...props}>
      <rect
        x={2.25}
        y={3.25}
        width={11.5}
        height={9.5}
        rx={2}
        stroke="currentColor"
        strokeWidth={STROKE}
      />
      <path d="M2.25 6.25H13.75" stroke="currentColor" strokeWidth={STROKE} />
    </IconSvg>
  );
}

/** stop.fill — a filled rounded square (Parar; disabled when idle). */
export function IconStop(props: IconProps) {
  return (
    <IconSvg {...props}>
      <rect x={3.5} y={3.5} width={9} height={9} rx={2} fill="currentColor" />
    </IconSvg>
  );
}

/** info.circle — a ringed "i" (Sobre). */
export function IconInfo(props: IconProps) {
  return (
    <IconSvg {...props}>
      <circle cx={8} cy={8} r={5.75} stroke="currentColor" strokeWidth={STROKE} />
      <circle cx={8} cy={5.4} r={0.9} fill="currentColor" />
      <path
        d="M8 7.6V11"
        stroke="currentColor"
        strokeWidth={STROKE_BOLD}
        strokeLinecap="round"
      />
    </IconSvg>
  );
}

/** power — a ring broken at the top by a vertical stem (⏻ → Sair). */
export function IconPower(props: IconProps) {
  return (
    <IconSvg {...props}>
      <path
        d="M6.46 4.47A4.5 4.5 0 1 0 9.54 4.47"
        stroke="currentColor"
        strokeWidth={STROKE_BOLD}
        strokeLinecap="round"
      />
      <path
        d="M8 2.7V8.5"
        stroke="currentColor"
        strokeWidth={STROKE_BOLD}
        strokeLinecap="round"
      />
    </IconSvg>
  );
}
