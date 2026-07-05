/**
 * The one place Ink's `render` is actually called — kept isolated so the rest of
 * the TUI (selection logic in {@link ./start}, the pure view/reporter/approval
 * modules, and their tests) never has to load React/Ink/JSX. The entrypoint
 * injects {@link mountApp} into `startUi` as its {@link MountApp}; the no-TTY /
 * `--no-tui` path never touches this file.
 *
 * `patchConsole: false` keeps stray `console.*` out of the managed frame, and
 * `exitOnCtrlC: false` lets the engine own shutdown (the run must tear down its
 * worktrees/sessions, not exit abruptly).
 *
 * **Alternate screen (fullscreen dashboard).** On a real TTY we switch the
 * terminal to its alternate screen buffer before rendering and restore it on
 * unmount — so the dashboard owns the whole screen while the run is live (like
 * `htop`/`vim`) and the user's scrollback returns untouched afterward. The run's
 * escalation/dirty-parent notices are drained to stderr *after* `ui.stop()`
 * (i.e. after we leave the alternate screen), so they land in the normal buffer.
 */
import process from "node:process";
import { render } from "ink";
import { App } from "./App";
import type { MountApp } from "./start";

/** Enter alternate screen + clear + home. */
const ENTER_ALT_SCREEN = "\x1b[?1049h\x1b[2J\x1b[H";
/** Leave alternate screen (restores the previous buffer + scrollback). */
const LEAVE_ALT_SCREEN = "\x1b[?1049l";

export const mountApp: MountApp = ({ store, approval, stdout, stdin }) => {
  // Ink merges its `{ stdout: process.stdout, … }` defaults by spreading the
  // options object over them, so an explicit `undefined` here would clobber the
  // default back to `undefined` and make Ink deref `undefined.isTTY`. Default to
  // the real streams (the caller supplies them only in tests).
  const out = stdout ?? process.stdout;
  const fullscreen = Boolean(out.isTTY);

  if (fullscreen) out.write(ENTER_ALT_SCREEN);

  // Safety net: restore the primary buffer even if teardown is bypassed (crash,
  // signal). Registered once; a no-op after we already left.
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    if (fullscreen) out.write(LEAVE_ALT_SCREEN);
  };
  if (fullscreen) process.once("exit", restore);

  const instance = render(<App store={store} approval={approval} />, {
    stdout: out,
    stdin: stdin ?? process.stdin,
    patchConsole: false,
    exitOnCtrlC: false,
  });

  return {
    unmount: () => {
      instance.unmount();
      restore();
    },
  };
};
