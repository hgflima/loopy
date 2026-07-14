/**
 * Tests for the `probe-agent <nome>` subcommand (T-008, D30/D32).
 *
 * Integration tests against the scenario-driven fake agent (same pattern as
 * `tests/acp/session.test.ts`): spawn a real subprocess, initialize, session/new,
 * read capabilities, print/cache, shutdown.
 *
 * Plus regressions: `loopy .`, `loopy --dry-run <dir>`, `loopy -t T-002 <dir>`
 * must still route to the root command after the subcommand is registered.
 */
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { stringify as yamlStringify } from "yaml";
import { run } from "../../src/index";
import { readCache } from "../../src/acp/capabilities-cache";
import type { FakeScenario } from "../fixtures/fake-agent";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const FAKE_AGENT = fileURLToPath(
  new URL("../fixtures/fake-agent.ts", import.meta.url),
);
const PROJECT = fileURLToPath(new URL("../fixtures/project", import.meta.url));

/** Spawn command that runs the fake agent under tsx with a JSON scenario. */
function fakeCommand(scenario: FakeScenario): string[] {
  return [
    process.execPath,
    "--import",
    "tsx",
    FAKE_AGENT,
    JSON.stringify(scenario),
  ];
}

/** Build a `SessionConfigOption` for a select category with flat values. */
function selectOption(
  id: string,
  category: string,
  values: readonly string[],
): SessionConfigOption {
  return {
    id,
    name: id,
    category,
    type: "select",
    currentValue: values[0] ?? "",
    options: values.map((v) => ({ value: v, name: v })),
  } as SessionConfigOption;
}

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

/** Write a minimal valid loopy.yml with named agents to a temp directory. */
function writeConfig(
  dir: string,
  agents: Record<string, { command: string[] }>,
): string {
  const configPath = join(dir, "loopy.yml");
  const config = {
    version: "1",
    name: "probe-test",
    workspace: {
      root: ".",
      parent_branch: "main",
      worktrees_dir: ".worktrees",
    },
    agents,
    acp: {
      request_timeout_seconds: 1800,
      permissions: { default_mode: "acceptEdits", on_request: "allow" },
    },
    inputs: {
      spec: "SPEC.md",
      plan: "plan.md",
      todo: "todo.md",
      backlog: {
        pending_marker: "- [ ]",
        done_marker: "- [x]",
        task_id_pattern: "T-\\d+",
        body: "indented",
        mark_done_on_success: true,
      },
    },
    checks: { ci: [{ name: "check", run: "echo ok" }] },
    pipeline: [
      { id: "impl", type: "agent", prompt: "do it", mode: "acceptEdits" },
    ],
    stop_conditions: {
      max_iterations: 1,
      stop_signal_file: ".loopy.stop",
    },
    concurrency: 1,
    policies: {
      escalation: { action: "pause", keep_worktree: true, notify: "stderr" },
      git: { require_clean_parent: true },
    },
    logging: {
      dir: ".loopy/logs",
      per_task: true,
      capture_acp_traffic: false,
    },
  };
  writeFileSync(configPath, yamlStringify(config));
  return configPath;
}

// ---------------------------------------------------------------------------
// Fake agent scenario with all 3 capability categories
// ---------------------------------------------------------------------------

const CAPS_SCENARIO: FakeScenario = {
  configOptions: [
    selectOption("mode-sel", "mode", ["build", "plan"]),
    selectOption("model-sel", "model", ["gpt-4", "gpt-5-codex"]),
    selectOption("effort-sel", "thought_level", ["low", "medium", "high"]),
  ],
};

// ---------------------------------------------------------------------------
// Tests: probe-agent subcommand
// ---------------------------------------------------------------------------

describe("run — probe-agent", () => {
  // Temp dir for configs; each test writes its own loopy.yml.
  const tempDir = mkdtempSync(join(tmpdir(), "probe-"));
  const fakeCmd = fakeCommand(CAPS_SCENARIO);
  const configPath = writeConfig(tempDir, { myagent: { command: fakeCmd } });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("--json prints the AgentCapabilities object", async () => {
    const cap = capture();
    const code = await run(
      ["probe-agent", "myagent", "--json", "-c", configPath],
      cap.io,
    );

    expect(code).toBe(0);
    const parsed = JSON.parse(cap.stdout());
    expect(parsed.modes).toEqual(["build", "plan"]);
    expect(parsed.models).toEqual(["gpt-4", "gpt-5-codex"]);
    expect(parsed.efforts).toEqual(["low", "medium", "high"]);
  });

  it("human-readable output without --json", async () => {
    const cap = capture();
    const code = await run(
      ["probe-agent", "myagent", "-c", configPath],
      cap.io,
    );

    expect(code).toBe(0);
    const out = cap.stdout();
    expect(out).toContain("modes: build, plan");
    expect(out).toContain("models: 2 (gpt-4, gpt-5-codex)");
    expect(out).toContain("efforts: low, medium, high");
  });

  it("writes cache to .loopy/capabilities.json keyed by argv", async () => {
    const cap = capture();
    await run(
      ["probe-agent", "myagent", "--json", "-c", configPath],
      cap.io,
    );

    const cache = readCache(tempDir);
    const key = fakeCmd.join(" ");
    expect(cache[key]).toBeDefined();
    expect(cache[key]!.capabilities.modes).toEqual(["build", "plan"]);
    expect(cache[key]!.probedAt).toBeTruthy();
  });

  it("agent not in registry → exit 1 listing available agents", async () => {
    const cap = capture();
    const code = await run(
      ["probe-agent", "nonexistent", "-c", configPath],
      cap.io,
    );

    expect(code).toBe(1);
    const stderr = cap.stderr();
    expect(stderr).toContain("nonexistent");
    expect(stderr).toContain("myagent");
  });

  it("adapter that fails to start → exit 1 with reason", async () => {
    const badCmd = ["nonexistent-binary-xyz-42"];
    const badConfig = writeConfig(tempDir, {
      broken: { command: badCmd },
    });
    const cap = capture();
    const code = await run(
      ["probe-agent", "broken", "-c", badConfig],
      cap.io,
    );

    expect(code).toBe(1);
    expect(cap.stderr()).toContain("falha ao iniciar");
  });
});

// ---------------------------------------------------------------------------
// Regression: [dir] positional still works after adding probe-agent subcommand
// ---------------------------------------------------------------------------

describe("run — [dir] positional regression after probe-agent subcommand", () => {
  it("loopy <dir> --dry-run routes to root command", async () => {
    const cap = capture();
    const code = await run([PROJECT, "--dry-run"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout()).toContain("dry-run");
    expect(cap.stdout()).toContain("T-002");
  });

  it("loopy --dry-run <dir> routes to root command (flag before positional)", async () => {
    const cap = capture();
    const code = await run(["--dry-run", PROJECT], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout()).toContain("dry-run");
  });

  it("loopy -t T-002 <dir> --dry-run routes to root command", async () => {
    const cap = capture();
    const code = await run(["-t", "T-002", PROJECT, "--dry-run"], cap.io);

    expect(code).toBe(0);
    const out = cap.stdout();
    // --dry-run shows all pending tasks (--task only filters in live flow),
    // but the point is Commander routes to the root command, not probe-agent.
    expect(out).toContain("dry-run");
    expect(out).toContain("T-002");
  });
});
