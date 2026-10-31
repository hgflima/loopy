/**
 * Tests for the pure launch-argv planner (C-0020 / T-013).
 *
 * Run: `npm test -w apps/menubar -- launch-args`
 */

import { describe, it, expect } from "vitest";
import {
  coalesceLaunchArgs,
  combineLaunchArgs,
  isRunActive,
  normalizeDir,
  planLaunchArgs,
  type LaunchArgs,
} from "./launch-args";

function args(over: Partial<LaunchArgs> = {}): LaunchArgs {
  return {
    dir: null,
    task: null,
    yes: false,
    verbose: false,
    run: false,
    ...over,
  };
}

const IDLE = { currentDir: "/proj/a", isRunning: false };
const RUNNING = { currentDir: "/proj/a", isRunning: true };

describe("normalizeDir", () => {
  it("trims blanks and trailing separators", () => {
    expect(normalizeDir("  /proj/a/ ")).toBe("/proj/a");
    expect(normalizeDir("C:\\proj\\a\\")).toBe("C:\\proj\\a");
  });

  it("keeps the filesystem root", () => {
    expect(normalizeDir("/")).toBe("/");
  });
});

describe("isRunActive (C-0021 / B2)", () => {
  it("a Run is active from the click on Iniciar, not from run_started", () => {
    expect(isRunActive("idle")).toBe(false);
    expect(isRunActive("starting")).toBe(true);
    expect(isRunActive("running")).toBe(true);
    expect(isRunActive("finished")).toBe(false);
  });
});

describe("planLaunchArgs — idle", () => {
  it("bare args plan nothing", () => {
    expect(planLaunchArgs(args(), IDLE)).toEqual([]);
  });

  it("same dir (modulo trailing slash) does not switch", () => {
    expect(planLaunchArgs(args({ dir: "/proj/a/" }), IDLE)).toEqual([]);
  });

  it("different dir switches", () => {
    expect(planLaunchArgs(args({ dir: "/proj/b" }), IDLE)).toEqual([
      { kind: "switchDir", dir: "/proj/b" },
    ]);
  });

  it("switches when no dir is open yet", () => {
    expect(
      planLaunchArgs(args({ dir: "/proj/b" }), {
        currentDir: "",
        isRunning: false,
      }),
    ).toEqual([{ kind: "switchDir", dir: "/proj/b" }]);
  });

  it("prefills only the flags present, before the switch", () => {
    expect(
      planLaunchArgs(
        args({ dir: "/proj/b", task: "T-003", yes: true, verbose: true }),
        IDLE,
      ),
    ).toEqual([
      {
        kind: "setFlags",
        flags: { yes: true, verbose: true, taskId: "T-003" },
      },
      { kind: "switchDir", dir: "/proj/b" },
    ]);
    expect(planLaunchArgs(args({ yes: true }), IDLE)).toEqual([
      { kind: "setFlags", flags: { yes: true } },
    ]);
  });

  it("--run makes the argv authoritative: absent flags clear, not keep", () => {
    expect(
      planLaunchArgs(args({ dir: "/proj/b", run: true }), IDLE)[0],
    ).toEqual({
      kind: "setFlags",
      flags: { yes: false, verbose: false, taskId: "" },
    });
    expect(
      planLaunchArgs(args({ run: true, yes: true, task: " T-002 " }), IDLE)[0],
    ).toEqual({
      kind: "setFlags",
      flags: { yes: true, verbose: false, taskId: "T-002" },
    });
  });

  it("--run with a different dir switches, then starts after load", () => {
    expect(planLaunchArgs(args({ dir: "/proj/b", run: true }), IDLE)).toEqual([
      { kind: "setFlags", flags: { yes: false, verbose: false, taskId: "" } },
      { kind: "switchDir", dir: "/proj/b" },
      { kind: "startAfterLoad", dir: "/proj/b" },
    ]);
  });

  // C-0021/B3: without a reload, a dirty draft was auto-saved over the
  // loopy.yml on disk with no question asked.
  it("--run with the same dir reloads it (through the guard), then starts", () => {
    const plan = [
      { kind: "setFlags", flags: { yes: false, verbose: false, taskId: "" } },
      { kind: "reloadDir", dir: "/proj/a" },
      { kind: "startAfterLoad", dir: "/proj/a" },
    ];
    expect(planLaunchArgs(args({ dir: "/proj/a/", run: true }), IDLE)).toEqual(
      plan,
    );
    expect(planLaunchArgs(args({ run: true }), IDLE)).toEqual(plan);
  });

  it("--run with no dir anywhere plans no start", () => {
    expect(
      planLaunchArgs(args({ run: true }), { currentDir: "", isRunning: false }),
    ).toEqual([]);
  });

  it("without --run never plans a start", () => {
    const plan = planLaunchArgs(
      args({ dir: "/proj/b", yes: true, task: "T-1" }),
      IDLE,
    );
    expect(plan.some((a) => a.kind === "startAfterLoad")).toBe(false);
  });
});

