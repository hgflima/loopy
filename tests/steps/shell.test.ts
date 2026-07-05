import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createShellStep,
  runShellCommandWithExeca,
  type RunShellCommand,
  type ShellCommandResult,
} from "../../src/steps/shell";
import type { StoreEvent } from "../../src/tui/store";
import { InterpolationError } from "../../src/interp/resolver";
import type { ShellStep } from "../../src/types";
import { makeLogger, makeStepContext, SAMPLE_TASK } from "./support";

/** Build a `shell` step config with sane defaults. */
function shellStep(overrides: Partial<ShellStep> = {}): ShellStep {
  return {
    id: "cmd",
    type: "shell",
    run: ["echo one"],
    ...overrides,
  };
}

/**
 * A fake command runner that records what it was asked to run, in order.
 * `ran` holds each argv joined by spaces (handy for single-token assertions);
 * `argvs` holds the raw argv arrays (so a test can assert exact arg boundaries).
 */
function recordingRunner(
  outcome: (command: string) => Partial<ShellCommandResult> = () => ({}),
): {
  runner: RunShellCommand;
  ran: string[];
  argvs: string[][];
  cwds: string[];
  onChunks: Array<((text: string) => void) | undefined>;
} {
  const ran: string[] = [];
  const argvs: string[][] = [];
  const cwds: string[] = [];
  const onChunks: Array<((text: string) => void) | undefined> = [];
  const runner: RunShellCommand = async (argv, ctx) => {
    const command = argv.join(" ");
    ran.push(command);
    argvs.push([...argv]);
    cwds.push(ctx.cwd);
    onChunks.push(ctx.onChunk);
    const partial = outcome(command);
    const ok = partial.ok ?? true;
    // If onChunk is provided, simulate streaming the output.
    const stdout = partial.stdout ?? "";
    const stderr = partial.stderr ?? "";
    if (ctx.onChunk && stdout) ctx.onChunk(stdout);
    if (ctx.onChunk && stderr) ctx.onChunk(stderr);
    return {
      command,
      exitCode: partial.exitCode ?? (ok ? 0 : 1),
      ok,
      stdout,
      stderr,
    };
  };
  return { runner, ran, argvs, cwds, onChunks };
}

