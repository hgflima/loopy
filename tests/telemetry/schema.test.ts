import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, type TelemetryDb } from "../../src/telemetry/db";
import {
  bootstrap,
  configId,
  pipelineVersion,
  promptVersion,
  resolvedJson,
} from "../../src/telemetry/schema";
import { pipelineFingerprint } from "../../src/resume/state";
import type { AgentDef } from "../../src/types";

// A hand-seeded `.db` (D24/D25 fixture): one merged change with ≥2 tasks and a
// fix-loop (T-002 revisits its agent step → visit_no=2). Timestamps are fixed
// so durations/aggregations are deterministic.
const SEED_SQL = `
INSERT INTO agent_config
  (config_id, preset, model, mode, effort, prompt_version, resolved_json, first_seen_at)
VALUES
  ('cfg1','claude','claude-opus','acceptEdits','high','pv1','{"command":["claude"]}','2026-07-14T00:00:00Z');

INSERT INTO price
  (price_version, model, usd_per_mtok_in, usd_per_mtok_out, usd_per_mtok_cache_read, usd_per_mtok_cache_write, effective_from)
VALUES
  ('2026-07','claude-opus',15.0,75.0,1.5,18.75,'2026-07-01T00:00:00Z');

INSERT INTO change
  (change_id, name, repo, base_sha, pipeline_version, created_at, ended_at, status)
VALUES
  ('C-0017','telemetry','acp-agentic-loop','abc123','sha256:pipe','2026-07-14T00:00:00Z','2026-07-14T02:00:00Z','merged');

INSERT INTO task
  (task_id, change_id, task_number, name, created_at, ended_at, status, size_files, size_added, size_removed)
VALUES
  ('C-0017/T-001','C-0017','T-001','adapter','2026-07-14T00:00:00Z','2026-07-14T00:30:00Z','merged',2,100,10),
  ('C-0017/T-002','C-0017','T-002','schema', '2026-07-14T00:30:00Z','2026-07-14T01:30:00Z','merged',3,200,20);

-- T-001: a single agent attempt that passed (first_pass).
INSERT INTO step
  (step_id, task_id, change_id, seq, name, kind, visit_no, attempt_no, config_id,
   started_at, ended_at, status,
   tokens_in, tokens_out, tokens_cache_read, tokens_cache_write, cost_usd, cost_confidence)
VALUES
  ('s1','C-0017/T-001','C-0017',1,'implement','agent',1,1,'cfg1',
   '2026-07-14T00:00:00Z','2026-07-14T00:20:00Z','pass',
   1000,500,200,50,0.10,'exact');

-- T-002: agent failed on visit 1, passed on visit 2 (the fix-loop), then a human merge gate.
INSERT INTO step
  (step_id, task_id, change_id, seq, name, kind, visit_no, attempt_no, config_id,
   started_at, ended_at, status, fail_reason,
   tokens_in, tokens_out, tokens_cache_read, tokens_cache_write, cost_usd, cost_confidence)
VALUES
  ('s2','C-0017/T-002','C-0017',1,'implement','agent',1,1,'cfg1',
   '2026-07-14T00:30:00Z','2026-07-14T00:50:00Z','fail','test-fail',
   2000,800,300,80,0.20,'exact');
INSERT INTO step
  (step_id, task_id, change_id, seq, name, kind, visit_no, attempt_no, config_id,
   started_at, ended_at, status,
   tokens_in, tokens_out, tokens_cache_read, tokens_cache_write, cost_usd, cost_confidence)
VALUES
  ('s3','C-0017/T-002','C-0017',2,'implement','agent',2,1,'cfg1',
   '2026-07-14T00:50:00Z','2026-07-14T01:10:00Z','pass',
   1500,600,250,60,0.15,'exact');
INSERT INTO step
  (step_id, task_id, change_id, seq, name, kind, visit_no, attempt_no,
   started_at, ended_at, status, human_seconds, cost_confidence)
VALUES
  ('s4','C-0017/T-002','C-0017',3,'merge','approval',1,1,
   '2026-07-14T01:10:00Z','2026-07-14T01:12:00Z','pass',42.0,'exact');

INSERT INTO task_verdict (task_id, verdict, note, by, at)
VALUES
  ('C-0017/T-001','pass','lgtm','alice','2026-07-14T03:00:00Z'),
  ('C-0017/T-002','fail','regressão','alice','2026-07-14T03:05:00Z');

INSERT INTO bug
  (bug_id, task_id, found_in_change, title, detail, severity, status, reported_at)
VALUES
  ('b1','C-0017/T-002','C-0017','off-by-one','loop bound','high','open','2026-07-14T04:00:00Z');
`;

