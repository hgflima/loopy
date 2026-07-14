/**
 * useConfigDraft — React hook that loads, validates, patches, and saves a
 * `loopy.yml` config as an in-memory draft.
 *
 * - Tauri: reads/writes via `invoke("read_project_files")` / `invoke("write_loopy_yml")`.
 * - dev:web (!isTauri): loads the embedded `initialConfigTemplate` (serialized
 *   to YAML then parsed back), save is in-memory only.
 *
 * The draft is validated against `loopyConfigSchema` on every `patch`. Errors
 * are mapped by path so the UI can show inline messages via `errorAt`.
 *
 * `tasks` is derived from `parseBacklog(todoMd, backlogOptionsFrom(draft.inputs.backlog))`
 * and re-parsed whenever `draft.inputs.backlog` changes (R9).
 *
 * `save()` is fail-closed: blocked while `errors` is non-empty.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import {
  loopyConfigSchema,
  parseConfigSource,
  serializeConfig,
  initialConfigTemplate,
} from "loopy/config";
import type { LoopyConfigParsed } from "loopy/config";
import { parseBacklog, backlogOptionsFrom } from "loopy/backlog";
import type { Task } from "loopy/backlog";
import type { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single validation error with its dot-path and message. */
export interface ConfigError {
  readonly path: string;
  readonly message: string;
}

