import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb } from "../../src/telemetry/db";

describe("openDb — runtime-guarded SQLite adapter", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "loopy-tel-"));
    dbPath = join(dir, "telemetry.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("sets WAL + busy_timeout + foreign_keys once at bootstrap", async () => {
    const db = await openDb(dbPath);
    try {
      expect(
        db.all<{ journal_mode: string }>("PRAGMA journal_mode")[0]?.journal_mode,
      ).toBe("wal");
      expect(db.all<{ timeout: number }>("PRAGMA busy_timeout")[0]?.timeout).toBe(
        5000,
      );
      expect(
        db.all<{ foreign_keys: number }>("PRAGMA foreign_keys")[0]?.foreign_keys,
      ).toBe(1);
    } finally {
      db.close();
    }
  });

  it("persists WAL in the file header — a second open does not re-derive it from the pragma (D8)", async () => {
    const db = await openDb(dbPath);
    db.run("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    db.close();

    // SQLite header bytes 18/19 = file-format write/read version; 2 means WAL.
    // Their presence proves WAL was written to the header at bootstrap and
    // survives without the pragma being re-executed on reopen.
    const header = readFileSync(dbPath);
    expect(header[18]).toBe(2);
    expect(header[19]).toBe(2);

    const db2 = await openDb(dbPath);
    try {
      expect(
        db2.all<{ journal_mode: string }>("PRAGMA journal_mode")[0]?.journal_mode,
      ).toBe("wal");
    } finally {
      db2.close();
    }
  });

  it("round-trips prepare/run/all/get with named params", async () => {
    const db = await openDb(dbPath);
    try {
      db.run("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
      const ins = db.prepare("INSERT INTO t (id, name) VALUES (:id, :name)");
      const first = ins.run({ id: 1, name: "alpha" });
      expect(Number(first.changes)).toBe(1);
      ins.run({ id: 2, name: "beta" });

      const rows = db.all<{ id: number; name: string }>(
        "SELECT id, name FROM t ORDER BY id",
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]?.id).toBe(1);
      expect(rows[0]?.name).toBe("alpha");

      const one = db
        .prepare("SELECT name FROM t WHERE id = :id")
        .get<{ name: string }>({ id: 2 });
      expect(one?.name).toBe("beta");
    } finally {
      db.close();
    }
  });

  it("close() is idempotent — a second call does not throw", async () => {
    const db = await openDb(dbPath);
    db.close();
    expect(() => db.close()).not.toThrow();
  });
});
