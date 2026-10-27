/**
 * `loopy open` — find and launch the Loopy GUI (E1/E2).
 *
 * Re-exports the pure resolution of the GUI executable; the detached spawn
 * (I/O) lives beside it.
 */
export type {
  AppSource,
  ResolveAppInput,
  ResolveAppResult,
} from "./resolve-app";
export { resolveApp } from "./resolve-app";