/** The public API returned by `useConfigDraft`. */
export interface ConfigDraftAPI {
  /** The current in-memory draft (validated or not). `null` before first load. */
  readonly draft: LoopyConfigParsed | null;
  /** Validation errors mapped by dot-path. Empty array = valid. */
  readonly errors: readonly ConfigError[];
  /** Whether the draft has unsaved changes. */
  readonly dirty: boolean;
  /** Tasks parsed from the todo.md using the draft's backlog config. */
  readonly tasks: readonly Task[];
  /**
   * Whether a loopy.yml was found on disk.
   * - `null` — not loaded yet
   * - `true` — yml was found (or template was seeded)
   * - `false` — dir has no yml (show empty-state)
   */
  readonly hasConfig: boolean | null;
  /** Load config from a directory (or the embedded sample). */
  load(dir?: string): Promise<void>;
  /** Immutably set a value at a dot-path in the draft. Re-validates. */
  patch(path: string, value: unknown): void;
  /** Persist the draft. Blocked (no-op) when errors exist. Returns true on success. */
  save(): Promise<boolean>;
  /** Seed the draft from the built-in template without saving to disk. */
  seedFromTemplate(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IS_TAURI = isTauri();

/** Map zod issues to `ConfigError[]` with dot-paths. */
function mapZodErrors(issues: z.ZodIssue[]): ConfigError[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

/**
 * Look up errors at a given dot-path prefix.
 * `errorAt(errors, "acp.permissions")` returns all errors whose path starts
 * with `"acp.permissions"` (exact match or child).
 */
export function errorAt(
  errors: readonly ConfigError[],
  path: string,
): readonly ConfigError[] {
  return errors.filter(
    (e) => e.path === path || e.path.startsWith(path + "."),
  );
}

/**
 * Immutable deep-set by dot-path.
 * `setByPath({ a: { b: 1 } }, "a.b", 2)` → `{ a: { b: 2 } }`.
 * Creates intermediate objects as needed (arrays when key is numeric).
 */
function setByPath(obj: unknown, path: string, value: unknown): unknown {
  const keys = path.split(".");
  if (keys.length === 0) return value;

  function clone(target: unknown, keyIndex: number): unknown {
    if (keyIndex >= keys.length) return value;
    const key = keys[keyIndex]!;

    // If target is an array and key is numeric, clone as array
    if (Array.isArray(target)) {
      const idx = Number(key);
      const copy = [...target];
      copy[idx] = clone(copy[idx], keyIndex + 1);
      return copy;
    }

    // Clone as object
    const record = (target != null && typeof target === "object")
      ? { ...(target as Record<string, unknown>) }
      : {};
    record[key] = clone(record[key], keyIndex + 1);
    return record;
  }

  return clone(obj, 0);
}

/**
 * Validate a raw draft against the schema.
 * Returns the parsed config (or the raw object cast as fallback) plus errors.
 */
function validateDraft(raw: unknown): {
  draft: LoopyConfigParsed;
  errors: ConfigError[];
} {
  const result = loopyConfigSchema.safeParse(raw);
  if (result.success) {
    return { draft: result.data, errors: [] };
  }
  return {
    draft: raw as LoopyConfigParsed,
    errors: mapZodErrors(result.error.issues),
  };
}

// ---------------------------------------------------------------------------
// Sample for dev:web
// ---------------------------------------------------------------------------

/** Serialized initialConfigTemplate, parsed back — the embedded sample. */
const SAMPLE_YAML = serializeConfig(initialConfigTemplate);
const SAMPLE_TODO = `- [ ] T-001: Sample task\n  Sample task body\n`;

/**
 * Read the backlog **where the config says it lives** (`inputs.todo`), not at a
 * hardcoded `<dir>/todo.md` — the engine resolves it the same way
 * (`resolvePath(dir, config.inputs.todo)`), and a config pointing at, say,
 * `.harn/devy/changes/C-0015/todo.md` is the common case, not the exception.
 *
 * Needs a valid draft to know the path, so an invalid yml yields no tasks.
 */
async function readBacklogSource(
  dir: string | undefined,
  todoPath: string | undefined,
): Promise<string> {
  if (!IS_TAURI) return SAMPLE_TODO; // dev:web fallback
  if (!dir || !todoPath) return "";
  try {
    // Rust returns Option<String> — null when the file doesn't exist.
    return (await invoke<string | null>("read_backlog", { dir, path: todoPath })) ?? "";
  } catch {
    return ""; // missing/unreadable backlog — empty board, not a crash
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useConfigDraft(): ConfigDraftAPI {
  const [draft, setDraft] = useState<LoopyConfigParsed | null>(null);
  const [errors, setErrors] = useState<readonly ConfigError[]>([]);
  const [dirty, setDirty] = useState(false);
  const [tasks, setTasks] = useState<readonly Task[]>([]);
  const [todoMd, setTodoMd] = useState("");
  const [hasConfig, setHasConfig] = useState<boolean | null>(null);

  // Track the current dir for save()
  const dirRef = useRef<string | undefined>(undefined);
  // Keep a ref to the raw draft object (pre-validation defaults) for patching
  const rawDraftRef = useRef<unknown>(null);

  /** Parse tasks from todoMd using the draft's backlog config. */
  const reParseTasks = useCallback(
    (currentDraft: LoopyConfigParsed | null, currentTodoMd: string) => {
      if (!currentDraft || !currentTodoMd) {
        setTasks([]);
        return;
      }
      const opts = backlogOptionsFrom(currentDraft.inputs.backlog);
      setTasks(parseBacklog(currentTodoMd, opts));
    },
    [],
  );

  const load = useCallback(
    async (dir?: string) => {
      dirRef.current = dir;
      let yamlSource: string | null = null;

      if (IS_TAURI && dir) {
        try {
          // Rust returns Option<String> — null when the file doesn't exist.
          const result = await invoke<{ loopy_yml: string | null }>(
            "read_project_files",
            { dir },
          );
          yamlSource = result.loopy_yml;
        } catch {
          yamlSource = null; // I/O error — treat as empty dir
        }
      } else {
        // dev:web fallback — use embedded sample
        yamlSource = SAMPLE_YAML;
      }

      // No loopy.yml found → empty-state (T-015)
      if (yamlSource == null) {
        setHasConfig(false);
        setDraft(null);
        rawDraftRef.current = null;
        setErrors([]);
        setDirty(false);
        setTodoMd("");
        setTasks([]);
        return;
      }

      setHasConfig(true);

      let raw: unknown;
      try {
        raw = parseConfigSource(yamlSource);
      } catch {
        // Malformed YAML — start with the template
        raw = parseConfigSource(SAMPLE_YAML);
      }

      rawDraftRef.current = raw;
      const validated = validateDraft(raw);

      setDraft(validated.draft);
      setErrors(validated.errors);
      setDirty(false);

      // The backlog path is declared by the config, so it is only knowable now.
      const parsedDraft = validated.errors.length === 0 ? validated.draft : null;
      const todoSource = await readBacklogSource(dir, parsedDraft?.inputs.todo);
      setTodoMd(todoSource);
      reParseTasks(parsedDraft, todoSource);
    },
    [reParseTasks],
  );

  const patch = useCallback(
    (path: string, value: unknown) => {
      const currentRaw = rawDraftRef.current;
      if (currentRaw == null) return;

      const nextRaw = setByPath(currentRaw, path, value);
      rawDraftRef.current = nextRaw;

      const validated = validateDraft(nextRaw);

      setDraft(validated.draft);
      setErrors(validated.errors);
      setDirty(true);

      const parsedDraft = validated.errors.length === 0 ? validated.draft : null;

      // Re-parse tasks if backlog config changed (R9)
      if (path.startsWith("inputs.backlog")) {
        reParseTasks(parsedDraft, todoMd);
      }

      // Pointing at another backlog file means re-reading it from disk.
      if (path === "inputs.todo") {
        void readBacklogSource(dirRef.current, parsedDraft?.inputs.todo).then((source) => {
          setTodoMd(source);
          reParseTasks(parsedDraft, source);
        });
      }
    },
    [reParseTasks, todoMd],
  );

  const save = useCallback(async (): Promise<boolean> => {
    if (draft == null || errors.length > 0) return false;

    const contents = serializeConfig(draft);

    if (IS_TAURI && dirRef.current) {
      try {
        await invoke("write_loopy_yml", {
          dir: dirRef.current,
          contents,
        });
      } catch {
        return false;
      }
    }
    // dev:web: in-memory save (no-op for disk, just clear dirty)

    setDirty(false);
    return true;
  }, [draft, errors]);

  /** Seed the draft from the built-in template without saving to disk. */
  const seedFromTemplate = useCallback(() => {
    const raw = parseConfigSource(SAMPLE_YAML);
    rawDraftRef.current = raw;
    const validated = validateDraft(raw);

    setDraft(validated.draft);
    setErrors(validated.errors);
    setDirty(true);
    setHasConfig(true);
    reParseTasks(validated.errors.length === 0 ? validated.draft : null, todoMd);
  }, [reParseTasks, todoMd]);

  // Auto-load on mount when not in Tauri (dev:web convenience)
  useEffect(() => {
    if (!IS_TAURI) {
      void load();
    }
  }, [load]);

  return { draft, errors, dirty, tasks, hasConfig, load, patch, save, seedFromTemplate };
}
