import { describe, expect, it } from "vitest";
import { createChecksStep } from "../../src/steps/checks";
import type {
  CheckCommand,
  ChecksReport,
  ChecksRunnerPort,
  ChecksStep,
} from "../../src/types";
import { makeLogger, makeStepContext } from "./support";

/** Build a `checks` step that references a named list. */
function checksStep(run: string): ChecksStep {
  return { id: "verify", type: "checks", run };
}

/** A fake runner that records its (checks, cwd) args and returns a canned report. */
function recordingChecksRunner(report: ChecksReport): {
  runner: ChecksRunnerPort;
  calls: { checks: readonly CheckCommand[]; cwd: string }[];
} {
  const calls: { checks: readonly CheckCommand[]; cwd: string }[] = [];
  const runner: ChecksRunnerPort = {
    run: async (checks, opts) => {
      calls.push({ checks, cwd: opts.cwd });
      return report;
    },
  };
  return { runner, calls };
}

const CI_LIST: readonly CheckCommand[] = [
  { name: "typecheck", run: "npm run typecheck" },
  { name: "lint", run: "npm run lint" },
];

function passingReport(): ChecksReport {
  return { ok: true, results: [], text: "Checks: 2/2 passaram." };
}

function failingReport(): ChecksReport {
  return {
    ok: false,
    results: [],
    text: "Checks: 1/2 passaram (1 falharam).\n[falhou] lint",
  };
}

describe("createChecksStep — execute", () => {
  it("declares the checks step type", () => {
    expect(createChecksStep().type).toBe("checks");
  });

  it("resolves the named list from config.checks and runs it in the worktree cwd", async () => {
    const { runner, calls } = recordingChecksRunner(passingReport());
    const ctx = makeStepContext({
      step: checksStep("ci"),
      checksConfig: { ci: CI_LIST },
      checks: runner,
      worktreePath: "/wt/T-001",
    });

    await createChecksStep().execute(ctx);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.checks).toEqual(CI_LIST);
    expect(calls[0]?.cwd).toBe("/wt/T-001");
  });

  it("returns ok with the report when every check passes", async () => {
    const report = passingReport();
    const { runner } = recordingChecksRunner(report);
    const ctx = makeStepContext({
      step: checksStep("ci"),
      checksConfig: { ci: CI_LIST },
      checks: runner,
    });

    const result = await createChecksStep().execute(ctx);

    expect(result.ok).toBe(true);
    expect(result.report).toBe(report);
  });

  it("returns a failing result carrying the report so ${checks.report} can propagate", async () => {
    const report = failingReport();
    const { runner } = recordingChecksRunner(report);
    const ctx = makeStepContext({
      step: checksStep("ci"),
      checksConfig: { ci: CI_LIST },
      checks: runner,
    });

    const result = await createChecksStep().execute(ctx);

    expect(result.ok).toBe(false);
    // The report is propagated verbatim (its `text` is fed back as ${checks.report}).
    expect(result.report).toBe(report);
    expect(result.output).toContain("falhou");
  });

  it("throws a clear error when the named list is missing from config.checks", async () => {
    const { runner } = recordingChecksRunner(passingReport());
    const ctx = makeStepContext({
      step: checksStep("does-not-exist"),
      checksConfig: { ci: CI_LIST },
      checks: runner,
    });

    await expect(createChecksStep().execute(ctx)).rejects.toThrow(
      /does-not-exist/,
    );
  });

  it("logs the list outcome", async () => {
    const logger = makeLogger();
    const { runner } = recordingChecksRunner(failingReport());
    const ctx = makeStepContext({
      step: checksStep("ci"),
      checksConfig: { ci: CI_LIST },
      checks: runner,
      logger,
    });

    await createChecksStep().execute(ctx);

    expect(logger.infos.join("\n")).toContain("ci");
  });

  it("throws when handed a non-checks step (engine bug, not normal flow)", async () => {
    const ctx = makeStepContext({
      step: { id: "x", type: "shell", run: ["echo hi"] },
    });
    await expect(createChecksStep().execute(ctx)).rejects.toThrow(/checks/);
  });
});
