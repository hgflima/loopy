/**
 * Checks runner — runs a named checks list (the project-target's `typecheck` /
 * `lint` / `test` shell commands) in the task's worktree and aggregates the
 * outcomes into a {@link ChecksReport}. That report's `text` becomes the
 * `${checks.report}` fed back to the agent on a failed `verify` (SPEC / AD-4).
 *
 * Two invariants shape this module:
 *
 *  - **No fail-fast.** Every check in the list runs even after one fails, so the
 *    agent sees the *full* picture in one pass ({@link runChecks}). `ok` is true
 *    only when every check passed.
 *  - **Errors as values (AD-5).** A failing command is a normal result, not an
 *    exception: execa runs with `reject: false` and a non-zero exit / spawn
 *    error / timeout is captured into a {@link CheckResult}, never thrown.
 *
 * ### Truncation strategy (OQ4)
 *
 * A raw `test` run can dwarf an agent's context, so the rendered report is
 * bounded, deterministically:
 *
 *  1. **Passing checks collapse to one line** — their output is irrelevant when
 *     green, so only a status line is emitted.
 *  2. **Failing checks are truncated head+tail per stream** — the first
 *     `headLines` and last `tailLines` are kept with an explicit elision marker
 *     in between (defaults 100 + 100). Head+tail keeps both the first error and
 *     the final summary, which is where the signal usually lives.
 *  3. **Global byte ceiling (~32 KB)** — after per-check truncation, the whole
 *     report is capped to `globalMaxBytes` as a backstop for many failing
 *     checks, again head+tail with a marker.
 *
 * The rendering (everything under {@link renderReport}) is a pure function of
 * the checks' *content* (name/command/exit/stdout/stderr) — timing is
 * deliberately excluded so the same outputs always render the same text.
 *
 * This module is the concrete implementation behind {@link ChecksRunnerPort}
 * (see `types.ts`); the `checks` step (T-008) and the `agent` verify loop
 * (T-010) reach it through that port.
 */
import { execa, parseCommandString } from "execa";
import type {
  CheckCommand,
  CheckResult,
  ChecksReport,
  ChecksRunnerPort,
} from "../types";

// ---------------------------------------------------------------------------
// Truncation knobs (OQ4). Defaults calibrated here; exposable as config later.
// ---------------------------------------------------------------------------

/** Per-check head/tail line budget + global byte ceiling for the report text. */
export interface TruncateOptions {
  /** Lines kept from the start of each failing stream. */
  readonly headLines: number;
  /** Lines kept from the end of each failing stream. */
  readonly tailLines: number;
  /** Hard ceiling (bytes, UTF-8) on the whole rendered report. */
  readonly globalMaxBytes: number;
}

/** Calibrated defaults: 100 head + 100 tail per stream, ~32 KB global ceiling. */
export const DEFAULT_TRUNCATE: TruncateOptions = {
  headLines: 100,
  tailLines: 100,
  globalMaxBytes: 32 * 1024,
};

// ---------------------------------------------------------------------------
// Text helpers (pure) — head+tail truncation with explicit elision markers.
// ---------------------------------------------------------------------------

/** UTF-8 byte length of `text` (the unit the global ceiling is measured in). */
function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * Keep the first `headLines` and last `tailLines` of `text`, replacing the
 * elided middle with a single marker line. Returns `text` unchanged when it
 * already fits within the budget. Deterministic for a given input.
 */
export function truncateHeadTail(
  text: string,
  opts: { readonly headLines: number; readonly tailLines: number },
): string {
  const lines = text.split("\n");
  const { headLines, tailLines } = opts;
  if (lines.length <= headLines + tailLines) return text;
  const head = lines.slice(0, headLines);
  const tail = lines.slice(lines.length - tailLines);
  const elided = lines.length - headLines - tailLines;
  const marker = `... [${elided} linha(s) omitida(s)] ...`;
  return [...head, marker, ...tail].join("\n");
}

