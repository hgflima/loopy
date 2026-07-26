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
 *
 * The seven `IconTool*` glyphs (C-0019 §C1, R7c) are the tool-family vocabulary
 * for the stream timeline: one shape per intent family, so a tool call is told
 * apart by GLYPH — the `--tool-*` hue only tints the stroke via `currentColor`,
 * never a fill, so the distinction survives color-blindness (DESIGN.md §2).
 * They share the same `IconSvg` canvas and stroke family as the menu icons.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const SIZE = 16;
/** Outline weight tuned to read as one stroke family at 16px. */
const STROKE = 1.3;
/** Heavier weight for small detail marks (the "i" stem, the power ring/stem). */
const STROKE_BOLD = 1.4;
const STROKE_PROPS = { stroke: "currentColor", strokeWidth: STROKE } as const;
const STROKE_BOLD_PROPS = {
  stroke: "currentColor",
  strokeWidth: STROKE_BOLD,
} as const;

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
        {...STROKE_PROPS}
      />
      <path d="M2.25 6.25H13.75" {...STROKE_PROPS} />
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
        {...STROKE_BOLD_PROPS}
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
        {...STROKE_BOLD_PROPS}
        strokeLinecap="round"
      />
      <path
        d="M8 2.7V8.5"
        {...STROKE_BOLD_PROPS}
        strokeLinecap="round"
      />
    </IconSvg>
  );
}

// ---------------------------------------------------------------------------
// Tool-family glyphs (C-0019 §C1) — read / write / exec / think / mode /
// danger / other. One shape per family; the hue lives only in the stroke.
// ---------------------------------------------------------------------------

/** Leitura (read · search · fetch) — a page with lines of text. */
export function IconToolRead(props: IconProps) {
  return (
    <IconSvg {...props}>
      <rect
        x={4}
        y={2.5}
        width={8}
        height={11}
        rx={1.5}
        {...STROKE_PROPS}
      />
      <path
        d="M6 5.75h4M6 8h4M6 10.25h2.5"
        {...STROKE_PROPS}
        strokeLinecap="round"
      />
    </IconSvg>
  );
}

/** Escrita (edit · move) — a pencil at 45°, ferrule band near the eraser. */
export function IconToolWrite(props: IconProps) {
  return (
    <IconSvg {...props}>
      <path
        d="M11.7 2.63a1.41 1.41 0 0 1 2 2L5.37 12.97 2.7 13.63 3.37 10.97Z"
        {...STROKE_PROPS}
        strokeLinejoin="round"
      />
      <path d="M10 4.3 12 6.3" {...STROKE_PROPS} />
    </IconSvg>
  );
}

/** Execução (execute) — a terminal prompt: chevron + underscore. */
export function IconToolExec(props: IconProps) {
  return (
    <IconSvg {...props}>
      <path
        d="M3.5 4.5 8 8 3.5 11.5"
        {...STROKE_PROPS}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 11.5h4"
        {...STROKE_PROPS}
        strokeLinecap="round"
      />
    </IconSvg>
  );
}

/** Raciocínio (think) — a lightbulb with a screw base. */
export function IconToolThink(props: IconProps) {
  return (
    <IconSvg {...props}>
      <path
        d="M8 2.5a4 4 0 0 0-2.5 7.12c.4.32.6.78.6 1.28v.35h3.8v-.35c0-.5.2-.96.6-1.28A4 4 0 0 0 8 2.5Z"
        {...STROKE_PROPS}
        strokeLinejoin="round"
      />
      <path
        d="M6.6 13h2.8M7 14.25h2"
        {...STROKE_PROPS}
        strokeLinecap="round"
      />
    </IconSvg>
  );
}

/** Governo (switch_mode) — a toggle switch, knob to the left. */
export function IconToolMode(props: IconProps) {
  return (
    <IconSvg {...props}>
      <rect
        x={2.5}
        y={5.5}
        width={11}
        height={5}
        rx={2.5}
        {...STROKE_PROPS}
      />
      {/* Knob: a solid dot drawn with a round-capped zero-length stroke, so
          the tool hue never touches a fill (C1 — stroke-only). */}
      <path
        d="M5.5 8h.01"
        stroke="currentColor"
        strokeWidth={2.8}
        strokeLinecap="round"
      />
    </IconSvg>
  );
}

/** Destrutivo (delete) — a trash can with lid, handle, and streaks. */
export function IconToolDanger(props: IconProps) {
  return (
    <IconSvg {...props}>
      <path
        d="M3.5 4.5h9"
        {...STROKE_PROPS}
        strokeLinecap="round"
      />
      <path
        d="M6.25 4.5v-.75A.75.75 0 0 1 7 3h2a.75.75 0 0 1 .75.75V4.5"
        {...STROKE_PROPS}
        strokeLinejoin="round"
      />
      <path
        d="M4.75 4.5 5.3 12.4a1 1 0 0 0 1 .9h3.4a1 1 0 0 0 1-.9L11.25 4.5"
        {...STROKE_PROPS}
        strokeLinejoin="round"
      />
      <path
        d="M7 6.9v3.9M9 6.9v3.9"
        {...STROKE_PROPS}
        strokeLinecap="round"
      />
    </IconSvg>
  );
}

/** Outro (other) — an ellipsis; keeps the vocabulary small. */
export function IconToolOther(props: IconProps) {
  return (
    <IconSvg {...props}>
      {/* Three solid dots drawn as round-capped zero-length strokes, so the
          tool hue rides on the stroke, never a fill (C1 — stroke-only). */}
      <path
        d="M4 8h.01M8 8h.01M12 8h.01"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </IconSvg>
  );
}
