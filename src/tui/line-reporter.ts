/**
 * Line-log fallback for when there is no TTY or `--no-tui` is passed (Success
 * Criterion #6: "degrada para logs de linha"). The live Ink tree updates rows
 * in place; a dumb pipe cannot, so this reporter renders the *same* store
 * transitions as an append-only stream of ordered lines — task registration,
 * start, each step, the `try k/max` attempt, per-check pass/fail, the agent
 * stream, and the terminal done/escalated line.
 *
 * It consumes the very same {@link StoreEvent}s the Ink tree reads via the store,
 * so the two renderers never diverge. To stay faithful to the store it reduces
 * those events through the same pure {@link reduce}, and — crucially — mirrors the
 * store's no-ops: an event the reducer ignores (unknown task, a step-scoped event
 * before its `step_started`, a duplicate registration) prints nothing, because a
 * no-op leaves the reduced state reference untouched.
 *
 * The only state beyond that reduce is a per-task stream line-buffer: agent text
 * arrives in arbitrary chunks, so completed lines are emitted as they cross a
 * newline and any trailing partial is flushed at the next step/attempt/task
 * boundary. This keeps the streamed output readable in a plain log.
 */
import {
  initialState,
  reduce,
  type StoreEvent,
  type StoreState,
} from "./store";
import { SYMBOLS } from "./view";

/** Prefix marking a streamed agent-output line in the log. */
const STREAM_PREFIX = "│";

/** Human-readable labels for task_finished status values. */
const TASK_FINISHED_LABELS: Record<string, string> = {
  done: "concluída",
  escalated: "escalada",
  skipped: "pulada",
  paused: "pausada",
};

/** Options for {@link createLineReporter}. */
export interface LineReporterOptions {
  /** Sink for each rendered line (no trailing newline). */
  readonly print: (line: string) => void;
  /** When `true`, ACP traffic lines (`acp_traffic` events) are printed. */
  readonly verbose?: boolean;
}

/** Consumes store events and prints equivalent log lines. */
export interface LineReporter {
  /** Apply one event; prints its line(s), mirroring the store's no-ops. */
  handle(event: StoreEvent): void;
}

/** Build a {@link LineReporter} over a `print` sink. */
export function createLineReporter(options: LineReporterOptions): LineReporter {
  const { print, verbose = false } = options;
  let state: StoreState = initialState();
  // Partial (newline-less) stream text per task, awaiting the rest of its line.
  const streamBuffers = new Map<string, string>();

  /** T-008: prefix a line with `[agent]` when >1 agent active. */
  const agentPrefix = (agent: string | undefined): string =>
    agent !== undefined && state.activeAgents.size > 1 ? `[${agent}] ` : "";

  /** Emit any completed lines in a task's stream chunk; buffer the remainder. */
  const pushStream = (taskId: string, text: string, agent?: string): void => {
    let buffer = (streamBuffers.get(taskId) ?? "") + text;
    const pfx = agentPrefix(agent);
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      print(`    ${STREAM_PREFIX} ${pfx}${buffer.slice(0, newline)}`);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
    streamBuffers.set(taskId, buffer);
  };

  /** Flush a task's trailing partial stream line at a turn/step boundary. */
  const flushStream = (taskId: string): void => {
    const buffer = streamBuffers.get(taskId);
    if (buffer !== undefined && buffer !== "") {
      print(`    ${STREAM_PREFIX} ${buffer}`);
    }
    streamBuffers.delete(taskId);
  };

  return {
    handle(event) {
      const next = reduce(state, event);
      // Mirror the store: an event it ignored (no reference change) prints nothing.
      if (next === state) return;
      state = next;

      switch (event.type) {
        case "task_registered":
          print(`${SYMBOLS.task.pending} ${event.taskId} — ${event.title}`);
          return;

        case "task_started":
          print(`${SYMBOLS.task.running} ${event.taskId} iniciada`);
          return;

        case "step_started":
          flushStream(event.taskId);
          print(
            `  ${SYMBOLS.step.running} ${event.stepId} (${event.stepType})`,
          );
          return;

        case "attempt_started":
          flushStream(event.taskId);
          print(`    tentativa ${event.attempt}/${event.maxAttempts}`);
          return;

        case "check_started":
          // No line: a plain log cannot update a "running" check in place; the
          // per-check status is surfaced on `check_finished`.
          return;

        case "check_finished": {
          const symbol = event.ok ? SYMBOLS.check.passed : SYMBOLS.check.failed;
          print(`      ${symbol} ${event.name}`);
          return;
        }

        case "stream_chunk":
          pushStream(event.taskId, event.text, event.agent);
          return;

        case "step_finished": {
          flushStream(event.taskId);
          const symbol = event.ok ? SYMBOLS.step.ok : SYMBOLS.step.failed;
          const suffix = !event.ok && event.reason ? `: ${event.reason}` : "";
          print(`  ${symbol} ${event.stepId}${suffix}`);
          return;
        }

        case "task_finished": {
          flushStream(event.taskId);
          const symbol = SYMBOLS.task[event.status];
          const word =
            TASK_FINISHED_LABELS[event.status] ?? event.status;
          const suffix = event.reason ? `: ${event.reason}` : "";
          print(`${symbol} ${event.taskId} ${word}${suffix}`);
          return;
        }

        case "acp_traffic": {
          if (!verbose) return;
          const arrow = event.direction === "send" ? "→" : "←";
          const method = event.method ? `${event.method} ` : "";
          const pfx = agentPrefix(event.agent);
          print(`    ${arrow} ${pfx}${method}${event.summary}`);
          return;
        }

        case "usage_sample":
          // Live context-window occupancy (T-007) — TUI-only, no line output.
          return;
      }
    },
  };
}
