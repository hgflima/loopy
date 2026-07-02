import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRUNCATE,
  createChecksRunner,
  enforceGlobalCeiling,
  renderReport,
  runChecks,
  truncateHeadTail,
  type RunOne,
} from "../../src/checks/runner";
import type { CheckCommand, CheckResult } from "../../src/types";

/** Build a `CheckResult` with sane defaults for the pure render/aggregate tests. */
function result(overrides: Partial<CheckResult> = {}): CheckResult {
  const ok = overrides.ok ?? true;
  return {
    name: "typecheck",
    command: "npm run typecheck",
    exitCode: ok ? 0 : 1,
    ok,
    stdout: "",
    stderr: "",
    durationMs: 5,
    ...overrides,
  };
}

/** A deterministic fake `runOne` that echoes a pre-baked result per check name. */
function fakeRunner(byName: Record<string, Partial<CheckResult>>): RunOne {
  return async (check) =>
    result({ name: check.name, command: check.run, ...byName[check.name] });
}

// ---------------------------------------------------------------------------
// truncateHeadTail — head + tail with an explicit elision marker (OQ4)
// ---------------------------------------------------------------------------

describe("truncateHeadTail", () => {
  it("returns the text unchanged when within the head+tail budget", () => {
    const text = ["a", "b", "c", "d"].join("\n");
    expect(truncateHeadTail(text, { headLines: 2, tailLines: 2 })).toBe(text);
  });

  it("keeps the head and tail, eliding the middle with a marker", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `l${i}`);
    const out = truncateHeadTail(lines.join("\n"), {
      headLines: 2,
      tailLines: 2,
    });
    const outLines = out.split("\n");
    // 2 head + 1 marker + 2 tail = 5 lines
    expect(outLines).toHaveLength(5);
    expect(outLines[0]).toBe("l0");
    expect(outLines[1]).toBe("l1");
    expect(outLines[2]).toContain("6"); // 6 lines elided
    expect(outLines[3]).toBe("l8");
    expect(outLines[4]).toBe("l9");
    expect(out).not.toContain("l5");
  });

  it("is deterministic for the same input", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `x${i}`).join("\n");
    const a = truncateHeadTail(lines, { headLines: 100, tailLines: 100 });
    const b = truncateHeadTail(lines, { headLines: 100, tailLines: 100 });
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// enforceGlobalCeiling — global byte backstop
// ---------------------------------------------------------------------------

describe("enforceGlobalCeiling", () => {
  it("leaves text under the ceiling untouched", () => {
    const text = "small report";
    expect(enforceGlobalCeiling(text, 1024)).toBe(text);
  });

  it("truncates to at most the byte ceiling and inserts a global marker", () => {
    const text = Array.from({ length: 5000 }, (_, i) => `line-${i}`).join("\n");
    const max = 512;
    const out = enforceGlobalCeiling(text, max);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(max);
    expect(out).toContain("truncado");
    // Keeps some head and some tail context.
    expect(out).toContain("line-0");
    expect(out).toContain(`line-4999`);
  });
});

// ---------------------------------------------------------------------------
// renderReport — passing collapse, failing detail, determinism (OQ4)
// ---------------------------------------------------------------------------

describe("renderReport", () => {
  it("collapses a passing check to a single line without its output", () => {
    const text = renderReport([
      result({ name: "typecheck", stdout: "lots\nof\nnoise", ok: true }),
    ]);
    expect(text).toContain("typecheck");
    expect(text).toContain("exit 0");
    expect(text).not.toContain("noise");
    // The passing check occupies exactly one body line.
    const body = text.split("\n").filter((l) => l.includes("typecheck"));
    expect(body).toHaveLength(1);
  });

  it("shows exit code, command and output for a failing check", () => {
    const text = renderReport([
      result({
        name: "lint",
        command: "npm run lint",
        ok: false,
        exitCode: 2,
        stdout: "some stdout",
        stderr: "the error detail",
      }),
    ]);
    expect(text).toContain("lint");
    expect(text).toContain("exit 2");
    expect(text).toContain("npm run lint");
    expect(text).toContain("some stdout");
    expect(text).toContain("the error detail");
  });

  it("summarizes pass/fail counts in the header", () => {
    const text = renderReport([
      result({ name: "typecheck", ok: true }),
      result({ name: "lint", ok: false }),
      result({ name: "test", ok: true }),
    ]);
    const header = text.split("\n")[0] ?? "";
    expect(header).toContain("2");
    expect(header).toContain("3");
  });

  it("truncates large failing output head+tail with a marker", () => {
    const stdout = Array.from({ length: 300 }, (_, i) => `L${i}`).join("\n");
    const text = renderReport(
      [result({ name: "test", ok: false, exitCode: 1, stdout })],
      {
        headLines: 100,
        tailLines: 100,
        globalMaxBytes: DEFAULT_TRUNCATE.globalMaxBytes,
      },
    );
    expect(text).toContain("L0");
    expect(text).toContain("L99");
    expect(text).toContain("L299");
    expect(text).not.toContain("L150"); // middle elided
    expect(text).toMatch(/omitida/);
  });

  it("applies the global byte ceiling across many failing checks", () => {
    const big = Array.from({ length: 50 }, (_, i) => `row-${i}`).join("\n");
    const results = Array.from({ length: 20 }, (_, i) =>
      result({ name: `c${i}`, ok: false, exitCode: 1, stdout: big }),
    );
    const max = 800;
    const text = renderReport(results, {
      headLines: 100,
      tailLines: 100,
      globalMaxBytes: max,
    });
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(max);
    expect(text).toContain("truncado");
  });

  it("is deterministic for identical results", () => {
    const results = [
      result({ name: "typecheck", ok: true }),
      result({ name: "lint", ok: false, stdout: "boom", stderr: "bad" }),
    ];
    expect(renderReport(results)).toBe(renderReport(results));
  });

  it("handles an empty check list", () => {
    expect(renderReport([])).toContain("Nenhum");
  });
});

