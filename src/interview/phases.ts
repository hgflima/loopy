/**
 * The single table the engine is allowed to own (AD-1): which `/devy:*` command
 * drives each Interview phase (C-0018, ADR-0012).
 *
 * The engine imposes *form* (the {@link fullEnvelope}), never *content* — but
 * WHICH delegated command belongs to a phase is mechanics, not a script, so it
 * lives here and only here. The `bug`/`debt` tracks have **no** entry: they never
 * spawn a process (they end in a static hand-off), and `Phase` excludes them by
 * type, so asking for their command is not a reachable path.
 */

import type { Phase } from "../tui/transport";

/**
 * The harness address. Declared exactly twice in the whole repo — here (beside
 * the phase→command table) and in `apps/menubar/src-tauri/src/changes.rs`. It is
 * the explicit price of D1 ("only works where the devy harness is installed"): not
 * loop behaviour, just where the harness lives.
 */
export const CHANGES_DIR = ".harn/devy/changes";

/**
 * Map an Interview phase to its delegated `/devy:*` command.
 *
 * - `spec` → `/devy:spec <demand>` — the free-text demand from the DESCRIBE step.
 * - `refine` → `/devy:refine` — no argument; the demand is ignored.
 * - `plan` → `/devy:plan spec.md` — the fixed input the plan reads from.
 */
export function phaseCommand(phase: Phase, demand = ""): string {
  switch (phase) {
    case "spec":
      return `/devy:spec ${demand}`.trimEnd();
    case "refine":
      return "/devy:refine";
    case "plan":
      return "/devy:plan spec.md";
  }
}
