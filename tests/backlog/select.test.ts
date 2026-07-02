/**
 * `selectTask` (T-018 / OQ6) — the `--task T-NNN` escape hatch. It picks a single
 * task out of the pending list and reports the earlier-pending tasks so the CLI
 * can WARN (non-blocking) that they exist. No dependency field, no hidden policy
 * (faithful to AD-1): it just runs the isolated task and surfaces context.
 */
import { describe, expect, it } from "vitest";
import { selectTask } from "../../src/backlog/todo";
import type { Task } from "../../src/types";

function task(id: string): Task {
  return {
    id,
    slug: id.toLowerCase(),
    title: `Task ${id}`,
    body: "",
    branch: id,
    done: false,
  };
}

const PENDING = [task("T-1"), task("T-2"), task("T-3")];

describe("selectTask", () => {
  it("selects the requested task and reports no earlier pending when it is first", () => {
    const sel = selectTask(PENDING, "T-1");
    expect(sel.task?.id).toBe("T-1");
    expect(sel.priorPending).toEqual([]);
  });

  it("reports the earlier pending tasks when the requested one is not first (OQ6 warning input)", () => {
    const sel = selectTask(PENDING, "T-3");
    expect(sel.task?.id).toBe("T-3");
    expect(sel.priorPending.map((t) => t.id)).toEqual(["T-1", "T-2"]);
  });

  it("returns an undefined task (and no prior list) for an id absent from the pending list", () => {
    const sel = selectTask(PENDING, "T-404");
    expect(sel.task).toBeUndefined();
    expect(sel.priorPending).toEqual([]);
  });
});
