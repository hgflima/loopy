import { describe, it, expect, vi } from "vitest";
import { buildSidecarArgs, buildLaunchConfig, startSidecar } from "./launch";

const DEFAULTS = { yes: false, taskId: "", verbose: false };

describe("buildSidecarArgs", () => {
  it("emits no flags by default", () => {
    expect(buildSidecarArgs(DEFAULTS)).toEqual([]);
  });

  it("maps yes/verbose to their flags", () => {
    expect(buildSidecarArgs({ ...DEFAULTS, yes: true, verbose: true })).toEqual([
      "--yes",
      "--verbose",
    ]);
  });

  it("passes --task as two argv entries (no shell splitting)", () => {
    expect(buildSidecarArgs({ ...DEFAULTS, taskId: "T-003" })).toEqual(["--task", "T-003"]);
  });

  it("drops a whitespace-only taskId", () => {
    expect(buildSidecarArgs({ ...DEFAULTS, taskId: "   " })).toEqual([]);
  });
});

describe("buildLaunchConfig", () => {
  it("uses the snake_case key the Rust LaunchConfig deserializes", () => {
    expect(buildLaunchConfig("/repo", { yes: true, taskId: "T-001", verbose: false })).toEqual({
      dir: "/repo",
      yes: true,
      task_id: "T-001",
      verbose: false,
    });
  });
});

describe("startSidecar", () => {
  it("spawns the sidecar with the dir and mapped flags", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    await startSidecar(invoke, "/repo", { yes: true, taskId: "", verbose: false });

    expect(invoke).toHaveBeenCalledWith("start_sidecar", { dir: "/repo", flags: ["--yes"] });
  });

  it("persists the launch config before spawning", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    await startSidecar(invoke, "/repo", DEFAULTS);

    expect(invoke.mock.calls.map((c) => c[0])).toEqual(["save_launch_config", "start_sidecar"]);
  });

  it("still starts the Run when persisting the config fails (best-effort)", async () => {
    const invoke = vi.fn().mockImplementation((cmd: string) =>
      cmd === "save_launch_config" ? Promise.reject(new Error("disk full")) : Promise.resolve(),
    );
    await expect(startSidecar(invoke, "/repo", DEFAULTS)).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledWith("start_sidecar", expect.anything());
  });

  it("rejects when the spawn fails, so the caller can surface a start-fail", async () => {
    const invoke = vi.fn().mockImplementation((cmd: string) =>
      cmd === "start_sidecar" ? Promise.reject(new Error("No runnable sidecar binary found")) : Promise.resolve(),
    );

    await expect(startSidecar(invoke, "/repo", DEFAULTS)).rejects.toThrow(
      "No runnable sidecar binary found",
    );
  });
});
