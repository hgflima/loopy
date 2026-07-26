/**
 * tool-kind — the pure `ToolKind → intent family` vocabulary (C-0019 §C1).
 *
 * The SDK 0.29 declares TEN `ToolKind`s, but the design wheel only has room for
 * five new family hues (DESIGN.md §2 reserves five state hues and demands ~35°
 * of separation). So the ten collapse into SEVEN intent families: five hued
 * (`read`/`write`/`exec`/`think`/`mode`) plus two inheritances — `danger`
 * borrows the failed red-orange (destruction IS the danger hue) and `other`
 * borrows `ink-tertiary`, keeping the vocabulary small.
 *
 * The hue rides ONLY on the icon stroke (`token` → the icon's `currentColor`),
 * never a fill/tint/border/pill: the status keeps the fill in the existing
 * state hues, so a tool call is told apart by GLYPH × pill — the distinction
 * survives color-blindness (C1). This module is pure and never throws: any
 * unknown `kind` degrades to `other`.
 */
import type { ComponentType, SVGProps } from "react";
import type { ToolKindName } from "loopy/tui/store";
import {
  IconToolRead,
  IconToolWrite,
  IconToolExec,
  IconToolThink,
  IconToolMode,
  IconToolDanger,
  IconToolOther,
} from "./icons";

/** The seven intent families the ten `ToolKind`s collapse into. */
export type ToolFamily =
  "read" | "write" | "exec" | "think" | "mode" | "danger" | "other";

export interface ToolKindMeta {
  readonly family: ToolFamily;
  /** CSS value that colors the icon STROKE — a `var(--tool-*)`, never a fill. */
  readonly token: string;
  readonly Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Human label (pt-BR) for the family. */
  readonly label: string;
}

/** Family → its token, glyph, and label. The one place the mapping lives. */
const FAMILY_META: Readonly<Record<ToolFamily, Omit<ToolKindMeta, "family">>> =
  {
    read: {
      token: "var(--tool-read)",
      Icon: IconToolRead,
      label: "Leitura",
    },
    write: {
      token: "var(--tool-write)",
      Icon: IconToolWrite,
      label: "Escrita",
    },
    exec: {
      token: "var(--tool-exec)",
      Icon: IconToolExec,
      label: "Execução",
    },
    think: {
      token: "var(--tool-think)",
      Icon: IconToolThink,
      label: "Raciocínio",
    },
    mode: {
      token: "var(--tool-mode)",
      Icon: IconToolMode,
      label: "Governo",
    },
    danger: {
      token: "var(--tool-danger)",
      Icon: IconToolDanger,
      label: "Destrutivo",
    },
    other: {
      token: "var(--tool-other)",
      Icon: IconToolOther,
      label: "Outro",
    },
  };

/** The 10 SDK `ToolKind`s collapsed to 7 families (spec §C1 table). */
const KIND_TO_FAMILY: Readonly<Record<ToolKindName, ToolFamily>> = {
  read: "read",
  search: "read",
  fetch: "read",
  edit: "write",
  move: "write",
  execute: "exec",
  think: "think",
  switch_mode: "mode",
  delete: "danger",
  other: "other",
};

/**
 * Resolve a `ToolKind` (as it arrives on the wire — an arbitrary string) to its
 * family metadata. An unrecognized `kind` degrades to `other`; never throws.
 *
 * `Object.hasOwn` (not `KIND_TO_FAMILY[kind] ?? …`) is load-bearing: the wire
 * `kind` is untrusted, so an inherited property name (`"constructor"`,
 * `"toString"`, `"__proto__"`) would otherwise resolve to `Object.prototype`'s
 * value instead of degrading — yielding a half-built meta with no token/glyph.
 */
export function toolKindMeta(kind: string): ToolKindMeta {
  const family = Object.hasOwn(KIND_TO_FAMILY, kind)
    ? KIND_TO_FAMILY[kind as ToolKindName]
    : "other";
  return { family, ...FAMILY_META[family] };
}
