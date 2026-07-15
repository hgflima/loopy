import { describe, expect, it } from "vitest";
import { createApprovalStep } from "../../src/steps/approval";
import {
  type RunShellCommand,
  type ShellCommandResult,
} from "../../src/steps/shell";
import { InterpolationError } from "../../src/interp/resolver";
import type { ApprovalStep, UiPort } from "../../src/types";
import { makeLogger, makeRecorder, makeStepContext } from "./support";

/** Build an `approval` step config with sane defaults (a merge gate). */
function approvalStep(overrides: Partial<ApprovalStep> = {}): ApprovalStep {
  return {
    id: "merge",
    type: "approval",
    prompt: "Aprovar merge da task ${task.id}?",
    run: ['git merge --no-ff "${task.branch}"'],
    ...overrides,
  };
}

/**
 * A fake human gate that records every prompt it was shown and answers with a
 * fixed decision (or one computed per prompt). Lets a test assert both *what*
 * was asked and *whether* it was asked at all.
 */
function recordingUi(
  decision: boolean | ((prompt: string) => boolean) = true,
): { ui: UiPort; prompts: string[] } {
  const prompts: string[] = [];
  const ui: UiPort = {
    requestApproval: async (prompt) => {
      prompts.push(prompt);
      return typeof decision === "function" ? decision(prompt) : decision;
    },
  };
  return { ui, prompts };
}

/**
 * A fake command runner that records what it ran, in order, and its cwds.
 * `ran` holds each argv joined by spaces; `argvs` holds the raw argv arrays.
 */