describe("planLaunchArgs — Run active (E3)", () => {
  it("another project: warns and defers, never switches or starts", () => {
    expect(
      planLaunchArgs(args({ dir: "/proj/b", run: true, yes: true }), RUNNING),
    ).toEqual([
      {
        kind: "warnRunActive",
        dir: "/proj/b",
        runIgnored: true,
        deferred: args({ dir: "/proj/b", run: false, yes: true }),
      },
    ]);
  });

  it("without --run the warning does not report an ignored run", () => {
    const [action] = planLaunchArgs(args({ dir: "/proj/b" }), RUNNING);
    expect(action).toMatchObject({
      kind: "warnRunActive",
      dir: "/proj/b",
      runIgnored: false,
    });
  });

  // C-0021 verification: holding an empty request made the banner offer to
  // "apply the launch flags" when there were none.
  it("same project with only --run warns and holds nothing", () => {
    expect(
      planLaunchArgs(args({ dir: "/proj/a", run: true }), RUNNING),
    ).toEqual([
      { kind: "warnRunActive", dir: null, runIgnored: true, deferred: null },
    ]);
  });

  it("same project, nothing else: no-op (the window is just focused)", () => {
    expect(planLaunchArgs(args({ dir: "/proj/a" }), RUNNING)).toEqual([]);
  });
});

// C-0021/M2: a second `loopy open` during a Run used to drop the first silently.
describe("coalesceLaunchArgs — same as applying a then b", () => {
  it("the later non-null dir and task win", () => {
    expect(
      coalesceLaunchArgs(
        args({ dir: "/proj/b", task: "T-1" }),
        args({ dir: "/proj/c" }),
      ),
    ).toEqual(args({ dir: "/proj/c", task: "T-1" }));
    expect(
      coalesceLaunchArgs(args({ dir: "/proj/b" }), args({ task: "T-2" })),
    ).toEqual(args({ dir: "/proj/b", task: "T-2" }));
  });

  it("flags only turn on (prefill never clears)", () => {
    expect(
      coalesceLaunchArgs(args({ yes: true }), args({ verbose: true })),
    ).toEqual(args({ yes: true, verbose: true }));
  });

  it("run never survives (one Run at a time)", () => {
    expect(
      coalesceLaunchArgs(args({ run: true }), args({ run: true })).run,
    ).toBe(false);
  });
});

// C-0021/M3: requests drained together (boot, or several nudges at once).
describe("combineLaunchArgs", () => {
  it("nothing drained → null", () => {
    expect(combineLaunchArgs([])).toBeNull();
  });

  it("coalesces in order and keeps the last request's --run", () => {
    expect(
      combineLaunchArgs([
        args({ dir: "/proj/b", yes: true }),
        args({ dir: "/proj/c", run: true }),
      ]),
    ).toEqual(args({ dir: "/proj/c", yes: true, run: true }));
    expect(
      combineLaunchArgs([args({ run: true }), args({ dir: "/proj/c" })])?.run,
    ).toBe(false);
  });
});