describe("telemetry schema — bootstrap", () => {
  let dir: string;
  let db: TelemetryDb;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "loopy-schema-"));
    db = await openDb(join(dir, "telemetry.db"));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("applies the DDL and stamps user_version", async () => {
    await bootstrap(db);
    expect(
      db.all<{ user_version: number }>("PRAGMA user_version")[0]?.user_version,
    ).toBe(1);
    const tables = db
      .all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .map((r) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "agent_config",
        "bug",
        "change",
        "price",
        "step",
        "task",
        "task_verdict",
      ]),
    );
  });

  it("is idempotent — a second bootstrap does not throw and leaves user_version at 1", async () => {
    await bootstrap(db);
    await expect(bootstrap(db)).resolves.toBeUndefined();
    expect(
      db.all<{ user_version: number }>("PRAGMA user_version")[0]?.user_version,
    ).toBe(1);
  });
});

describe("telemetry schema — identity hashes", () => {
  const base = {
    preset: "claude",
    model: "claude-opus",
    mode: "acceptEdits",
    effort: "high",
    promptVersion: "pv1",
  } as const;

  it("configId is stable for equal inputs and distinct for different ones", () => {
    expect(configId(base)).toBe(configId({ ...base }));
    expect(configId(base)).not.toBe(configId({ ...base, model: "claude-sonnet" }));
    expect(configId(base)).not.toBe(configId({ ...base, mode: "plan" }));
    expect(configId(base)).not.toBe(configId({ ...base, effort: "low" }));
    expect(configId(base)).not.toBe(configId({ ...base, preset: "codex" }));
    expect(configId(base)).not.toBe(configId({ ...base, promptVersion: "pv2" }));
  });

  it("configId treats a missing effort distinctly from a present one", () => {
    expect(configId({ ...base, effort: null })).toBe(
      configId({ ...base, effort: undefined }),
    );
    expect(configId({ ...base, effort: null })).not.toBe(configId(base));
  });

  it("promptVersion hashes the pre-interpolation template (prompt + retry_prompt)", () => {
    const a = promptVersion({ prompt: "implement ${task.body}" });
    expect(a).toBe(promptVersion({ prompt: "implement ${task.body}" }));
    // Same prompt, different retry_prompt → distinct version.
    expect(promptVersion({ prompt: "p", retry_prompt: "r1" })).not.toBe(
      promptVersion({ prompt: "p", retry_prompt: "r2" }),
    );
    // Absent retry_prompt is distinct from an empty one (selectPrompt semantics).
    expect(promptVersion({ prompt: "p" })).not.toBe(
      promptVersion({ prompt: "p", retry_prompt: "" }),
    );
  });

  it("pipelineVersion reuses pipelineFingerprint", () => {
    const pipeline = [
      { id: "implement", type: "agent" as const, prompt: "go" },
    ];
    expect(pipelineVersion(pipeline)).toBe(pipelineFingerprint(pipeline));
  });
});

describe("telemetry schema — resolvedJson (D24, no env leak)", () => {
  it("serializes the declared AgentDef with ${env.KEY} templates, never process.env values", () => {
    const SECRET = "sk-SUPER-SECRET-VALUE";
    process.env.LOOPY_TEST_SECRET = SECRET;
    try {
      const agent: AgentDef = {
        command: ["codex", "acp"],
        env: { OPENAI_API_KEY: "${env.LOOPY_TEST_SECRET}" },
        model: "gpt-5",
      };
      const json = resolvedJson(agent);
      expect(json).toContain("${env.LOOPY_TEST_SECRET}");
      expect(json).not.toContain(SECRET);
      // Round-trips back to the declared form.
      expect(JSON.parse(json)).toMatchObject({
        command: ["codex", "acp"],
        env: { OPENAI_API_KEY: "${env.LOOPY_TEST_SECRET}" },
        model: "gpt-5",
      });
    } finally {
      delete process.env.LOOPY_TEST_SECRET;
    }
  });
});

