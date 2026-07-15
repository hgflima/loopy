/**
 * Tests for the telemetry annotation subcommands (T-008, C-0017), the write
 * surface the GUI drives as a one-shot subprocess (D6/D20, pattern `probe-agent`):
 *
 *  - `verdict set --task <id> --pass|--fail [--note] [--by]` — upsert
 *  - `verdict clear --task <id>`                             — DELETE (tri-state NULL)
 *  - `bug add --task <id> --severity <s> --title <t> [...]`  — insert (FK to task)
 *  - `change --abandoned|--failed [--change <id>]`           — close the dimension
 *
 * Each runs against a `.db/telemetry.db` seeded directly by the write layer, then
 * asserts the row + exit code end-to-end through `run(argv, io)`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../../src/index";
import { openDb } from "../../src/telemetry/db";
import { bootstrap } from "../../src/telemetry/schema";
import { insertChange, insertTask } from "../../src/telemetry/write";
import type { TelemetryDb } from "../../src/telemetry/db";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      out: (t: string) => out.push(t),
      err: (t: string) => err.push(t),
    },
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

/** Seed a `.db/telemetry.db` under `dir` with two changes and one task each. */
async function seed(dir: string): Promise<void> {
  mkdirSync(join(dir, ".db"), { recursive: true });
  const db = await openDb(join(dir, ".db", "telemetry.db"));
  await bootstrap(db);
  for (const [id, created] of [
    ["C-0016", "2026-07-01T00:00:00.000Z"],
    ["C-0017", "2026-07-14T00:00:00.000Z"],
  ] as const) {
    insertChange(db, {
      change_id: id,
      name: `${id}-name`,
      repo: "acp-agentic-loop",
      base_sha: "abc",
      pipeline_version: "sha256:pv",
      created_at: created,
    });
  }
  insertTask(db, {
    task_id: "C-0016/T-002",
    change_id: "C-0016",
    task_number: "T-002",
    name: "prev-change task",
    created_at: "2026-07-01T00:00:00.000Z",
    ended_at: "2026-07-01T00:05:00.000Z",
    status: "merged",
    size_files: 1,
    size_added: 2,
    size_removed: 0,
  });
  db.close();
}

