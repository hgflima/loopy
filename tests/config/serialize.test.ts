import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { loopyConfigSchema } from "../../src/config/schema";
import type { LoopyConfigParsed } from "../../src/config/schema";
import { parseConfig } from "../../src/config/load";
import {
  serializeConfig,
  parseConfigSource,
  initialConfigTemplate,
} from "../../src/config/serialize";

/** The canonical top-level key order (mirrors loopyConfigSchema declaration). */
const CANONICAL_ORDER = [
  "version",
  "name",
  "workspace",
  "agents",
  "acp",
  "inputs",
  "checks",
  "pipeline",
  "stop_conditions",
  "concurrency",
  "max_concurrency",
  "policies",
  "logging",
  "metrics",
] as const;

describe("initialConfigTemplate", () => {
  it("is valid against loopyConfigSchema", () => {
    const result = loopyConfigSchema.safeParse(initialConfigTemplate);
    expect(result.success).toBe(true);
  });
});

describe("serializeConfig", () => {
  it("round-trips: serialize → parseConfig produces the same config", () => {
    const yaml = serializeConfig(initialConfigTemplate);
    const reparsed = parseConfig(yaml);

    // Compare without resolvedAgents (runtime-derived field)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { resolvedAgents, ...reparsedClean } = reparsed;
    expect(reparsedClean).toEqual(initialConfigTemplate);
  });

  it("emits top-level keys in canonical order", () => {
    const yaml = serializeConfig(initialConfigTemplate);
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    const keys = Object.keys(parsed);

    // Filter canonical order to only keys present in output
    const expectedOrder = CANONICAL_ORDER.filter((k) => k in parsed);
    expect(keys).toEqual(expectedOrder);
  });

  it("does not include resolvedAgents in the YAML output", () => {
    const full = parseConfig(serializeConfig(initialConfigTemplate));
    const yaml = serializeConfig(full as unknown as LoopyConfigParsed);
    const raw = parseYaml(yaml) as Record<string, unknown>;
    expect(raw).not.toHaveProperty("resolvedAgents");
  });
});

describe("parseConfigSource", () => {
  it("returns a plain object from valid YAML (no zod validation)", () => {
    const yaml = serializeConfig(initialConfigTemplate);
    const result = parseConfigSource(yaml);
    expect(result).toBeTypeOf("object");
    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>).version).toBe("1");
  });

  it("throws on YAML syntax errors (not schema errors)", () => {
    expect(() => parseConfigSource("chave: [inválido")).toThrow();
  });

  it("does NOT throw on schema-invalid but syntactically valid YAML", () => {
    const result = parseConfigSource("foo: bar\nbaz: 42");
    expect(result).toEqual({ foo: "bar", baz: 42 });
  });
});
