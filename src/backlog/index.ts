/**
 * Public barrel for `loopy/backlog` — browser-safe surface only.
 *
 * Re-exports the pure, I/O-free API from `./parse` (never `./todo`, which
 * imports `node:fs` for `loadBacklog` / `markDoneInFile`) so this barrel stays
 * free of Node built-ins and the Vite/Rollup browser build never trips on an
 * externalized `node:fs`.
 */
export { parseBacklog, backlogOptionsFrom } from "./parse";
export type { BacklogOptions } from "./parse";
export type { Task } from "../types";
