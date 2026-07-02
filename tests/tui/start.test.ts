import { describe, expect, it } from "vitest";
import { startUi, type MountApp, type MountProps } from "../../src/tui/start";
import type { RunFlags } from "../../src/types";

function flags(overrides: Partial<RunFlags> = {}): RunFlags {
  return { dryRun: false, yes: false, tui: true, verbose: false, ...overrides };
}

/** A fake Ink mount that records the props it was handed and its unmount. */
function fakeMount(): {
  readonly mount: MountApp;
  props(): MountProps | undefined;
  calls(): number;
  unmounted(): boolean;
} {
  let props: MountProps | undefined;
  let calls = 0;
  let unmounted = false;
  const mount: MountApp = (p) => {
    props = p;
    calls += 1;
    return {
      unmount: () => {
        unmounted = true;
      },
    };
  };
  return {
    mount,
    props: () => props,
    calls: () => calls,
    unmounted: () => unmounted,
  };
}

// ---------------------------------------------------------------------------
// Renderer selection — the crux of the no-TTY / --no-tui fallback (AC2)
// ---------------------------------------------------------------------------

describe("startUi · renderer selection", () => {
  it("mounts the Ink TUI when tui is on, a TTY exists, and a mount is provided", () => {
    const fake = fakeMount();
    const ui = startUi({ flags: flags(), isTTY: true, mount: fake.mount });

    expect(ui.tui).toBe(true);
    expect(fake.calls()).toBe(1);
    // The mount receives a real store + approval controller to render/answer from.
    expect(fake.props()?.store).toBeDefined();
    expect(fake.props()?.approval).toBeDefined();
  });

  it("falls back to line logs when there is no TTY (even with tui on)", () => {
    const fake = fakeMount();
    const lines: string[] = [];
    const ui = startUi({
      flags: flags(),
      isTTY: false,
      mount: fake.mount,
      linePrint: (l) => lines.push(l),
    });

    expect(ui.tui).toBe(false);
    expect(fake.calls()).toBe(0);

    ui.dispatch({ type: "task_registered", taskId: "T-001", title: "t" });
    expect(lines.some((l) => l.includes("T-001"))).toBe(true);
  });

  it("falls back to line logs when --no-tui (flags.tui false), TTY notwithstanding", () => {
    const fake = fakeMount();
    const ui = startUi({
      flags: flags({ tui: false }),
      isTTY: true,
      mount: fake.mount,
      linePrint: () => {},
    });
    expect(ui.tui).toBe(false);
    expect(fake.calls()).toBe(0);
  });

  it("falls back to line logs when no mount is available (no Ink wired)", () => {
    const ui = startUi({ flags: flags(), isTTY: true, linePrint: () => {} });
    expect(ui.tui).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Progress dispatch routing
// ---------------------------------------------------------------------------

describe("startUi · progress dispatch", () => {
  it("routes events into the mounted store in TUI mode (not the line sink)", () => {
    const fake = fakeMount();
    const lines: string[] = [];
    const ui = startUi({
      flags: flags(),
      isTTY: true,
      mount: fake.mount,
      linePrint: (l) => lines.push(l),
    });

    ui.dispatch({
      type: "task_registered",
      taskId: "T-001",
      title: "Scaffold",
    });

    expect(
      fake
        .props()
        ?.store.getState()
        .tasks.map((t) => t.id),
    ).toEqual(["T-001"]);
    expect(lines).toEqual([]); // TUI mode does not print line logs
  });

  it("stop() unmounts the Ink instance in TUI mode", () => {
    const fake = fakeMount();
    const ui = startUi({ flags: flags(), isTTY: true, mount: fake.mount });
    ui.stop();
    expect(fake.unmounted()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Approval transport selection
// ---------------------------------------------------------------------------

describe("startUi · approval transport", () => {
  it("uses the TUI controller as the UiPort so ApprovalPrompt can answer it", async () => {
    const fake = fakeMount();
    const ui = startUi({ flags: flags(), isTTY: true, mount: fake.mount });

    const decision = ui.ui.requestApproval("merge?");
    // The pending request is visible to the mounted approval controller.
    expect(fake.props()?.approval.pending()?.prompt).toBe("merge?");
    fake.props()?.approval.answer(true);
    await expect(decision).resolves.toBe(true);
  });

  it("auto-approves without interaction when --yes is set", async () => {
    const ui = startUi({
      flags: flags({ tui: false, yes: true }),
      isTTY: false,
      linePrint: () => {},
    });
    await expect(ui.ui.requestApproval("merge?")).resolves.toBe(true);
  });

  it("auto-approves in TUI mode too when --yes is set", async () => {
    const fake = fakeMount();
    const ui = startUi({
      flags: flags({ yes: true }),
      isTTY: true,
      mount: fake.mount,
    });
    await expect(ui.ui.requestApproval("merge?")).resolves.toBe(true);
    // No pending request is created — the prompt never appears under --yes.
    expect(fake.props()?.approval.pending()).toBeUndefined();
  });
});
