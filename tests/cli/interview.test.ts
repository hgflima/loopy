/**
 * CLI wiring for the `interview <dir>` subcommand (C-0018 T-006, ADR-0012).
 *
 * The subcommand registers alongside `probe-agent` (Commander matches subcommands
 * before the root `[dir]` positional, so there is no ambiguity) and drives ONE
 * phase of an Interview by delegating to {@link runInterview} (T-005). These tests
 * exercise the CLI logic — the `--emit-events` gate, `--phase` validation, help,
 * agent/change resolution, and the exit codes — deterministically, injecting the
 * `runInterview` hook so no ACP subprocess ever spawns (real runs are manual/e2e).
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run, type RunHooks } from "../../src/index";
import type { RunInterviewOptions } from "../../src/interview/run";

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

/** A hooks bundle that records the `runInterview` options and returns a code. */
function recordingHooks(
  impl?: (options: RunInterviewOptions) => Promise<number> | number,
): { readonly hooks: RunHooks; readonly calls: RunInterviewOptions[] } {
  const calls: RunInterviewOptions[] = [];
  const hooks: RunHooks = {
    runInterview: async (options) => {
      calls.push(options);
      return impl ? await impl(options) : 0;
    },
  };
  return { hooks, calls };
}

const CLAUDE_COMMAND = [
  "npx",
  "-y",
  "@agentclientprotocol/claude-agent-acp@0.59.0",
];

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0))
    rmSync(d, { recursive: true, force: true });
});

/** A temp project with a single change folder under `.harn/devy/changes/`. */
function projectWithChange(changeFolder: string): string {
  const root = mkdtempSync(join(tmpdir(), "loopy-interview-"));
  tmpDirs.push(root);
  mkdirSync(join(root, ".harn/devy/changes", changeFolder), {
    recursive: true,
  });
  return root;
}

describe("loopy interview — the --emit-events gate", () => {
  it("without --emit-events exits 2 with a message and writes nothing to stdout", async () => {
    const cap = capture();
    const { hooks, calls } = recordingHooks();

    const code = await run(["interview", "."], cap.io, hooks);

    expect(code).toBe(2);
    expect(cap.stderr()).toMatch(/emit-events/);
    expect(cap.stdout()).toBe("");
    // The gate short-circuits: runInterview is never reached.
    expect(calls).toHaveLength(0);
  });
});

describe("loopy interview — usage validation", () => {
  it("--phase outside {spec,refine,plan} is a usage error", async () => {
    const cap = capture();
    const { hooks, calls } = recordingHooks();

    const code = await run(
      ["interview", ".", "--emit-events", "--phase", "bogus"],
      cap.io,
      hooks,
    );

    expect(code).not.toBe(0);
    // Commander lists the allowed choices in the error.
    expect(cap.stderr()).toMatch(/spec/);
    expect(calls).toHaveLength(0);
  });

  it("refine without --change is a usage error (only spec creates a Change)", async () => {
    const cap = capture();
    const { hooks, calls } = recordingHooks();

    const code = await run(
      ["interview", ".", "--emit-events", "--phase", "refine"],
      cap.io,
      hooks,
    );

    expect(code).toBe(1);
    expect(cap.stderr()).toMatch(/--change/);
    expect(calls).toHaveLength(0);
  });

  it("an unknown --agent preset is a usage error", async () => {
    const cap = capture();
    const { hooks, calls } = recordingHooks();

    const code = await run(
      ["interview", ".", "--emit-events", "--agent", "nope"],
      cap.io,
      hooks,
    );

    expect(code).toBe(1);
    expect(cap.stderr()).toMatch(/nope/);
    expect(calls).toHaveLength(0);
  });

  it("--help lists all the flags and exits 0", async () => {
    const cap = capture();

    const code = await run(["interview", "--help"], cap.io);

    expect(code).toBe(0);
    const help = cap.stdout();
    for (const flag of [
      "--emit-events",
      "--change",
      "--phase",
      "--agent",
      "--model",
      "--effort",
    ]) {
      expect(help).toContain(flag);
    }
  });
});

describe("loopy interview — wiring to runInterview", () => {
  it("defaults to the spec phase and the claude preset, writing only NDJSON to stdout", async () => {
    const cap = capture();
    const { hooks, calls } = recordingHooks((options) => {
      // Prove the transport lands on stdout as NDJSON.
      options.transport?.emitControl({
        control: "phase_started",
        phase: options.phase,
        command: "/devy:spec",
      });
      return 0;
    });

    const code = await run(
      ["interview", "/tmp/proj", "--emit-events"],
      cap.io,
      hooks,
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    const opts = calls[0]!;
    expect(opts.dir).toBe("/tmp/proj");
    expect(opts.phase).toBe("spec");
    expect(opts.agent).toBe("claude");
    expect(opts.command).toEqual(CLAUDE_COMMAND);
    expect(opts.changeDir).toBeUndefined();

    // Every stdout line is a single NDJSON frame; nothing else leaks there.
    const lines = cap.stdout().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    expect(cap.stdout()).toContain('"control":"phase_started"');
  });

  it("threads --model and --effort through to runInterview", async () => {
    const cap = capture();
    const { hooks, calls } = recordingHooks();

    const code = await run(
      [
        "interview",
        "/tmp/proj",
        "--emit-events",
        "--model",
        "opus",
        "--effort",
        "high",
      ],
      cap.io,
      hooks,
    );

    expect(code).toBe(0);
    expect(calls[0]!.model).toBe("opus");
    expect(calls[0]!.effort).toBe("high");
  });

  it("--change resolves the Change id (with slug) to its dir for a refine phase", async () => {
    const cap = capture();
    const root = projectWithChange("C-0018-specs-authoring");
    const { hooks, calls } = recordingHooks();

    const code = await run(
      [
        "interview",
        root,
        "--emit-events",
        "--change",
        "C-0018",
        "--phase",
        "refine",
      ],
      cap.io,
      hooks,
    );

    expect(code).toBe(0);
    expect(calls[0]!.phase).toBe("refine");
    expect(calls[0]!.changeDir).toBe(
      ".harn/devy/changes/C-0018-specs-authoring",
    );
  });

  it("a --change id with no matching folder is a usage error", async () => {
    const cap = capture();
    const root = projectWithChange("C-0018-specs-authoring");
    const { hooks, calls } = recordingHooks();

    const code = await run(
      [
        "interview",
        root,
        "--emit-events",
        "--change",
        "C-9999",
        "--phase",
        "plan",
      ],
      cap.io,
      hooks,
    );

    expect(code).toBe(1);
    expect(cap.stderr()).toMatch(/C-9999/);
    expect(calls).toHaveLength(0);
  });

  it("propagates the runInterview exit code", async () => {
    const cap = capture();
    const { hooks } = recordingHooks(() => 1);

    const code = await run(
      ["interview", "/tmp/proj", "--emit-events"],
      cap.io,
      hooks,
    );

    expect(code).toBe(1);
  });
});

describe("loopy interview — the root command still routes", () => {
  it("`loopy --help` still lists the root usage (subcommand does not shadow it)", async () => {
    const cap = capture();

    const code = await run(["--help"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout()).toContain("interview");
  });
});
