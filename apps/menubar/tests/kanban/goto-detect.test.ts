import { describe, it, expect } from "vitest";
import { detectGotoCards } from "../../src/kanban/goto-detect";
import type { KanbanColumn } from "../../src/kanban/grouper";
import type { TaskStatus } from "loopy/tui/store";

// ── helpers ─────────────────────────────────────────────────────────────

function col(id: string, cards: { taskId: string; status?: TaskStatus }[]): KanbanColumn {
  return {
    id,
    title: id,
    cards: cards.map((c) => ({
      taskId: c.taskId,
      title: c.taskId,
      status: c.status ?? "running",
    })),
  };
}

// ── tests ───────────────────────────────────────────────────────────────

describe("detectGotoCards", () => {
  it("returns empty set when there are no previous columns", () => {
    const cols = [col("backlog", [{ taskId: "T-001" }])];
    const result = detectGotoCards(undefined, cols);
    expect(result.size).toBe(0);
  });

  it("returns empty set when card stays in the same column", () => {
    const prev = [col("backlog", []), col("implement", [{ taskId: "T-001" }]), col("fim", [])];
    const next = [col("backlog", []), col("implement", [{ taskId: "T-001" }]), col("fim", [])];
    const result = detectGotoCards(prev, next);
    expect(result.size).toBe(0);
  });

  it("returns empty set when card moves forward", () => {
    const prev = [col("backlog", []), col("implement", [{ taskId: "T-001" }]), col("audit", []), col("fim", [])];
    const next = [col("backlog", []), col("implement", []), col("audit", [{ taskId: "T-001" }]), col("fim", [])];
    const result = detectGotoCards(prev, next);
    expect(result.size).toBe(0);
  });

  it("detects card that moved backward (goto)", () => {
    const prev = [col("backlog", []), col("implement", []), col("audit", [{ taskId: "T-001" }]), col("fim", [])];
    const next = [col("backlog", []), col("implement", [{ taskId: "T-001" }]), col("audit", []), col("fim", [])];
    const result = detectGotoCards(prev, next);
    expect(result).toEqual(new Set(["T-001"]));
  });

  it("detects multiple cards with goto", () => {
    const prev = [
      col("backlog", []),
      col("implement", []),
      col("audit", [{ taskId: "T-001" }, { taskId: "T-002" }]),
      col("fim", []),
    ];
    const next = [
      col("backlog", []),
      col("implement", [{ taskId: "T-001" }, { taskId: "T-002" }]),
      col("audit", []),
      col("fim", []),
    ];
    const result = detectGotoCards(prev, next);
    expect(result).toEqual(new Set(["T-001", "T-002"]));
  });

  it("ignores cards that moved to Fim (terminal)", () => {
    const prev = [col("backlog", []), col("implement", [{ taskId: "T-001" }]), col("fim", [])];
    const next = [col("backlog", []), col("implement", []), col("fim", [{ taskId: "T-001", status: "done" }])];
    const result = detectGotoCards(prev, next);
    expect(result.size).toBe(0);
  });

  it("ignores new cards (not in previous state)", () => {
    const prev = [col("backlog", []), col("implement", []), col("fim", [])];
    const next = [col("backlog", []), col("implement", [{ taskId: "T-001" }]), col("fim", [])];
    const result = detectGotoCards(prev, next);
    expect(result.size).toBe(0);
  });

  it("detects card moving from implement back to Backlog as backward movement", () => {
    const prev = [col("backlog", []), col("implement", [{ taskId: "T-001" }]), col("fim", [])];
    const next = [col("backlog", [{ taskId: "T-001" }]), col("implement", []), col("fim", [])];
    const result = detectGotoCards(prev, next);
    expect(result).toEqual(new Set(["T-001"]));
  });
});
