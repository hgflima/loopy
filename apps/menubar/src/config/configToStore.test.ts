import { describe, it, expect } from "vitest";
import { configToStore } from "./configToStore";
import type { LoopyConfigParsed } from "loopy/config";
import type { Task } from "loopy/backlog";
import { groupByStep } from "../kanban/grouper";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid config with a given pipeline. */
function config(
  pipeline: Array<{ id: string; type: "agent" | "shell" | "checks" | "approval" }> = [],
): LoopyConfigParsed {
  return {
    version: "1",
    name: "test",
    workspace: { root: ".", parent_branch: "main", worktrees_dir: ".worktrees" },
    acp: { adapter: "claude", request_timeout_seconds: 300, permissions: { on_request: "allow" } },
    inputs: { backlog: { path: "todo.md", task_id_pattern: "T-\\d+", body: "indented" } },
    checks: {},
    pipeline,
    stop_conditions: { max_iterations: 10, max_step_visits: 10 },
    concurrency: 1,
    policies: {
      escalation: { action: "pause" },
      git: { on_merge_conflict: "escalate" },
    },
    logging: { level: "info", capture_acp_traffic: false },
  } as unknown as LoopyConfigParsed;
}

function task(id: string, title: string, deps: readonly string[] = [], body = ""): Task {
  return {
    id,
    slug: id.toLowerCase(),
    title,
    body,
    branch: `branch-${id}`,
    done: false,
    deps,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("configToStore", () => {
  it("pipeline reflete config.pipeline (id+type, ordem)", () => {
    const cfg = config([
      { id: "implement", type: "agent" },
      { id: "test", type: "checks" },
      { id: "review", type: "approval" },
    ]);
    const state = configToStore(cfg, []);

    expect(state.pipeline).toEqual([
      { id: "implement", type: "agent" },
      { id: "test", type: "checks" },
      { id: "review", type: "approval" },
    ]);
  });

  it("tasks caem todas no Backlog (sem currentStepId + não-terminal)", () => {
    const cfg = config([
      { id: "implement", type: "agent" },
      { id: "test", type: "checks" },
    ]);
    const tasks = [task("T-001", "Task um"), task("T-002", "Task dois")];
    const state = configToStore(cfg, tasks);

    // Todos os cards devem estar no Backlog via grouper
    const columns = groupByStep(state);
    const backlog = columns.find((c) => c.id === "backlog")!;
    expect(backlog.cards).toHaveLength(2);
    expect(backlog.cards.map((c) => c.taskId)).toEqual(["T-001", "T-002"]);

    // Nenhum card nos steps nem no Fim
    for (const col of columns.filter((c) => c.id !== "backlog")) {
      expect(col.cards).toHaveLength(0);
    }
  });

  it("edges derivam das deps das tasks", () => {
    const cfg = config([{ id: "implement", type: "agent" }]);
    const tasks = [
      task("T-001", "Primeira"),
      task("T-002", "Segunda", ["T-001"]),
      task("T-003", "Terceira", ["T-001", "T-002"]),
    ];
    const state = configToStore(cfg, tasks);

    expect(state.edges).toEqual([
      ["T-001", "T-002"],
      ["T-001", "T-003"],
      ["T-002", "T-003"],
    ]);
  });

  it("task com deps fica 'blocked'", () => {
    const cfg = config([{ id: "implement", type: "agent" }]);
    const tasks = [
      task("T-001", "Sem deps"),
      task("T-002", "Com deps", ["T-001"]),
    ];
    const state = configToStore(cfg, tasks);

    expect(state.tasks[0]!.status).toBe("ready");
    expect(state.tasks[1]!.status).toBe("blocked");
  });

  it("pipeline vazio ⇒ só Backlog + Fim", () => {
    const cfg = config([]);
    const tasks = [task("T-001", "Solo")];
    const state = configToStore(cfg, tasks);

    const columns = groupByStep(state);
    expect(columns).toHaveLength(2); // Backlog + Fim
    expect(columns[0]!.id).toBe("backlog");
    expect(columns[1]!.id).toBe("fim");
    expect(columns[0]!.cards).toHaveLength(1);
  });

  it("tasks vazias ⇒ zero cards", () => {
    const cfg = config([{ id: "implement", type: "agent" }]);
    const state = configToStore(cfg, []);

    expect(state.tasks).toHaveLength(0);
    const columns = groupByStep(state);
    for (const col of columns) {
      expect(col.cards).toHaveLength(0);
    }
  });

  it("acpLog vazio e activeAgents vazio", () => {
    const state = configToStore(config([]), []);
    expect(state.acpLog).toEqual([]);
    expect(state.activeAgents.size).toBe(0);
  });

  it("description vem do body da task", () => {
    const state = configToStore(config([]), [task("T-001", "Com body", [], "Detalhes da task")]);

    expect(state.tasks[0]!.description).toBe("Detalhes da task");
  });

  it("deps são preservadas no TaskState", () => {
    const tasks = [
      task("T-001", "A"),
      task("T-002", "B", ["T-001"]),
    ];
    const state = configToStore(config([]), tasks);

    expect(state.tasks[0]!.deps).toEqual([]);
    expect(state.tasks[1]!.deps).toEqual(["T-001"]);
  });
});
