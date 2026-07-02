/**
 * Per-task logging + optional ACP traffic capture (T-016).
 *
 * `loopy` writes one log file per task under `logging.dir` (`.loopy/logs/<id>.log`
 * by default; a single shared `loopy.log` when `per_task: false`). Each line is
 * `"<iso-timestamp> <LEVEL> <message>"`, appended synchronously so a crash still
 * leaves a complete, ordered log on disk (volume is low — a handful of lines per
 * step — so `appendFileSync` is simpler and more robust than a stream).
 *
 * A {@link TaskLogger} is a {@link LoggerPort} (`info`/`debug`/`error`), so it
 * drops straight into the orchestrator, ACP layer and step interpreters. On top
 * it adds {@link TaskLogger.acp}: a hook to record raw JSON-RPC traffic that is a
 * **no-op unless capture is enabled** — either `logging.capture_acp_traffic` in
 * the yml or the `--verbose` flag. The logger stays free of any ACP/SDK type: the
 * caller (the ACP `onUpdate` / request path, wired in a later task) maps a message
 * to a plain {@link AcpTrafficEntry}, keeping this module a pure sink (AD-1).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { LoggerPort, LoggingConfig } from "../types";

/** Direction of an ACP JSON-RPC message, relative to the engine. */
export type AcpDirection =
  /** Engine → agent (a request/notification we send). */
  | "send"
  /** Agent → engine (a callback/notification we receive). */
  | "recv";

/** One captured ACP JSON-RPC message. */
export interface AcpTrafficEntry {
  readonly direction: AcpDirection;
  /** JSON-RPC method (e.g. `session/prompt`); omitted for bare payloads. */
  readonly method?: string;
  /** The message body (serialized as JSON); `null` when absent. */
  readonly payload?: unknown;
}

/** Log line severities (`ACP` tags captured traffic). */
export type LogLevel = "INFO" | "DEBUG" | "ERROR" | "ACP";

/** A per-task {@link LoggerPort} that can also capture ACP traffic. */
export interface TaskLogger extends LoggerPort {
  /** Absolute path of this task's log file. */
  readonly path: string;
  /** Record one ACP JSON-RPC message (no-op unless traffic capture is enabled). */
  acp(entry: AcpTrafficEntry): void;
}

/** Mints per-task loggers for a run. */
export interface LogFactory {
  /** The logger for `taskId`, writing to `<dir>/<taskId>.log` (or the shared file). */
  forTask(taskId: string): TaskLogger;
}

/** Options for {@link createLogFactory}. */
export interface CreateLogFactoryOptions {
  /** The resolved `logging` block (`dir`, `per_task`, `capture_acp_traffic`). */
  readonly config: LoggingConfig;
  /** Workspace root a relative `logging.dir` is resolved against. */
  readonly root: string;
  /** `--verbose` also captures ACP traffic (OR-ed with `capture_acp_traffic`). */
  readonly verbose?: boolean;
  /** Injectable clock for deterministic timestamps (defaults to `Date.now`). */
  readonly now?: () => Date;
}

/** Render one ACP entry as a log message: `"<dir> [method] <json>"`. */
function formatAcp(entry: AcpTrafficEntry): string {
  const parts: string[] = [entry.direction];
  if (entry.method !== undefined) parts.push(entry.method);
  parts.push(JSON.stringify(entry.payload ?? null));
  return parts.join(" ");
}

/**
 * Build a {@link LogFactory} over `logging.dir` (resolved against `root`). The
 * directory is created lazily on the first write, so configuring logging never
 * touches the filesystem until a line is actually emitted. ACP capture is enabled
 * when the config opts in **or** `--verbose` is passed.
 */
export function createLogFactory(options: CreateLogFactoryOptions): LogFactory {
  const dir = resolve(options.root, options.config.dir);
  const captureAcp =
    options.config.capture_acp_traffic || (options.verbose ?? false);
  const now = options.now ?? ((): Date => new Date());

  let dirReady = false;
  const ensureDir = (): void => {
    if (dirReady) return;
    mkdirSync(dir, { recursive: true });
    dirReady = true;
  };

  return {
    forTask(taskId): TaskLogger {
      const fileName = options.config.per_task ? `${taskId}.log` : "loopy.log";
      const path = join(dir, fileName);
      const emit = (level: LogLevel, message: string): void => {
        ensureDir();
        appendFileSync(path, `${now().toISOString()} ${level} ${message}\n`);
      };
      return {
        path,
        info: (message) => emit("INFO", message),
        debug: (message) => emit("DEBUG", message),
        error: (message) => emit("ERROR", message),
        acp: (entry) => {
          if (captureAcp) emit("ACP", formatAcp(entry));
        },
      };
    },
  };
}