/**
 * Backstop that caps the whole report to `maxBytes` (UTF-8). Greedily keeps
 * lines alternating from the head and tail until the budget (minus the marker's
 * cost) is exhausted, then joins them around a global elision marker. The result
 * is always `<= maxBytes` for any `maxBytes` larger than the marker itself.
 */
export function enforceGlobalCeiling(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text;
  const marker = `... [relatório truncado ao teto global de ${maxBytes} bytes] ...`;
  const budget = maxBytes - (byteLength(marker) + 1);
  if (budget <= 0) return marker;

  const lines = text.split("\n");
  const head: string[] = [];
  const tail: string[] = [];
  let used = 0;
  let i = 0;
  let j = lines.length - 1;
  let takeHead = true;
  while (i <= j) {
    const line = takeHead ? lines[i] : lines[j];
    if (line === undefined) break;
    const cost = byteLength(line) + 1;
    if (used + cost > budget) break;
    used += cost;
    if (takeHead) {
      head.push(line);
      i += 1;
    } else {
      tail.unshift(line);
      j -= 1;
    }
    takeHead = !takeHead;
  }
  return [...head, marker, ...tail].join("\n");
}

// ---------------------------------------------------------------------------
// Report rendering (pure) — passing collapse + failing detail (OQ4).
// ---------------------------------------------------------------------------

/** One-line status for a passing check (its output is elided entirely). */
function renderPassing(check: CheckResult): string {
  return `[ok] ${check.name} — passou (exit ${check.exitCode})`;
}

/** A labelled, truncated stream block, or `[]` when the stream is empty. */
function renderStream(
  label: string,
  raw: string,
  truncate: TruncateOptions,
): string[] {
  const trimmed = raw.trimEnd();
  if (trimmed === "") return [];
  return [`--- ${label} ---`, truncateHeadTail(trimmed, truncate)];
}

/** Multi-line block for a failing check: header + truncated stdout/stderr. */
function renderFailing(check: CheckResult, truncate: TruncateOptions): string {
  const stdout = renderStream("stdout", check.stdout, truncate);
  const stderr = renderStream("stderr", check.stderr, truncate);
  const streams =
    stdout.length + stderr.length === 0
      ? ["(sem saída capturada)"]
      : [...stdout, ...stderr];
  return [
    `[falhou] ${check.name} (exit ${check.exitCode}) — comando: ${check.command}`,
    ...streams,
  ].join("\n");
}

/**
 * Render the aggregated, truncated `${checks.report}` from a set of results.
 * Passing checks collapse to a single line, failing checks show truncated
 * output, and the whole thing is capped by the global byte ceiling. Pure and
 * deterministic: identical results always produce identical text.
 */
export function renderReport(
  results: readonly CheckResult[],
  truncate: TruncateOptions = DEFAULT_TRUNCATE,
): string {
  if (results.length === 0) {
    return "Nenhum check configurado.";
  }
  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  const failed = total - passed;
  const header =
    failed === 0
      ? `Checks: ${passed}/${total} passaram.`
      : `Checks: ${passed}/${total} passaram (${failed} falharam).`;
  const body = results
    .map((r) => (r.ok ? renderPassing(r) : renderFailing(r, truncate)))
    .join("\n");
  return enforceGlobalCeiling(`${header}\n${body}`, truncate.globalMaxBytes);
}

// ---------------------------------------------------------------------------
// Single-check execution (execa) — errors as values (AD-5).
// ---------------------------------------------------------------------------

/** Runs one check; injectable so the aggregation logic is unit-testable. */
export type RunOne = (
  check: CheckCommand,
  ctx: { readonly cwd: string; readonly timeoutMs?: number },
) => Promise<CheckResult>;

/** Coerce execa's stream field (string under default options) to a string. */
function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Run a single check command via execa in `ctx.cwd`, never throwing: a non-zero
 * exit, a spawn failure (e.g. command not found) and a timeout all resolve to a
 * `CheckResult` with `ok: false`. The command string is parsed into
 * `file + args` (no shell), matching the simple `"npm run x"` form checks use.
 */