describe("createShellStep — execute", () => {
  it("declares the shell step type", () => {
    expect(createShellStep().type).toBe("shell");
  });

  it("runs every command in order when all succeed", async () => {
    const { runner, ran } = recordingRunner();
    const ctx = makeStepContext({
      step: shellStep({ run: ["a", "b", "c"] }),
    });

    const result = await createShellStep({ runCommand: runner }).execute(ctx);

    expect(result.ok).toBe(true);
    expect(ran).toEqual(["a", "b", "c"]);
  });

  it("interpolates each command per token before running it (quotes consumed)", async () => {
    const { runner, argvs } = recordingRunner();
    const ctx = makeStepContext({
      step: shellStep({
        run: ['git worktree add -b "${task.branch}" "${worktree.path}"'],
      }),
      worktreePath: "/wt/T-001",
      resolve: (t) =>
        t
          .replace("${task.branch}", "loopy/T-001")
          .replace("${worktree.path}", "/wt/T-001"),
    });

    await createShellStep({ runCommand: runner }).execute(ctx);

    // The yml's quotes are structural: they group args, they are not passed on.
    expect(argvs).toEqual([
      ["git", "worktree", "add", "-b", "loopy/T-001", "/wt/T-001"],
    ]);
  });

  it("stops at the first failing command by default (no `always`)", async () => {
    const { runner, ran } = recordingRunner((cmd) =>
      cmd === "b" ? { ok: false, exitCode: 2, stderr: "boom" } : {},
    );
    const ctx = makeStepContext({ step: shellStep({ run: ["a", "b", "c"] }) });

    const result = await createShellStep({ runCommand: runner }).execute(ctx);

    expect(result.ok).toBe(false);
    // "c" must never run — the step short-circuits at the first failure.
    expect(ran).toEqual(["a", "b"]);
  });

  it("surfaces the failing command's exit code and stderr in the result", async () => {
    const { runner } = recordingRunner((cmd) =>
      cmd === "b"
        ? { ok: false, exitCode: 2, stderr: "the failure detail" }
        : {},
    );
    const ctx = makeStepContext({ step: shellStep({ run: ["a", "b"] }) });

    const result = await createShellStep({ runCommand: runner }).execute(ctx);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("b");
    expect(result.reason).toContain("2");
    expect(result.output).toContain("the failure detail");
  });

  it("with `always: true`, runs every command even after one fails (best-effort)", async () => {
    const { runner, ran } = recordingRunner((cmd) =>
      cmd === "remove" ? { ok: false, exitCode: 1, stderr: "no worktree" } : {},
    );
    const ctx = makeStepContext({
      step: shellStep({ always: true, run: ["remove", "branch -D"] }),
    });

    const result = await createShellStep({ runCommand: runner }).execute(ctx);

    // Best-effort cleanup: both commands attempted despite the first failing.
    expect(ran).toEqual(["remove", "branch -D"]);
    // The step still reports the failure truthfully.
    expect(result.ok).toBe(false);
  });

  it("runs commands in the task's worktree cwd", async () => {
    const { runner, cwds } = recordingRunner();
    const ctx = makeStepContext({
      step: shellStep({ run: ["a", "b"] }),
      worktreePath: "/wt/T-042",
    });

    await createShellStep({ runCommand: runner }).execute(ctx);

    expect(cwds).toEqual(["/wt/T-042", "/wt/T-042"]);
  });

  it("aborts before running ANY command when interpolation hits an unknown var (OQ1)", async () => {
    const { runner, ran } = recordingRunner();
    const ctx = makeStepContext({
      step: shellStep({ run: ["ok", "uses ${task.nope}"] }),
      resolve: (t) => {
        if (t.includes("${task.nope}")) {
          throw new InterpolationError("task.nope", "cmd", []);
        }
        return t;
      },
    });

    await expect(
      createShellStep({ runCommand: runner }).execute(ctx),
    ).rejects.toBeInstanceOf(InterpolationError);
    // Fail-fast: not even the first, resolvable command ran.
    expect(ran).toEqual([]);
  });

  it("logs an error line for a failing command", async () => {
    const { runner } = recordingRunner((cmd) =>
      cmd === "boom" ? { ok: false, exitCode: 3 } : {},
    );
    const logger = makeLogger();
    const ctx = makeStepContext({ step: shellStep({ run: ["boom"] }), logger });

    await createShellStep({ runCommand: runner }).execute(ctx);

    expect(logger.errors.join("\n")).toContain("boom");
  });

  it("throws when handed a non-shell step (engine bug, not normal flow)", async () => {
    const ctx = makeStepContext({
      step: { id: "x", type: "checks", run: "ci" },
    });
    await expect(createShellStep().execute(ctx)).rejects.toThrow(/shell/);
  });
});

// ---------------------------------------------------------------------------
// Regression: interpolated DATA (task title/body/diff) must never be handed to
// a shell for a second `$`-expansion. The task titled `... ${...}` used to make
// `git commit -m` fail with `/bin/sh: bad substitution` (and `$(...)` would have
// been silent command injection). Now each command is argv, so the data lands
// as a single literal argument, verbatim.
// ---------------------------------------------------------------------------

