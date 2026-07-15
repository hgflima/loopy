import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

import { openDb, type TelemetryDb } from "../../src/telemetry/db";
import { bootstrap } from "../../src/telemetry/schema";
import { pipelineFingerprint } from "../../src/resume/state";
import { repoNameFrom, runLoop } from "../../src/loop/orchestrator";
import type { GitPort, LoopyConfig } from "../../src/types";
import {
  makeConfig,
  makeDeps,
  makeTask,
  recordingMarkDone,
  scriptedRegistry,
  shell,
} from "../loop/support";

// Point the backlog at a real change dir so the id carries a `C-\d+` prefix (D26).
function changeConfig(config: LoopyConfig): LoopyConfig {
  return {
    ...config,
    inputs: {
      ...config.inputs,
      todo: ".harn/devy/changes/C-0017-telemetry-and-change-insights/todo.md",
    },
  };
}

function tickingClock(startMs = 1_000_000): () => number {
  let t = startMs - 1000;
  return () => (t += 1000);
}

// A safe `GitPort` stub: the change insert reads revParseHead/remoteOriginUrl,
// and the loop's `require_clean_parent` hint reads isParentClean — all default
// to harmless values so wiring git never derails the scripted pipeline.
function gitStub(over: Partial<GitPort>): GitPort {
  return {
    addWorktree: async () => {},
    removeWorktree: async () => {},
    merge: async () => ({ ok: true, conflict: false }),
    isParentClean: async () => true,
    isMergeInProgress: async () => false,
    rebaseOnto: async () => ({ ok: true, conflict: false }),
    revParseHead: async () => null,
    remoteOriginUrl: async () => null,
    ...over,
  };
}

interface ChangeShape {
  change_id: string;
  name: string;
  repo: string;
  base_sha: string | null;
  pipeline_version: string;
  created_at: string;
  ended_at: string | null;
  status: string | null;
}

const ONE_CHANGE = "SELECT * FROM change";

/**
 * Run the single-task scripted loop with the C-0017 change config, wiring only
 * the deps a test exercises (telemetry, git, root). Returns the config so the
 * caller can assert `change.pipeline_version` against its fingerprint. The clock
 * ticks deterministically; no test asserts `created_at`, so it stays internal.
 */
async function runChangeLoop(deps: {
  telemetry?: TelemetryDb;
  git?: GitPort;
  root?: string;
}): Promise<LoopyConfig> {
  const config = changeConfig(makeConfig([shell("a")]));
  const { port } = recordingMarkDone();
  await runLoop(
    config,
    [makeTask("T-1")],
    makeDeps({
      registry: scriptedRegistry({ order: [] }),
      markDone: port,
      now: tickingClock(),
      ...deps,
    }),
  );
  return config;
}

describe("repoNameFrom (pure — D26)", () => {
  it("takes the basename of an SSH origin, stripping .git", () => {
    expect(
      repoNameFrom("git@github.com:hgflima/acp-agentic-loop.git", "/x/y"),
    ).toBe("acp-agentic-loop");
  });

  it("takes the basename of an HTTPS origin", () => {
    expect(
      repoNameFrom("https://github.com/hgflima/acp-agentic-loop.git", "/x/y"),
    ).toBe("acp-agentic-loop");
  });

  it("keeps an origin basename that has no .git suffix", () => {
    expect(repoNameFrom("https://example.com/team/widgets", "/x/y")).toBe(
      "widgets",
    );
  });

  it("falls back to the workspace dir basename when origin is null", () => {
    expect(repoNameFrom(null, "/home/me/my-repo")).toBe("my-repo");
  });
});

describe("telemetry change dimension — INSERT OR IGNORE at run start (C-0017 / T-005)", () => {
  let dir: string;
  let db: TelemetryDb;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "loopy-change-run-"));
    db = await openDb(join(dir, "telemetry.db"));
    await bootstrap(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("inserts an in-progress change (status NULL) with D26-derived fields", async () => {
    const config = await runChangeLoop({
      telemetry: db,
      root: "/tmp/some/acp-agentic-loop",
    });

    const row = db.prepare(ONE_CHANGE).get<ChangeShape>();
    expect(row?.change_id).toBe("C-0017");
    expect(row?.name).toBe("C-0017-telemetry-and-change-insights");
    expect(row?.pipeline_version).toBe(pipelineFingerprint(config.pipeline));
    // No git wired → base_sha NULL, repo falls back to the workspace dir name.
    expect(row?.base_sha).toBeNull();
    expect(row?.repo).toBe("acp-agentic-loop");
    // In progress until the end-of-change gate marks it merged.
    expect(row?.status).toBeNull();
    expect(row?.ended_at).toBeNull();
  });

  it("reads base_sha and repo from git when present (best-effort)", async () => {
    const git = gitStub({
      revParseHead: async () => "deadbeefcafe",
      remoteOriginUrl: async () =>
        "git@github.com:hgflima/acp-agentic-loop.git",
    });

    await runChangeLoop({ telemetry: db, root: "/tmp/whatever/x", git });

    const row = db.prepare(ONE_CHANGE).get<ChangeShape>();
    expect(row?.base_sha).toBe("deadbeefcafe");
    expect(row?.repo).toBe("acp-agentic-loop");
  });

  it("degrades base_sha to NULL and repo to the dir name when git lookups fail", async () => {
    const root = "/tmp/greenfield/my-fresh-repo";
    const git = gitStub({
      revParseHead: async () => null,
      remoteOriginUrl: async () => null,
    });

    await runChangeLoop({ telemetry: db, root, git });

    const row = db.prepare(ONE_CHANGE).get<ChangeShape>();
    expect(row?.base_sha).toBeNull();
    expect(row?.repo).toBe(basename(root));
  });

  it("inserts NOTHING when telemetry is off (opt-in gate, AD-1)", async () => {
    await runChangeLoop({});

    expect(db.all(ONE_CHANGE)).toHaveLength(0);
  });
});
