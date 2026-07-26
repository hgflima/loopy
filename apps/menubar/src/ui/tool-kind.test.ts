/**
 * tool-kind — the pure `ToolKind → family` vocabulary (C-0019 §C1).
 *
 * The SDK declares TEN `ToolKind`s but the design wheel only has room for five
 * new family hues (DESIGN.md §2, ~35° separation). So the ten collapse into
 * SEVEN intent families — five hued, two inherited (`danger`, `other`). This
 * proves the collapse is total (all ten map, all seven families used), that an
 * unknown kind degrades to `other` without throwing, and that every family
 * carries a distinct token + glyph (C1: the distinction rides on shape, not
 * just hue).
 *
 * Run: `npm test -w apps/menubar -- tool-kind`
 */
import { describe, it, expect } from "vitest";
import type { ToolKindName } from "loopy/tui/store";
import { toolKindMeta, type ToolFamily } from "./tool-kind";

/** The 10 `ToolKind`s the SDK 0.29 declares. */
const SDK_KINDS: readonly ToolKindName[] = [
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "think",
  "fetch",
  "switch_mode",
  "other",
];

/** The spec table (§C1): each SDK kind → its intent family. */
const EXPECTED: Readonly<Record<ToolKindName, ToolFamily>> = {
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

const ALL_FAMILIES: readonly ToolFamily[] = [
  "read",
  "write",
  "exec",
  "think",
  "mode",
  "danger",
  "other",
];

describe("toolKindMeta", () => {
  it("maps each of the 10 SDK kinds to its spec family, with no leftover", () => {
    for (const kind of SDK_KINDS) {
      expect(toolKindMeta(kind).family).toBe(EXPECTED[kind]);
    }
  });

  it("the 10 kinds cover exactly the 7 families — none unused, none extra", () => {
    const seen = new Set(SDK_KINDS.map((k) => toolKindMeta(k).family));
    expect([...seen].sort()).toEqual([...ALL_FAMILIES].sort());
  });

  it("collapses read/search/fetch into one family", () => {
    const fams = (["read", "search", "fetch"] as const).map(
      (k) => toolKindMeta(k).family,
    );
    expect(new Set(fams).size).toBe(1);
    expect(fams[0]).toBe("read");
  });

  it("collapses edit/move into one family", () => {
    expect(toolKindMeta("edit").family).toBe("write");
    expect(toolKindMeta("move").family).toBe("write");
  });

  it("delete inherits the danger family (destruction is the danger hue)", () => {
    const meta = toolKindMeta("delete");
    expect(meta.family).toBe("danger");
    expect(meta.token).toBe("var(--tool-danger)");
  });

  it("falls back to `other` for an unknown kind — never throws", () => {
    for (const weird of ["", "banana", "READ", "tool_call", "  read  "]) {
      expect(() => toolKindMeta(weird)).not.toThrow();
      expect(toolKindMeta(weird).family).toBe("other");
    }
  });

  it("degrades `Object.prototype` keys to a COMPLETE `other` meta", () => {
    // The wire `kind` is an arbitrary string, so an inherited-property name
    // must not resolve to `Object.prototype`'s value — it degrades to `other`
    // with the full meta (token/Icon/label), never a half-built object.
    const inherited = [
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "isPrototypeOf",
      "__proto__",
    ];
    for (const key of inherited) {
      expect(() => toolKindMeta(key)).not.toThrow();
      const meta = toolKindMeta(key);
      expect(meta.family).toBe("other");
      expect(meta.token).toBe("var(--tool-other)");
      expect(typeof meta.Icon).toBe("function");
      expect(meta.label).toBe("Outro");
    }
  });

  it("gives every family a distinct token (7 hues/inheritances)", () => {
    const tokens = ALL_FAMILIES.map((f) => toolKindMeta(familyKind(f)).token);
    expect(new Set(tokens).size).toBe(ALL_FAMILIES.length);
  });

  it("gives every family a distinct icon component (shape, not just hue)", () => {
    const icons = ALL_FAMILIES.map((f) => toolKindMeta(familyKind(f)).Icon);
    expect(new Set(icons).size).toBe(ALL_FAMILIES.length);
  });

  it("every token is a `var(--tool-*)` custom property", () => {
    for (const kind of SDK_KINDS) {
      expect(toolKindMeta(kind).token).toMatch(/^var\(--tool-[a-z]+\)$/);
    }
  });

  it("every meta carries a non-empty human label", () => {
    for (const kind of SDK_KINDS) {
      expect(toolKindMeta(kind).label.length).toBeGreaterThan(0);
    }
  });
});

/** A representative SDK kind that lands on a given family (for reverse lookups). */
function familyKind(family: ToolFamily): ToolKindName {
  const hit = SDK_KINDS.find((k) => EXPECTED[k] === family);
  if (!hit) throw new Error(`no SDK kind for family ${family}`);
  return hit;
}