describe("createShellStep — interpolated data is never shell-expanded", () => {
  const COMMIT =
    'git -C "${worktree.path}" commit -m "feat(${task.id}): ${task.title}"';

  /** A resolver like the real one: fills known `${...}` keys, leaves data as-is. */
  function resolverFor(title: string): (t: string) => string {
    return (t) =>
      t
        .replace(/\$\{worktree\.path\}/g, () => "/wt/T-004")
        .replace(/\$\{task\.id\}/g, () => "T-004")
        .replace(/\$\{task\.title\}/g, () => title);
  }

  it("passes a title containing ${...} as one literal arg (the original bug)", async () => {
    const { runner, argvs } = recordingRunner();
    const ctx = makeStepContext({
      step: shellStep({ run: [COMMIT] }),
      resolve: resolverFor("Resolver de interpolação ${...}"),
    });

    const result = await createShellStep({ runCommand: runner }).execute(ctx);

    expect(result.ok).toBe(true);
    // The whole commit message is a single argv entry — braces intact, never
    // split, never re-expanded.
    expect(argvs[0]).toEqual([
      "git",
      "-C",
      "/wt/T-004",
      "commit",
      "-m",
      "feat(T-004): Resolver de interpolação ${...}",
    ]);
  });

  it("passes a title containing $(...) as one literal arg (no injection)", async () => {
    const { runner, argvs } = recordingRunner();
    const ctx = makeStepContext({
      step: shellStep({ run: [COMMIT] }),
      resolve: resolverFor("boom $(rm -rf ~) end"),
    });

    await createShellStep({ runCommand: runner }).execute(ctx);

    expect(argvs[0]?.[5]).toBe("feat(T-004): boom $(rm -rf ~) end");
  });

  it("passes a title with quotes/semicolons/backticks as one literal arg", async () => {
    const { runner, argvs } = recordingRunner();
    const ctx = makeStepContext({
      step: shellStep({ run: [COMMIT] }),
      resolve: resolverFor('a "b"; c `d` & e'),
    });

    await createShellStep({ runCommand: runner }).execute(ctx);

    expect(argvs[0]?.[5]).toBe('feat(T-004): a "b"; c `d` & e');
  });

  it("end-to-end: a real subprocess receives ${...} data verbatim (no bad substitution)", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "loopy-shell-")));
    const ctx = makeStepContext({
      // A real `git commit -m` would have crashed on ${...} under shell:true;
      // echoing argv[1] proves the literal survives to the program unchanged.
      step: shellStep({
        run: [
          'node -e "process.stdout.write(process.argv[1])" "msg: ${task.title}"',
        ],
      }),
      worktreePath: dir,
      resolve: (t) =>
        t.replace(
          /\$\{task\.title\}/g,
          () => "Resolver de interpolação ${...}",
        ),
    });

    const result = await createShellStep().execute(ctx);

    expect(result.ok).toBe(true);
    expect(result.output).toBe("msg: Resolver de interpolação ${...}");
  });
});

// ---------------------------------------------------------------------------
// Real subprocesses via execa (argv, no shell) — proves quoted args survive.
// ---------------------------------------------------------------------------

describe("createShellStep — execa (real subprocess, argv)", () => {
  it("runs a real command and reports success", async () => {
    const ctx = makeStepContext({
      step: shellStep({ run: ['node -e "process.exit(0)"'] }),
      worktreePath: process.cwd(),
    });
    const result = await createShellStep().execute(ctx);
    expect(result.ok).toBe(true);
  });

  it("captures a non-zero exit without throwing", async () => {
    const ctx = makeStepContext({
      step: shellStep({ run: ['node -e "process.exit(5)"'] }),
      worktreePath: process.cwd(),
    });
    const result = await createShellStep().execute(ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("5");
  });

  it("preserves quoted arguments containing spaces (shell parsing, not naive split)", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "loopy-shell-")));
    const ctx = makeStepContext({
      // The single arg has a space; a naive whitespace split would break it.
      step: shellStep({
        run: ['node -e "process.stdout.write(process.argv[1])" "hello world"'],
      }),
      worktreePath: dir,
    });
    const result = await createShellStep().execute(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("hello world");
  });

  it("runs in the provided worktree cwd", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "loopy-shell-")));
    const ctx = makeStepContext({
      step: shellStep({
        run: ['node -e "process.stdout.write(process.cwd())"'],
      }),
      worktreePath: dir,
    });
    const result = await createShellStep().execute(ctx);
    expect(result.output).toContain(dir);
  });
});

// ---------------------------------------------------------------------------
// T-006: onChunk streaming — shell step emits stream_chunk as execa produces
// ---------------------------------------------------------------------------

