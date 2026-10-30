/**
 * `loopy open` — find and launch the Loopy GUI (E1/E2).
 *
 * Re-exports the pure resolution of the GUI executable and the thin I/O shell
 * that builds the argv and spawns the GUI detached.
 */
export type {
  AppSource,
  ResolveAppInput,
  ResolveAppResult,
} from "./resolve-app";
export { resolveApp } from "./resolve-app";
export type { LaunchApp, LaunchResult, LocateApp, OpenRequest } from "./launch";
export { buildGuiArgv, isBundled, launchDetached, locateApp } from "./launch";