/** Open the seeded db read-only for assertions. */
async function withDb<T>(dir: string, fn: (db: TelemetryDb) => T): Promise<T> {
  const db = await openDb(join(dir, ".db", "telemetry.db"));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

describe("run — telemetry annotation subcommands (T-008)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "loopy-cli-annotate-"));
    await seed(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("verdict set --pass upserts a verdict row", async () => {
    const cap = capture();
    const code = await run(
      ["verdict", "set", "--task", "C-0016/T-002", "--pass", "--by", "tester", dir],
      cap.io,
    );
    expect(code).toBe(0);
    const row = await withDb(dir, (db) =>
      db
        .prepare("SELECT verdict, by FROM task_verdict WHERE task_id='C-0016/T-002'")
        .get<{ verdict: string; by: string }>(),
    );
    expect(row?.verdict).toBe("pass");
    expect(row?.by).toBe("tester");
  });

  it("verdict set is an upsert — a later --fail flips the same row", async () => {
    const cap = capture();
    await run(
      ["verdict", "set", "--task", "C-0016/T-002", "--pass", "--by", "a", dir],
      cap.io,
    );
    await run(
      ["verdict", "set", "--task", "C-0016/T-002", "--fail", "--note", "regress", "--by", "b", dir],
      cap.io,
    );
    const rows = await withDb(dir, (db) =>
      db.all<{ verdict: string; note: string; by: string }>(
        "SELECT verdict, note, by FROM task_verdict WHERE task_id='C-0016/T-002'",
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ verdict: "fail", note: "regress", by: "b" });
  });

  it("verdict clear removes the row (tri-state back to NULL)", async () => {
    const cap = capture();
    await run(
      ["verdict", "set", "--task", "C-0016/T-002", "--pass", "--by", "a", dir],
      cap.io,
    );
    const code = await run(["verdict", "clear", "--task", "C-0016/T-002", dir], cap.io);
    expect(code).toBe(0);
    const rows = await withDb(dir, (db) =>
      db.all("SELECT * FROM task_verdict WHERE task_id='C-0016/T-002'"),
    );
    expect(rows).toHaveLength(0);
  });

  it("verdict set without --pass/--fail is a usage error (exit 1)", async () => {
    const cap = capture();
    const code = await run(["verdict", "set", "--task", "C-0016/T-002", dir], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr()).toContain("--pass");
  });

  it("verdict set with BOTH --pass and --fail is a usage error (exit 1)", async () => {
    const cap = capture();
    const code = await run(
      ["verdict", "set", "--task", "C-0016/T-002", "--pass", "--fail", dir],
      cap.io,
    );
    expect(code).toBe(1);
  });

  it("verdict set on an unknown task → exit 1 with an actionable message", async () => {
    const cap = capture();
    const code = await run(
      ["verdict", "set", "--task", "C-9999/T-1", "--pass", "--by", "a", dir],
      cap.io,
    );
    expect(code).toBe(1);
    expect(cap.stderr()).toContain("C-9999/T-1");
  });

  it("bug add of a PREVIOUS change's task links the bug to that task (the acceptance)", async () => {
    const cap = capture();
    const code = await run(
      [
        "bug", "add",
        "--task", "C-0016/T-002",
        "--severity", "high",
        "--title", "late regression",
        "--found-in", "C-0017",
        dir,
      ],
      cap.io,
    );
    expect(code).toBe(0);
    const row = await withDb(dir, (db) =>
      db
        .prepare("SELECT task_id, found_in_change, severity, status FROM bug")
        .get<Record<string, unknown>>(),
    );
    expect(row).toMatchObject({
      task_id: "C-0016/T-002",
      found_in_change: "C-0017",
      severity: "high",
      status: "open",
    });
  });

  it("bug add without --severity/--title is a usage error (exit 1)", async () => {
    const cap = capture();
    const code = await run(["bug", "add", "--task", "C-0016/T-002", dir], cap.io);
    expect(code).toBe(1);
  });

  it("bug add with an invalid severity is a usage error (exit 1)", async () => {
    const cap = capture();
    const code = await run(
      ["bug", "add", "--task", "C-0016/T-002", "--severity", "huge", "--title", "x", dir],
      cap.io,
    );
    expect(code).toBe(1);
    expect(cap.stderr()).toContain("severidade");
  });

  it("change --abandoned --change closes the dimension", async () => {
    const cap = capture();
    const code = await run(["change", "--abandoned", "--change", "C-0017", dir], cap.io);
    expect(code).toBe(0);
    const row = await withDb(dir, (db) =>
      db
        .prepare("SELECT status, ended_at FROM change WHERE change_id='C-0017'")
        .get<{ status: string; ended_at: string }>(),
    );
    expect(row?.status).toBe("abandoned");
    expect(row?.ended_at).toBeTruthy();
  });

  it("change without --abandoned/--failed is a usage error (exit 1)", async () => {
    const cap = capture();
    const code = await run(["change", "--change", "C-0017", dir], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr()).toContain("--abandoned");
  });

  it("change --abandoned is ambiguous with two open changes (exit 1, names them)", async () => {
    const cap = capture();
    const code = await run(["change", "--abandoned", dir], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr()).toContain("C-0016");
    expect(cap.stderr()).toContain("C-0017");
  });
});

describe("run — telemetry subcommands without a .db", () => {
  it("verdict set errors clearly when no telemetry .db exists (exit 1)", async () => {
    const empty = mkdtempSync(join(tmpdir(), "loopy-cli-nodb-"));
    const cap = capture();
    try {
      const code = await run(
        ["verdict", "set", "--task", "C-0016/T-002", "--pass", "--by", "a", empty],
        cap.io,
      );
      expect(code).toBe(1);
      expect(cap.stderr()).toContain("telemetria");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