export const runCheckWithExeca: RunOne = async (check, ctx) => {
  const [file, ...args] = parseCommandString(check.run);
  if (file === undefined) {
    return {
      name: check.name,
      command: check.run,
      exitCode: -1,
      ok: false,
      stdout: "",
      stderr: `Comando vazio para o check "${check.name}".`,
      durationMs: 0,
    };
  }

  const result = await execa(file, args, {
    cwd: ctx.cwd,
    reject: false,
    stripFinalNewline: true,
    timeout: ctx.timeoutMs,
  });

  const ok = !result.failed;
  const fallbackExit = ok ? 0 : -1;
  const exitCode =
    typeof result.exitCode === "number" ? result.exitCode : fallbackExit;
  const stdout = asString(result.stdout);
  let stderr = asString(result.stderr);

  if (!ok) {
    const shortMessage =
      typeof result.shortMessage === "string" ? result.shortMessage : "";
    if (stderr.trim() === "" && shortMessage !== "") {
      stderr = shortMessage;
    }
    if (result.timedOut) {
      const note = `Check "${check.name}" excedeu o tempo limite.`;
      stderr = stderr.trim() === "" ? note : `${note}\n${stderr}`;
    }
  }

  return {
    name: check.name,
    command: check.run,
    exitCode,
    ok,
    stdout,
    stderr,
    durationMs: result.durationMs,
  };
};

// ---------------------------------------------------------------------------
// Public runner API.
// ---------------------------------------------------------------------------

/** Options for {@link runChecks}: cwd + optional timeout/truncation/injection. */
export interface RunChecksOptions {
  /** Working directory (the task's worktree) for every check. */
  readonly cwd: string;
  /** Per-check timeout in ms (optional; no timeout by default). */
  readonly timeoutMs?: number;
  /** Truncation overrides; unspecified fields fall back to {@link DEFAULT_TRUNCATE}. */
  readonly truncate?: Partial<TruncateOptions>;
  /** Injection seam for tests; defaults to {@link runCheckWithExeca}. */
  readonly runOne?: RunOne;
  /** Fired just before a single check starts (live progress, T-005). */
  readonly onCheckStart?: (name: string) => void;
  /** Fired right after a single check finishes (live progress, T-005). */
  readonly onCheckEnd?: (name: string, ok: boolean) => void;
}

/**
 * Run every check in `checks` (in order, sequentially, **no fail-fast**) and
 * aggregate the results into a {@link ChecksReport}. `ok` is true only when all
 * checks pass; `text` is the truncated `${checks.report}`.
 */
export async function runChecks(
  checks: readonly CheckCommand[],
  options: RunChecksOptions,
): Promise<ChecksReport> {
  const runOne = options.runOne ?? runCheckWithExeca;
  const truncate: TruncateOptions = {
    ...DEFAULT_TRUNCATE,
    ...options.truncate,
  };

  const results: CheckResult[] = [];
  for (const check of checks) {
    options.onCheckStart?.(check.name);
    const r = await runOne(check, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
    });
    options.onCheckEnd?.(check.name, r.ok);
    results.push(r);
  }

  const ok = results.every((r) => r.ok);
  return { ok, results, text: renderReport(results, truncate) };
}

/**
 * Build a {@link ChecksRunnerPort} (the `run(checks, { cwd })` handle wired into
 * `StepContext`), pre-binding timeout/truncation defaults and an optional
 * injected `runOne`.
 */
export function createChecksRunner(
  defaults: {
    readonly timeoutMs?: number;
    readonly truncate?: Partial<TruncateOptions>;
    readonly runOne?: RunOne;
  } = {},
): ChecksRunnerPort {
  return {
    run: (checks, opts) =>
      runChecks(checks, {
        ...defaults,
        cwd: opts.cwd,
        onCheckStart: opts.onCheckStart,
        onCheckEnd: opts.onCheckEnd,
      }),
  };
}
