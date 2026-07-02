import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createShellStep,
  type RunShellCommand,
  type ShellCommandResult,
} from "../../src/steps/shell";
import { InterpolationError } from "../../src/interp/resolver";
import type { ShellStep } from "../../src/types";
import { makeLogger, makeStepContext } from "./support";

/** Build a `shell` step config with sane defaults. */
function shellStep(overrides: Partial<ShellStep> = {}): ShellStep {
  return {
    id: "cmd",
    type: "shell",
    run: ["echo one"],
    ...overrides,
  };
}

/** A fake command runner that records what it was asked to run, in order. */
function recordingRunner(
  outcome: (command: string) => Partial<ShellCommandResult> = () => ({}),
): { runner: RunShellCommand; ran: string[]; cwds: string[] } {
  const ran: string[] = [];
  const cwds: string[] = [];
  const runner: RunShellCommand = async (command, ctx) => {
    ran.push(command);
    cwds.push(ctx.cwd);
    const partial = outcome(command);
    const ok = partial.ok ?? true;
    return {
      command,
      exitCode: partial.exitCode ?? (ok ? 0 : 1),
      ok,
      stdout: partial.stdout ?? "",
      stderr: partial.stderr ?? "",
    };
  };
  return { runner, ran, cwds };
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

  it("interpolates each command via ctx.resolve before running it", async () => {
    const { runner, ran } = recordingRunner();
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

    expect(ran).toEqual(['git worktree add -b "loopy/T-001" "/wt/T-001"']);
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
// Real subprocesses via execa (shell mode) — proves quoted args survive.
// ---------------------------------------------------------------------------

describe("createShellStep — execa (real subprocess, shell mode)", () => {
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
