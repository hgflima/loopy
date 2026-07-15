/**
 * Tests for the internal typed SELECTs (`src/telemetry/query.ts`) reused by
 * `annotate` (D19 — not a CLI read surface; the GUI reads via Rust). They
 * pre-check existence and resolve the default open change so the annotation
 * writers return clean, typed results instead of leaning on FK exceptions.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, type TelemetryDb } from "../../src/telemetry/db";
import { bootstrap } from "../../src/telemetry/schema";
import { insertChange, insertTask } from "../../src/telemetry/write";
import {
  changeStatus,
  openChangeIds,
  taskExists,
} from "../../src/telemetry/query";

function seedChange(db: TelemetryDb, id: string, createdAt: string): void {
  insertChange(db, {
    change_id: id,
    name: `${id}-name`,
    repo: "acp-agentic-loop",
    base_sha: "abc",
    pipeline_version: "sha256:pv",
    created_at: createdAt,
  });
}

function seedTask(db: TelemetryDb, changeId: string, taskId: string): void {
  insertTask(db, {
    task_id: taskId,
    change_id: changeId,
    task_number: taskId.split("/")[1] ?? taskId,
    name: "some task",
    created_at: "2026-07-14T00:00:00.000Z",
    ended_at: "2026-07-14T00:05:00.000Z",
    status: "merged",
    size_files: 1,
    size_added: 2,
    size_removed: 0,
  });
}

describe("telemetry query — taskExists / changeStatus / openChangeIds", () => {
  let dir: string;
  let db: TelemetryDb;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "loopy-query-"));
    db = await openDb(join(dir, "telemetry.db"));
    await bootstrap(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("taskExists is true for a seeded task and false otherwise", () => {
    seedChange(db, "C-0017", "2026-07-14T00:00:00.000Z");
    seedTask(db, "C-0017", "C-0017/T-001");
    expect(taskExists(db, "C-0017/T-001")).toBe(true);
    expect(taskExists(db, "C-0017/T-999")).toBe(false);
  });

  it("changeStatus returns {status:null} for an open change", () => {
    seedChange(db, "C-0017", "2026-07-14T00:00:00.000Z");
    expect(changeStatus(db, "C-0017")).toEqual({ status: null });
  });

  it("changeStatus returns the terminal status once closed", () => {
    seedChange(db, "C-0017", "2026-07-14T00:00:00.000Z");
    db.prepare(
      "UPDATE change SET status='merged', ended_at='t' WHERE change_id='C-0017'",
    ).run();
    expect(changeStatus(db, "C-0017")).toEqual({ status: "merged" });
  });

  it("changeStatus returns undefined for an unknown change", () => {
    expect(changeStatus(db, "C-9999")).toBeUndefined();
  });

  it("openChangeIds lists only open changes, oldest first", () => {
    seedChange(db, "C-0002", "2026-07-02T00:00:00.000Z");
    seedChange(db, "C-0001", "2026-07-01T00:00:00.000Z");
    seedChange(db, "C-0003", "2026-07-03T00:00:00.000Z");
    // Close C-0002 so it drops out of the open set.
    db.prepare(
      "UPDATE change SET status='merged', ended_at='t' WHERE change_id='C-0002'",
    ).run();
    expect(openChangeIds(db)).toEqual(["C-0001", "C-0003"]);
  });

  it("openChangeIds is empty when every change is closed", () => {
    seedChange(db, "C-0001", "2026-07-01T00:00:00.000Z");
    db.prepare(
      "UPDATE change SET status='abandoned', ended_at='t' WHERE change_id='C-0001'",
    ).run();
    expect(openChangeIds(db)).toEqual([]);
  });
});