function recordingRunner(
  outcome: (command: string) => Partial<ShellCommandResult> = () => ({}),
): {
  runner: RunShellCommand;
  ran: string[];
  argvs: string[][];
  cwds: string[];
} {
  const ran: string[] = [];
  const argvs: string[][] = [];
  const cwds: string[] = [];
  const runner: RunShellCommand = async (argv, ctx) => {
    const command = argv.join(" ");
    ran.push(command);
    argvs.push([...argv]);
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
  return { runner, ran, argvs, cwds };
}

describe("createApprovalStep — execute", () => {
  it("declares the approval step type", () => {
    expect(createApprovalStep().type).toBe("approval");
  });

  it("asks the human gate with the resolved prompt (OQ2)", async () => {
    const { ui, prompts } = recordingUi(true);
    const { runner } = recordingRunner();
    const ctx = makeStepContext({
      step: approvalStep({ prompt: "Aprovar ${task.id}?", run: [] }),
      ui,
      resolve: (t) => t.replace("${task.id}", "T-001"),
    });

    await createApprovalStep({ runCommand: runner }).execute(ctx);

    expect(prompts).toEqual(["Aprovar T-001?"]);
  });

  it("runs the action commands in order once approved", async () => {
    const { ui } = recordingUi(true);
    const { runner, ran } = recordingRunner();
    const ctx = makeStepContext({
      step: approvalStep({ run: ["a", "b", "c"] }),
      ui,
    });

    const result = await createApprovalStep({ runCommand: runner }).execute(
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(ran).toEqual(["a", "b", "c"]);
  });

  it("runs the action in the task's worktree cwd", async () => {
    const { ui } = recordingUi(true);
    const { runner, cwds } = recordingRunner();
    const ctx = makeStepContext({
      step: approvalStep({ run: ["merge"] }),
      ui,
      worktreePath: "/wt/T-042",
    });

    await createApprovalStep({ runCommand: runner }).execute(ctx);

    expect(cwds).toEqual(["/wt/T-042"]);
  });

  it("interpolates each action command per token before running it", async () => {
    const { ui } = recordingUi(true);
    const { runner, argvs } = recordingRunner();
    const ctx = makeStepContext({
      step: approvalStep({ run: ['git merge "${task.branch}"'] }),
      ui,
      resolve: (t) => t.replace("${task.branch}", "loopy/T-001"),
    });

    await createApprovalStep({ runCommand: runner }).execute(ctx);

    expect(argvs).toEqual([["git", "merge", "loopy/T-001"]]);
  });

  it("passes a merge message containing ${...} data as one literal arg (regression)", async () => {
    const { ui } = recordingUi(true);
    const { runner, argvs } = recordingRunner();
    const ctx = makeStepContext({
      // The merge gate has the same `${task.title}` in its message as commit did.
      step: approvalStep({
        run: [
          'git merge --no-ff "${task.branch}" -m "merge(${task.id}): ${task.title}"',
        ],
      }),
      ui,
      resolve: (t) =>
        t
          .replace(/\$\{task\.branch\}/g, () => "loopy/T-004")
          .replace(/\$\{task\.id\}/g, () => "T-004")
          .replace(
            /\$\{task\.title\}/g,
            () => "Resolver de interpolação ${...}",
          ),
    });

    const result = await createApprovalStep({ runCommand: runner }).execute(
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(argvs[0]).toEqual([
      "git",
      "merge",
      "--no-ff",
      "loopy/T-004",
      "-m",
      "merge(T-004): Resolver de interpolação ${...}",
    ]);
  });

  it("auto-approves under --yes without touching the interactive gate", async () => {
    // The gate must NEVER be consulted under --yes (non-interactive / CI).
    const ui: UiPort = {
      requestApproval: async () => {
        throw new Error("requestApproval must not be called under --yes");
      },
    };
    const { runner, ran } = recordingRunner();
    const ctx = makeStepContext({
      step: approvalStep({ run: ["merge"] }),
      ui,
      flags: { yes: true },
    });

    const result = await createApprovalStep({ runCommand: runner }).execute(
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(ran).toEqual(["merge"]);
  });

  it("on rejection does not run the action and signals a failure (escalation)", async () => {
    const { ui, prompts } = recordingUi(false);
    const { runner, ran } = recordingRunner();
    const ctx = makeStepContext({
      step: approvalStep({ run: ["merge"] }),
      ui,
    });

    const result = await createApprovalStep({ runCommand: runner }).execute(
      ctx,
    );

    // Rejected: the gate was consulted, the action never ran, ok is false so
    // the orchestrator escalates (Success Criterion #5).
    expect(prompts).toHaveLength(1);
    expect(result.ok).toBe(false);
    expect(ran).toEqual([]);
  });

  it("treats a failing action as a conflict and respects on_fail", async () => {
    const { ui } = recordingUi(true);
    const { runner } = recordingRunner((cmd) =>
      cmd.includes("merge")
        ? { ok: false, exitCode: 1, stderr: "CONFLICT (content): merge failed" }
        : {},
    );
    const ctx = makeStepContext({
      step: approvalStep({ run: ["git merge"], on_fail: "escalate" }),
      ui,
    });

    const result = await createApprovalStep({ runCommand: runner }).execute(
      ctx,
    );

    expect(result.ok).toBe(false);
    // The failure is attributable to the merge and carries the on_fail
    // action so escalation is observable at the step boundary.
    expect(result.reason).toContain("merge");
    expect(result.reason).toContain("on_fail");
    expect(result.reason).toContain("escalate");
    expect(result.output).toContain("CONFLICT");
  });

  it("stops at the first failing action command", async () => {
    const { ui } = recordingUi(true);
    const { runner, ran } = recordingRunner((cmd) =>
      cmd === "b" ? { ok: false, exitCode: 2 } : {},
    );
    const ctx = makeStepContext({
      step: approvalStep({ run: ["a", "b", "c"] }),
      ui,
    });

    const result = await createApprovalStep({ runCommand: runner }).execute(
      ctx,
    );

    expect(result.ok).toBe(false);
    // "c" must never run — the action short-circuits at the first failure.
    expect(ran).toEqual(["a", "b"]);
  });

  it("is a pure gate when there is no action (approved with no `run`)", async () => {
    const { ui } = recordingUi(true);
    const { runner, ran } = recordingRunner();
    const ctx = makeStepContext({
      step: approvalStep({ run: undefined }),
      ui,
    });

    const result = await createApprovalStep({ runCommand: runner }).execute(
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(ran).toEqual([]);
  });

  it("aborts before prompting when the prompt has an unknown var (OQ1)", async () => {
    const { ui, prompts } = recordingUi(true);
    const { runner, ran } = recordingRunner();
    const ctx = makeStepContext({
      step: approvalStep({ prompt: "uses ${task.nope}", run: ["merge"] }),
      ui,
      resolve: (t) => {
        if (t.includes("${task.nope}")) {
          throw new InterpolationError("task.nope", "merge", []);
        }
        return t;
      },
    });

    await expect(
      createApprovalStep({ runCommand: runner }).execute(ctx),
    ).rejects.toBeInstanceOf(InterpolationError);
    // Fail-fast: the human was never prompted and nothing ran.
    expect(prompts).toEqual([]);
    expect(ran).toEqual([]);
  });

  it("aborts before prompting when an action command has an unknown var (OQ1)", async () => {
    const { ui, prompts } = recordingUi(true);
    const { runner, ran } = recordingRunner();
    const ctx = makeStepContext({
      step: approvalStep({ prompt: "ok?", run: ["ok", "uses ${task.nope}"] }),
      ui,
      resolve: (t) => {
        if (t.includes("${task.nope}")) {
          throw new InterpolationError("task.nope", "merge", []);
        }
        return t;
      },
    });

    await expect(
      createApprovalStep({ runCommand: runner }).execute(ctx),
    ).rejects.toBeInstanceOf(InterpolationError);
    // Commands are resolved up front, so the bad var aborts before the gate.
    expect(prompts).toEqual([]);
    expect(ran).toEqual([]);
  });

  it("logs the auto-approval under --yes", async () => {
    const logger = makeLogger();
    const { runner } = recordingRunner();
    const ctx = makeStepContext({
      step: approvalStep({ run: [] }),
      flags: { yes: true },
      logger,
    });

    await createApprovalStep({ runCommand: runner }).execute(ctx);

    expect(logger.infos.join("\n")).toContain("--yes");
  });

  it("logs a rejection", async () => {
    const logger = makeLogger();
    const { ui } = recordingUi(false);
    const { runner } = recordingRunner();
    const ctx = makeStepContext({
      step: approvalStep({ run: ["merge"] }),
      ui,
      logger,
    });

    await createApprovalStep({ runCommand: runner }).execute(ctx);

    expect(logger.infos.join("\n").toLowerCase()).toContain("rejeit");
  });

  it("throws when handed a non-approval step (engine bug, not normal flow)", async () => {
    const ctx = makeStepContext({
      step: { id: "x", type: "shell", run: ["echo hi"] },
    });
    await expect(createApprovalStep().execute(ctx)).rejects.toThrow(/approval/);
  });

  // -------------------------------------------------------------------------
  // human_seconds telemetry (T-007 / D12)
  // -------------------------------------------------------------------------

  it("brackets the human wait and delivers human_seconds via the recorder (D12)", async () => {
    const { ui } = recordingUi(true);
    const { runner } = recordingRunner();
    const recorder = makeRecorder(); // now() ticks 1s per call
    const ctx = makeStepContext({
      step: approvalStep({ run: [] }),
      ui,
      telemetry: recorder,
    });

    await createApprovalStep({ runCommand: runner }).execute(ctx);

    // now() bracket the await: 1s elapsed between the two reads.
    expect(recorder.humanSeconds).toEqual([1]);
  });

  it("does NOT record human_seconds under --yes (no gate occurred, D12)", async () => {
    const { runner } = recordingRunner();
    const recorder = makeRecorder();
    const ctx = makeStepContext({
      step: approvalStep({ run: [] }),
      flags: { yes: true },
      telemetry: recorder,
    });

    await createApprovalStep({ runCommand: runner }).execute(ctx);

    // Under --yes the recorder's clock is never read for the gate → NULL.
    expect(recorder.humanSeconds).toEqual([]);
  });

  it("sets fail_reason 'human-rejected' on a rejected gate (D5)", async () => {
    const { ui } = recordingUi(false);
    const { runner } = recordingRunner();
    const recorder = makeRecorder();
    const ctx = makeStepContext({
      step: approvalStep({ run: ["merge"] }),
      ui,
      telemetry: recorder,
    });

    const result = await createApprovalStep({ runCommand: runner }).execute(ctx);

    expect(result.ok).toBe(false);
    expect(recorder.failReasons).toEqual([
      { reason: "human-rejected", detail: null },
    ]);
    // A rejection still measured the human wait.
    expect(recorder.humanSeconds).toEqual([1]);
  });

  it("records human_seconds but no fail_reason when an approved action later fails", async () => {
    const { ui } = recordingUi(true);
    const { runner } = recordingRunner((cmd) =>
      cmd.includes("merge") ? { ok: false, exitCode: 1 } : {},
    );
    const recorder = makeRecorder();
    const ctx = makeStepContext({
      step: approvalStep({ run: ["git merge"] }),
      ui,
      telemetry: recorder,
    });

    const result = await createApprovalStep({ runCommand: runner }).execute(ctx);

    expect(result.ok).toBe(false);
    // The human deliberated (so human_seconds is recorded)…
    expect(recorder.humanSeconds).toEqual([1]);
    // …but an action failure has no clean bucket (NULL, not human-rejected).
    expect(recorder.failReasons).toEqual([]);
  });
});