// ---------------------------------------------------------------------------
// runChecks — aggregation, no fail-fast (with an injected runner)
// ---------------------------------------------------------------------------

describe("runChecks (injected runner)", () => {
  const checks: readonly CheckCommand[] = [
    { name: "typecheck", run: "npm run typecheck" },
    { name: "lint", run: "npm run lint" },
    { name: "test", run: "npm test" },
  ];

  it("runs every check even when one fails (no fail-fast)", async () => {
    const seen: string[] = [];
    const runOne: RunOne = async (check) => {
      seen.push(check.name);
      return result({
        name: check.name,
        command: check.run,
        ok: check.name !== "lint",
      });
    };
    const report = await runChecks(checks, { cwd: "/x", runOne });
    expect(seen).toEqual(["typecheck", "lint", "test"]);
    expect(report.results).toHaveLength(3);
    expect(report.results.map((r) => r.name)).toEqual([
      "typecheck",
      "lint",
      "test",
    ]);
  });

  it("marks ok only when all checks pass", async () => {
    const allPass = await runChecks(checks, {
      cwd: "/x",
      runOne: fakeRunner({}),
    });
    expect(allPass.ok).toBe(true);

    const oneFails = await runChecks(checks, {
      cwd: "/x",
      runOne: fakeRunner({ lint: { ok: false, exitCode: 1 } }),
    });
    expect(oneFails.ok).toBe(false);
  });

  it("exposes the aggregated report text via ChecksReport.text", async () => {
    const report = await runChecks(checks, {
      cwd: "/x",
      runOne: fakeRunner({
        lint: { ok: false, exitCode: 1, stderr: "lint blew up" },
      }),
    });
    expect(report.text).toContain("lint blew up");
    expect(report.text).toContain("typecheck");
  });
});

// ---------------------------------------------------------------------------
// runChecks — real subprocesses via execa (fake commands: pass/fail/large)
// ---------------------------------------------------------------------------

describe("runChecks (execa, real subprocesses)", () => {
  // Single-token `-e` scripts so parseCommandString keeps them as one argument.
  const pass: CheckCommand = {
    name: "pass",
    run: "node -e process.stdout.write('ok')",
  };
  const fail: CheckCommand = {
    name: "fail",
    run: "node -e process.stderr.write('boom');process.exit(3)",
  };
  const large: CheckCommand = {
    name: "large",
    run: "node -e process.stdout.write(Array.from({length:400},(x,i)=>'N'+i).join(String.fromCharCode(10)));process.exit(1)",
  };

  it("captures a passing command (exit 0, ok true)", async () => {
    const report = await runChecks([pass], { cwd: process.cwd() });
    expect(report.ok).toBe(true);
    const [r] = report.results;
    expect(r?.exitCode).toBe(0);
    expect(r?.ok).toBe(true);
    expect(r?.stdout).toBe("ok");
  });

  it("captures a failing command's exit code and stderr (no throw)", async () => {
    const report = await runChecks([fail], { cwd: process.cwd() });
    expect(report.ok).toBe(false);
    const [r] = report.results;
    expect(r?.exitCode).toBe(3);
    expect(r?.ok).toBe(false);
    expect(r?.stderr).toContain("boom");
    expect(report.text).toContain("boom");
  });

  it("runs all commands without fail-fast and aggregates", async () => {
    const report = await runChecks([pass, fail], { cwd: process.cwd() });
    expect(report.results).toHaveLength(2);
    expect(report.ok).toBe(false);
    expect(report.results[0]?.ok).toBe(true);
    expect(report.results[1]?.ok).toBe(false);
  });

  it("truncates a large failing output in the report", async () => {
    const report = await runChecks([large], {
      cwd: process.cwd(),
      truncate: { headLines: 10, tailLines: 10 },
    });
    expect(report.ok).toBe(false);
    expect(report.text).toContain("N0");
    expect(report.text).toContain("N399");
    expect(report.text).not.toContain("N200");
    expect(report.text).toMatch(/omitida/);
  });

  it("runs in the provided cwd", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "loopy-checks-")));
    const report = await runChecks(
      [{ name: "cwd", run: "node -e process.stdout.write(process.cwd())" }],
      { cwd: dir },
    );
    expect(report.results[0]?.stdout).toBe(dir);
  });

  it("reports a spawn failure as a failed check (no throw)", async () => {
    const report = await runChecks(
      [{ name: "missing", run: "loopy-nonexistent-binary-xyz" }],
      { cwd: process.cwd() },
    );
    expect(report.ok).toBe(false);
    const [r] = report.results;
    expect(r?.ok).toBe(false);
    expect(r?.exitCode).not.toBe(0);
    expect(r?.stderr.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// createChecksRunner — satisfies ChecksRunnerPort
// ---------------------------------------------------------------------------

describe("createChecksRunner", () => {
  it("returns a ChecksRunnerPort whose run(checks,{cwd}) aggregates", async () => {
    const runner = createChecksRunner({ runOne: fakeRunner({}) });
    const report = await runner.run(
      [{ name: "typecheck", run: "npm run typecheck" }],
      { cwd: "/repo" },
    );
    expect(report.ok).toBe(true);
    expect(report.results).toHaveLength(1);
  });
});
