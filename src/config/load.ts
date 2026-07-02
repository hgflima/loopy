/**
 * Loader for `loopy.yml`: read YAML, validate against the zod schema, apply
 * defaults, and fail with a clear, path-anchored message when invalid.
 *
 * `parseConfig` works on an in-memory string (unit-testable, no I/O);
 * `loadConfig` adds file reading. Both return a `LoopyConfig` — the frozen
 * contract from `src/types.ts` — so the schema's inferred shape is checked
 * against that contract at compile time (T-001 note).
 */
import { readFileSync } from "node:fs";
import { parse as parseYaml, YAMLParseError } from "yaml";
import type { LoopyConfig } from "../types";
import { loopyConfigSchema } from "./schema";
import type { ZodError, ZodIssue } from "zod";

/** Raised when a config file cannot be read, parsed, or validated. */
export class ConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ConfigError";
  }
}

/** Options accepted by {@link parseConfig}. */
export interface ParseConfigOptions {
  /** Source path, used only to make error messages point at the right file. */
  readonly sourcePath?: string;
}

/** Render a zod issue path as a dotted trail (`pipeline.1.prompt`). */
function formatPath(path: ZodIssue["path"]): string {
  return path.length === 0 ? "(root)" : path.join(".");
}

/** ` em "<path>"` suffix for messages; empty when the source path is unknown. */
function inFile(sourcePath?: string): string {
  return sourcePath ? ` em "${sourcePath}"` : "";
}

/** Turn a validation failure into a clear, multi-line, path + reason message. */
function formatValidationError(error: ZodError, sourcePath?: string): string {
  const lines = error.issues.map(
    (issue) => `  - ${formatPath(issue.path)}: ${issue.message}`,
  );
  return `Config inválido${inFile(sourcePath)}:\n${lines.join("\n")}`;
}

/**
 * Validate an in-memory `loopy.yml` document and return a typed `LoopyConfig`
 * with defaults applied. Throws {@link ConfigError} on malformed YAML or on any
 * schema violation (unknown keys, wrong step fields, missing values, …).
 */
export function parseConfig(
  source: string,
  options: ParseConfigOptions = {},
): LoopyConfig {
  const { sourcePath } = options;

  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (err) {
    if (err instanceof YAMLParseError) {
      throw new ConfigError(
        `YAML inválido${inFile(sourcePath)}: ${err.message}`,
        {
          cause: err,
        },
      );
    }
    throw err;
  }

  const result = loopyConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(formatValidationError(result.error, sourcePath));
  }

  return result.data;
}

/**
 * Read a `loopy.yml` from disk and validate it. Throws {@link ConfigError} when
 * the file is missing/unreadable or the contents are invalid.
 */
export function loadConfig(path: string): LoopyConfig {
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ConfigError(
      `Não foi possível ler o config "${path}": ${reason}`,
      {
        cause: err,
      },
    );
  }

  return parseConfig(source, { sourcePath: path });
}