describe("telemetry schema — the 6 views over a hand-seeded db", () => {
  let dir: string;
  let db: TelemetryDb;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "loopy-views-"));
    db = await openDb(join(dir, "telemetry.db"));
    await bootstrap(db);
    db.run(SEED_SQL);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("v_step exposes per-attempt rows with visit_no/attempt_no and joined config", () => {
    const rows = db.all<{
      step_id: string;
      visit_no: number;
      attempt_no: number;
      model: string | null;
      work_s: number;
    }>("SELECT step_id, visit_no, attempt_no, model, work_s FROM v_step ORDER BY step_id");
    expect(rows).toHaveLength(4);
    const s3 = rows.find((r) => r.step_id === "s3");
    expect(s3?.visit_no).toBe(2); // the fix-loop revisit
    expect(s3?.model).toBe("claude-opus"); // joined from agent_config
    expect(s3?.work_s).toBeCloseTo(20 * 60, 3); // 00:50 → 01:10
    // The approval step has no config → model NULL.
    expect(rows.find((r) => r.step_id === "s4")?.model).toBeNull();
  });

  it("v_task_bugs aggregates open bugs per task", () => {
    const rows = db.all<{ task_id: string; bugs: number; bugs_open: number }>(
      "SELECT task_id, bugs, bugs_open FROM v_task_bugs",
    );
    expect(rows).toEqual([
      { task_id: "C-0017/T-002", bugs: 1, bugs_open: 1 },
    ]);
  });

  it("v_task computes attempts (MAX visit_no), first_pass, SUM(cost) and bug counts", () => {
    const t1 = db
      .prepare("SELECT * FROM v_task WHERE task_id = :id")
      .get<Record<string, number | string | null>>({ id: "C-0017/T-001" });
    const t2 = db
      .prepare("SELECT * FROM v_task WHERE task_id = :id")
      .get<Record<string, number | string | null>>({ id: "C-0017/T-002" });

    expect(t1?.attempts).toBe(1);
    expect(t1?.first_pass).toBe(1);
    expect(Number(t1?.cost_usd)).toBeCloseTo(0.1, 6);
    expect(t1?.bugs).toBe(0);
    expect(t1?.human_verdict).toBe("pass");

    expect(t2?.attempts).toBe(2); // fix-loop → MAX visit_no
    expect(t2?.first_pass).toBe(0); // a step failed on the way
    expect(Number(t2?.cost_usd)).toBeCloseTo(0.35, 6); // 0.20 + 0.15 (D-0008)
    expect(Number(t2?.human_s)).toBeCloseTo(42, 6);
    expect(t2?.bugs).toBe(1);
    expect(t2?.human_verdict).toBe("fail"); // escaped defect (D23)
  });

  it("v_change sums task costs (paying D-0008) and churn", () => {
    const c = db
      .prepare("SELECT * FROM v_change WHERE change_id = :id")
      .get<Record<string, number | string | null>>({ id: "C-0017" });
    expect(c?.tasks).toBe(2);
    expect(Number(c?.cost_usd)).toBeCloseTo(0.45, 6); // 0.10 + 0.35
    expect(Number(c?.churn)).toBe(330); // (100+10) + (200+20)
    expect(c?.status).toBe("merged");
  });

  it("v_change_baseline excludes open changes and computes population sd by hand (D17)", () => {
    const b = db
      .prepare("SELECT * FROM v_change_baseline")
      .get<Record<string, number>>();
    expect(b?.n).toBe(1); // only the merged change
    expect(Number(b?.cost_usd)).toBeCloseTo(0.45, 6);
    expect(Number(b?.cost_usd_sd)).toBeCloseTo(0, 9); // single sample → sd 0
  });

  it("v_step_repriced recomputes cost from the price table", () => {
    const s1 = db
      .prepare("SELECT * FROM v_step_repriced WHERE step_id = :id")
      .get<Record<string, number | string | null>>({ id: "s1" });
    // (1000*15 + 500*75 + 200*1.5 + 50*18.75) / 1e6
    expect(Number(s1?.cost_usd_repriced)).toBeCloseTo(0.0537375, 9);
    expect(Number(s1?.cost_usd_original)).toBeCloseTo(0.1, 6);
  });
});
