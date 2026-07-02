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
 */
import { render } from "ink";
import { App } from "./App";
import type { MountApp } from "./start";

export const mountApp: MountApp = ({ store, approval, stdout, stdin }) => {
  const instance = render(<App store={store} approval={approval} />, {
    stdout,
    stdin,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  return {
    unmount: () => {
      instance.unmount();
    },
  };
};