describe("createShellStep — onChunk streaming (T-006)", () => {
  it("passes onChunk to the runner when ctx.emit is present", async () => {
    const { runner, onChunks } = recordingRunner(() => ({
      stdout: "hello",
    }));
    const events: StoreEvent[] = [];
    const ctx = makeStepContext({
      step: shellStep({ run: ["echo hello"] }),
      emit: (e) => events.push(e),
    });

    await createShellStep({ runCommand: runner }).execute(ctx);

    // The runner received an onChunk callback.
    expect(onChunks[0]).toBeTypeOf("function");
  });

  it("does NOT pass onChunk when ctx.emit is absent", async () => {
    const { runner, onChunks } = recordingRunner();
    const ctx = makeStepContext({
      step: shellStep({ run: ["echo hello"] }),
      // No emit → no onChunk
    });

    await createShellStep({ runCommand: runner }).execute(ctx);

    expect(onChunks[0]).toBeUndefined();
  });

  it("emits stream_chunk events with the correct taskId and text", async () => {
    const { runner } = recordingRunner(() => ({
      stdout: "line1",
      stderr: "err1",
    }));
    const events: StoreEvent[] = [];
    const ctx = makeStepContext({
      step: shellStep({ run: ["cmd1"] }),
      emit: (e) => events.push(e),
      task: { ...SAMPLE_TASK, id: "T-042" },
    });

    await createShellStep({ runCommand: runner }).execute(ctx);

    const chunks = events.filter((e) => e.type === "stream_chunk");
    expect(chunks).toEqual([
      { type: "stream_chunk", taskId: "T-042", text: "line1" },
      { type: "stream_chunk", taskId: "T-042", text: "err1" },
    ]);
  });

  it("aggregated StepResult is byte-identical with or without emit", async () => {
    const outcome = () => ({ stdout: "out", stderr: "err" });
    const { runner: r1 } = recordingRunner(outcome);
    const { runner: r2 } = recordingRunner(outcome);

    const ctxWithEmit = makeStepContext({
      step: shellStep({ run: ["a", "b"] }),
      emit: () => {},
    });
    const ctxWithout = makeStepContext({
      step: shellStep({ run: ["a", "b"] }),
    });

    const resultWith = await createShellStep({ runCommand: r1 }).execute(
      ctxWithEmit,
    );
    const resultWithout = await createShellStep({ runCommand: r2 }).execute(
      ctxWithout,
    );

    expect(resultWith).toEqual(resultWithout);
  });

  it("emits stream_chunk for each command in a multi-command step", async () => {
    const { runner } = recordingRunner((cmd) => ({
      stdout: `out-${cmd}`,
    }));
    const events: StoreEvent[] = [];
    const ctx = makeStepContext({
      step: shellStep({ run: ["a", "b", "c"] }),
      emit: (e) => events.push(e),
    });

    await createShellStep({ runCommand: runner }).execute(ctx);

    const chunks = events.filter((e) => e.type === "stream_chunk");
    expect(chunks).toHaveLength(3);
    expect(
      chunks.map((c) => (c.type === "stream_chunk" ? c.text : "")),
    ).toEqual(["out-a", "out-b", "out-c"]);
  });
});

// ---------------------------------------------------------------------------
// T-006: runShellCommandWithExeca — real subprocess streaming via onChunk
// ---------------------------------------------------------------------------

describe("runShellCommandWithExeca — onChunk streaming (T-006)", () => {
  it("invokes onChunk with subprocess output as it streams", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "loopy-shell-")));
    const chunks: string[] = [];
    const result = await runShellCommandWithExeca(
      ["node", "-e", 'process.stdout.write("hello"); process.stderr.write("world")'],
      {
        cwd: dir,
        onChunk: (text) => chunks.push(text),
      },
    );

    expect(result.ok).toBe(true);
    // The chunks together contain the full output.
    const joined = chunks.join("");
    expect(joined).toContain("hello");
    expect(joined).toContain("world");
    // The aggregated result is unchanged.
    expect(result.stdout).toBe("hello");
    expect(result.stderr).toBe("world");
  });

  it("produces byte-identical result with and without onChunk", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "loopy-shell-")));
    const argv = ["node", "-e", 'process.stdout.write("data")'];

    const withChunk = await runShellCommandWithExeca(argv, {
      cwd: dir,
      onChunk: () => {},
    });
    const without = await runShellCommandWithExeca(argv, { cwd: dir });

    expect(withChunk.stdout).toBe(without.stdout);
    expect(withChunk.stderr).toBe(without.stderr);
    expect(withChunk.exitCode).toBe(without.exitCode);
    expect(withChunk.ok).toBe(without.ok);
  });

  it("does not break when onChunk is not provided", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "loopy-shell-")));
    const result = await runShellCommandWithExeca(
      ["node", "-e", 'process.stdout.write("ok")'],
      { cwd: dir },
    );
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe("ok");
  });
});
